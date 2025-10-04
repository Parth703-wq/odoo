const express = require('express');
const { body, validationResult } = require('express-validator');
const axios = require('axios');
const Expense = require('../models/Expense');
const User = require('../models/User');
const Company = require('../models/Company');
const { protect, authorize, requirePermission } = require('../middleware/auth');

const router = express.Router();

// Helper function to get exchange rate
const getExchangeRate = async (fromCurrency, toCurrency) => {
  if (fromCurrency === toCurrency) return 1;
  
  try {
    const response = await axios.get(`https://api.exchangerate-api.com/v4/latest/${fromCurrency}`);
    return response.data.rates[toCurrency] || 1;
  } catch (error) {
    console.error('Exchange rate API error:', error);
    return 1; // Fallback to 1:1 rate
  }
};

// Helper function to create approval workflow
const createApprovalWorkflow = async (expense, company) => {
  const steps = [];
  let stepOrder = 0;

  // Step 1: Manager approval (if enabled and employee has manager)
  if (company.settings.isManagerApproverEnabled && expense.employee.manager) {
    steps.push({
      approver: expense.employee.manager,
      status: 'pending',
      order: stepOrder++
    });
  }

  // Step 2: Apply approval rules based on amount and category
  const applicableRules = company.approvalRules.filter(rule => {
    if (!rule.isActive) return false;
    
    // Check amount range
    if (rule.minAmount && expense.convertedAmount < rule.minAmount) return false;
    if (rule.maxAmount && expense.convertedAmount > rule.maxAmount) return false;
    
    // Check category
    if (rule.categories.length > 0 && !rule.categories.includes(expense.category)) return false;
    
    return true;
  });

  // Apply the first matching rule (you can modify this logic for multiple rules)
  if (applicableRules.length > 0) {
    const rule = applicableRules[0];
    
    if (rule.type === 'specific' || rule.type === 'hybrid') {
      rule.specificApprovers.forEach(approver => {
        // Don't add if already in workflow
        if (!steps.find(step => step.approver.toString() === approver.user.toString())) {
          steps.push({
            approver: approver.user,
            status: 'pending',
            order: stepOrder++
          });
        }
      });
    }
  }

  // If no specific workflow defined, add a default admin approver
  if (steps.length === 0) {
    const admin = await User.findOne({ 
      company: company._id, 
      role: 'admin', 
      isActive: true 
    });
    
    if (admin) {
      steps.push({
        approver: admin._id,
        status: 'pending',
        order: 0
      });
    }
  }

  return {
    currentStep: 0,
    steps: steps.sort((a, b) => a.order - b.order)
  };
};

// @desc    Get expenses
// @route   GET /api/expenses
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      status, 
      category, 
      startDate, 
      endDate,
      employee,
      minAmount,
      maxAmount
    } = req.query;

    let query = { company: req.user.company._id };

    // Role-based filtering
    if (req.user.role === 'employee') {
      query.employee = req.user.id;
    } else if (req.user.role === 'manager') {
      // Managers can see their own expenses and their team's expenses
      const subordinates = await User.find({ manager: req.user.id }).select('_id');
      const subordinateIds = subordinates.map(sub => sub._id);
      query.$or = [
        { employee: req.user.id },
        { employee: { $in: subordinateIds } },
        { 'approvalWorkflow.steps.approver': req.user.id }
      ];
    }
    // Admins can see all expenses (no additional filtering needed)

    // Apply filters
    if (status) query.status = status;
    if (category) query.category = category;
    if (employee) query.employee = employee;
    if (minAmount) query.convertedAmount = { ...query.convertedAmount, $gte: parseFloat(minAmount) };
    if (maxAmount) query.convertedAmount = { ...query.convertedAmount, $lte: parseFloat(maxAmount) };
    
    if (startDate || endDate) {
      query.expenseDate = {};
      if (startDate) query.expenseDate.$gte = new Date(startDate);
      if (endDate) query.expenseDate.$lte = new Date(endDate);
    }

    const expenses = await Expense.find(query)
      .populate('employee', 'firstName lastName email')
      .populate('approvalWorkflow.steps.approver', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Expense.countDocuments(query);

    res.json({
      success: true,
      data: {
        expenses,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total
        }
      }
    });

  } catch (error) {
    console.error('Get expenses error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get single expense
// @route   GET /api/expenses/:id
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id)
      .populate('employee', 'firstName lastName email')
      .populate('approvalWorkflow.steps.approver', 'firstName lastName email')
      .populate('notes.author', 'firstName lastName email');

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    // Check access permissions
    const canAccess = 
      req.user.role === 'admin' ||
      expense.employee._id.toString() === req.user.id ||
      expense.approvalWorkflow.steps.some(step => 
        step.approver._id.toString() === req.user.id
      );

    if (!canAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: { expense }
    });

  } catch (error) {
    console.error('Get expense error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Create expense
// @route   POST /api/expenses
// @access  Private (Employee role)
router.post('/', protect, requirePermission('submit_expenses'), [
  body('title').trim().notEmpty(),
  body('amount').isNumeric({ min: 0.01 }),
  body('category').trim().notEmpty(),
  body('expenseDate').isISO8601(),
  body('currency.code').optional().trim().notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const {
      title,
      description,
      amount,
      currency,
      category,
      expenseDate,
      merchant,
      tags
    } = req.body;

    // Get company details
    const company = await Company.findById(req.user.company._id);
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    // Validate category
    const validCategory = company.expenseCategories.find(
      cat => cat.name === category && cat.isActive
    );
    if (!validCategory) {
      return res.status(400).json({
        success: false,
        message: 'Invalid expense category'
      });
    }

    // Get exchange rate and convert amount
    const expenseCurrency = currency?.code || company.defaultCurrency.code;
    const exchangeRate = await getExchangeRate(expenseCurrency, company.defaultCurrency.code);
    const convertedAmount = amount * exchangeRate;

    // Check if amount exceeds company limit
    if (company.settings.maxExpenseAmount && convertedAmount > company.settings.maxExpenseAmount) {
      return res.status(400).json({
        success: false,
        message: `Expense amount exceeds company limit of ${company.defaultCurrency.symbol}${company.settings.maxExpenseAmount}`
      });
    }

    // Get employee with manager info
    const employee = await User.findById(req.user.id).populate('manager');

    // Create expense
    const expense = new Expense({
      employee: req.user.id,
      company: req.user.company._id,
      title,
      description,
      amount,
      currency: {
        code: expenseCurrency,
        rate: exchangeRate
      },
      convertedAmount,
      category,
      expenseDate: new Date(expenseDate),
      merchant,
      tags: tags || [],
      status: 'draft'
    });

    // Create approval workflow
    expense.approvalWorkflow = await createApprovalWorkflow({ 
      ...expense.toObject(), 
      employee 
    }, company);

    await expense.save();

    // Populate the created expense
    const populatedExpense = await Expense.findById(expense._id)
      .populate('employee', 'firstName lastName email')
      .populate('approvalWorkflow.steps.approver', 'firstName lastName email');

    res.status(201).json({
      success: true,
      message: 'Expense created successfully',
      data: { expense: populatedExpense }
    });

  } catch (error) {
    console.error('Create expense error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Submit expense for approval
// @route   PUT /api/expenses/:id/submit
// @access  Private (Employee role)
router.put('/:id/submit', protect, async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    // Check if user owns this expense
    if (expense.employee.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Check if expense can be submitted
    if (expense.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Expense can only be submitted from draft status'
      });
    }

    // Check if expense has receipts (optional validation)
    // if (expense.receipts.length === 0) {
    //   return res.status(400).json({
    //     success: false,
    //     message: 'Please upload at least one receipt before submitting'
    //   });
    // }

    expense.status = expense.approvalWorkflow.steps.length > 0 ? 'pending_approval' : 'approved';
    expense.submittedAt = new Date();

    // If no approval workflow, auto-approve
    if (expense.approvalWorkflow.steps.length === 0) {
      expense.approvedAt = new Date();
      expense.approvalWorkflow.completedAt = new Date();
      expense.approvalWorkflow.finalStatus = 'approved';
    }

    await expense.save();

    const populatedExpense = await Expense.findById(expense._id)
      .populate('employee', 'firstName lastName email')
      .populate('approvalWorkflow.steps.approver', 'firstName lastName email');

    res.json({
      success: true,
      message: 'Expense submitted successfully',
      data: { expense: populatedExpense }
    });

  } catch (error) {
    console.error('Submit expense error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Approve expense
// @route   PUT /api/expenses/:id/approve
// @access  Private (Manager/Admin role)
router.put('/:id/approve', protect, requirePermission('approve_expenses'), [
  body('comments').optional().trim()
], async (req, res) => {
  try {
    const { comments } = req.body;

    const expense = await Expense.findById(req.params.id)
      .populate('employee', 'firstName lastName email');

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    // Check if user can approve this expense
    if (!expense.canBeApprovedBy(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to approve this expense'
      });
    }

    // Approve the expense
    expense.approve(req.user.id, comments);
    await expense.save();

    const populatedExpense = await Expense.findById(expense._id)
      .populate('employee', 'firstName lastName email')
      .populate('approvalWorkflow.steps.approver', 'firstName lastName email');

    res.json({
      success: true,
      message: 'Expense approved successfully',
      data: { expense: populatedExpense }
    });

  } catch (error) {
    console.error('Approve expense error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
});

// @desc    Reject expense
// @route   PUT /api/expenses/:id/reject
// @access  Private (Manager/Admin role)
router.put('/:id/reject', protect, requirePermission('reject_expenses'), [
  body('comments').trim().notEmpty().withMessage('Comments are required for rejection')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { comments } = req.body;

    const expense = await Expense.findById(req.params.id)
      .populate('employee', 'firstName lastName email');

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    // Check if user can reject this expense
    if (!expense.canBeApprovedBy(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to reject this expense'
      });
    }

    // Reject the expense
    expense.reject(req.user.id, comments);
    await expense.save();

    const populatedExpense = await Expense.findById(expense._id)
      .populate('employee', 'firstName lastName email')
      .populate('approvalWorkflow.steps.approver', 'firstName lastName email');

    res.json({
      success: true,
      message: 'Expense rejected successfully',
      data: { expense: populatedExpense }
    });

  } catch (error) {
    console.error('Reject expense error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
});

// @desc    Get expenses pending approval for current user
// @route   GET /api/expenses/pending-approval
// @access  Private (Manager/Admin role)
router.get('/pending/approval', protect, requirePermission('approve_expenses'), async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const expenses = await Expense.find({
      company: req.user.company._id,
      status: 'pending_approval',
      'approvalWorkflow.steps': {
        $elemMatch: {
          approver: req.user.id,
          status: 'pending'
        }
      }
    })
    .populate('employee', 'firstName lastName email')
    .populate('approvalWorkflow.steps.approver', 'firstName lastName email')
    .sort({ submittedAt: 1 }) // Oldest first
    .limit(limit * 1)
    .skip((page - 1) * limit);

    const total = await Expense.countDocuments({
      company: req.user.company._id,
      status: 'pending_approval',
      'approvalWorkflow.steps': {
        $elemMatch: {
          approver: req.user.id,
          status: 'pending'
        }
      }
    });

    res.json({
      success: true,
      data: {
        expenses,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total
        }
      }
    });

  } catch (error) {
    console.error('Get pending expenses error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Add note to expense
// @route   POST /api/expenses/:id/notes
// @access  Private
router.post('/:id/notes', protect, [
  body('content').trim().notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { content } = req.body;

    const expense = await Expense.findById(req.params.id);

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    // Check access permissions
    const canAccess = 
      req.user.role === 'admin' ||
      expense.employee.toString() === req.user.id ||
      expense.approvalWorkflow.steps.some(step => 
        step.approver.toString() === req.user.id
      );

    if (!canAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    expense.notes.push({
      author: req.user.id,
      content,
      createdAt: new Date()
    });

    await expense.save();

    const populatedExpense = await Expense.findById(expense._id)
      .populate('notes.author', 'firstName lastName email');

    res.status(201).json({
      success: true,
      message: 'Note added successfully',
      data: { 
        note: populatedExpense.notes[populatedExpense.notes.length - 1]
      }
    });

  } catch (error) {
    console.error('Add note error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;
