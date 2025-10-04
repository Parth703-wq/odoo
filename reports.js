const express = require('express');
const Expense = require('../models/Expense');
const User = require('../models/User');
const { protect, requirePermission } = require('../middleware/auth');

const router = express.Router();

// @desc    Get expense dashboard statistics
// @route   GET /api/reports/dashboard
// @access  Private
router.get('/dashboard', protect, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Build base query
    let baseQuery = { company: req.user.company._id };
    
    // Role-based filtering
    if (req.user.role === 'employee') {
      baseQuery.employee = req.user.id;
    } else if (req.user.role === 'manager') {
      // Managers can see their own expenses and their team's expenses
      const subordinates = await User.find({ manager: req.user.id }).select('_id');
      const subordinateIds = subordinates.map(sub => sub._id);
      baseQuery.$or = [
        { employee: req.user.id },
        { employee: { $in: subordinateIds } }
      ];
    }
    // Admins can see all expenses (no additional filtering needed)

    // Add date filter if provided
    if (startDate || endDate) {
      baseQuery.expenseDate = {};
      if (startDate) baseQuery.expenseDate.$gte = new Date(startDate);
      if (endDate) baseQuery.expenseDate.$lte = new Date(endDate);
    }

    // Get expense statistics
    const stats = await Expense.aggregate([
      { $match: baseQuery },
      {
        $group: {
          _id: null,
          totalExpenses: { $sum: 1 },
          totalAmount: { $sum: '$convertedAmount' },
          pendingCount: { $sum: { $cond: [{ $eq: ['$status', 'pending_approval'] }, 1, 0] } },
          approvedCount: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
          rejectedCount: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
          pendingAmount: { $sum: { $cond: [{ $eq: ['$status', 'pending_approval'] }, '$convertedAmount', 0] } },
          approvedAmount: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, '$convertedAmount', 0] } },
          rejectedAmount: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, '$convertedAmount', 0] } }
        }
      }
    ]);

    // Get expenses by category
    const categoryStats = await Expense.aggregate([
      { $match: baseQuery },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          totalAmount: { $sum: '$convertedAmount' }
        }
      },
      { $sort: { totalAmount: -1 } }
    ]);

    // Get monthly trend (last 12 months)
    const monthlyTrend = await Expense.aggregate([
      { 
        $match: {
          ...baseQuery,
          expenseDate: { $gte: new Date(new Date().setMonth(new Date().getMonth() - 12)) }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$expenseDate' },
            month: { $month: '$expenseDate' }
          },
          count: { $sum: 1 },
          totalAmount: { $sum: '$convertedAmount' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Get recent expenses
    const recentExpenses = await Expense.find(baseQuery)
      .populate('employee', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(5)
      .select('title amount convertedAmount category status createdAt employee');

    // Get pending approvals count for managers/admins
    let pendingApprovals = 0;
    if (req.user.role !== 'employee') {
      pendingApprovals = await Expense.countDocuments({
        company: req.user.company._id,
        status: 'pending_approval',
        'approvalWorkflow.steps': {
          $elemMatch: {
            approver: req.user.id,
            status: 'pending'
          }
        }
      });
    }

    const result = {
      overview: stats[0] || {
        totalExpenses: 0,
        totalAmount: 0,
        pendingCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        pendingAmount: 0,
        approvedAmount: 0,
        rejectedAmount: 0
      },
      categoryBreakdown: categoryStats,
      monthlyTrend,
      recentExpenses,
      pendingApprovals
    };

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get detailed expense report
// @route   GET /api/reports/expenses
// @access  Private (Manager/Admin)
router.get('/expenses', protect, requirePermission('view_reports'), async (req, res) => {
  try {
    const { 
      startDate, 
      endDate, 
      status, 
      category, 
      employee,
      groupBy = 'month',
      format = 'json'
    } = req.query;

    // Build query
    let query = { company: req.user.company._id };
    
    if (startDate || endDate) {
      query.expenseDate = {};
      if (startDate) query.expenseDate.$gte = new Date(startDate);
      if (endDate) query.expenseDate.$lte = new Date(endDate);
    }
    
    if (status) query.status = status;
    if (category) query.category = category;
    if (employee) query.employee = employee;

    // Role-based filtering for managers
    if (req.user.role === 'manager') {
      const subordinates = await User.find({ manager: req.user.id }).select('_id');
      const subordinateIds = subordinates.map(sub => sub._id);
      query.$or = [
        { employee: req.user.id },
        { employee: { $in: subordinateIds } }
      ];
    }

    // Aggregation pipeline based on groupBy parameter
    let groupStage;
    switch (groupBy) {
      case 'day':
        groupStage = {
          _id: {
            year: { $year: '$expenseDate' },
            month: { $month: '$expenseDate' },
            day: { $dayOfMonth: '$expenseDate' }
          }
        };
        break;
      case 'week':
        groupStage = {
          _id: {
            year: { $year: '$expenseDate' },
            week: { $week: '$expenseDate' }
          }
        };
        break;
      case 'month':
        groupStage = {
          _id: {
            year: { $year: '$expenseDate' },
            month: { $month: '$expenseDate' }
          }
        };
        break;
      case 'category':
        groupStage = { _id: '$category' };
        break;
      case 'employee':
        groupStage = { _id: '$employee' };
        break;
      case 'status':
        groupStage = { _id: '$status' };
        break;
      default:
        groupStage = { _id: null };
    }

    const pipeline = [
      { $match: query },
      {
        $group: {
          ...groupStage,
          totalExpenses: { $sum: 1 },
          totalAmount: { $sum: '$convertedAmount' },
          avgAmount: { $avg: '$convertedAmount' },
          minAmount: { $min: '$convertedAmount' },
          maxAmount: { $max: '$convertedAmount' },
          expenses: { $push: '$$ROOT' }
        }
      },
      { $sort: { '_id': 1 } }
    ];

    // If grouping by employee, populate employee data
    if (groupBy === 'employee') {
      pipeline.push({
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'employeeData'
        }
      });
    }

    const reportData = await Expense.aggregate(pipeline);

    // Get summary statistics
    const summary = await Expense.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalExpenses: { $sum: 1 },
          totalAmount: { $sum: '$convertedAmount' },
          avgAmount: { $avg: '$convertedAmount' },
          statusBreakdown: {
            $push: {
              status: '$status',
              amount: '$convertedAmount'
            }
          }
        }
      }
    ]);

    const result = {
      summary: summary[0] || {
        totalExpenses: 0,
        totalAmount: 0,
        avgAmount: 0
      },
      data: reportData,
      filters: {
        startDate,
        endDate,
        status,
        category,
        employee,
        groupBy
      }
    };

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Expense report error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get approval workflow analytics
// @route   GET /api/reports/approvals
// @access  Private (Admin only)
router.get('/approvals', protect, requirePermission('view_reports'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let query = { 
      company: req.user.company._id,
      status: { $in: ['approved', 'rejected'] }
    };

    if (startDate || endDate) {
      query.submittedAt = {};
      if (startDate) query.submittedAt.$gte = new Date(startDate);
      if (endDate) query.submittedAt.$lte = new Date(endDate);
    }

    // Get approval time analytics
    const approvalTimes = await Expense.aggregate([
      { $match: query },
      {
        $project: {
          approvalTime: {
            $subtract: [
              { $ifNull: ['$approvalWorkflow.completedAt', '$rejectedAt'] },
              '$submittedAt'
            ]
          },
          status: 1,
          approvalWorkflow: 1
        }
      },
      {
        $group: {
          _id: '$status',
          avgApprovalTime: { $avg: '$approvalTime' },
          minApprovalTime: { $min: '$approvalTime' },
          maxApprovalTime: { $max: '$approvalTime' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Get approver performance
    const approverPerformance = await Expense.aggregate([
      { $match: query },
      { $unwind: '$approvalWorkflow.steps' },
      {
        $match: {
          'approvalWorkflow.steps.status': { $in: ['approved', 'rejected'] }
        }
      },
      {
        $group: {
          _id: '$approvalWorkflow.steps.approver',
          totalApprovals: { $sum: 1 },
          approvedCount: { 
            $sum: { $cond: [{ $eq: ['$approvalWorkflow.steps.status', 'approved'] }, 1, 0] }
          },
          rejectedCount: { 
            $sum: { $cond: [{ $eq: ['$approvalWorkflow.steps.status', 'rejected'] }, 1, 0] }
          }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'approver'
        }
      },
      { $unwind: '$approver' },
      {
        $project: {
          approver: {
            _id: '$approver._id',
            firstName: '$approver.firstName',
            lastName: '$approver.lastName',
            email: '$approver.email'
          },
          totalApprovals: 1,
          approvedCount: 1,
          rejectedCount: 1,
          approvalRate: {
            $multiply: [
              { $divide: ['$approvedCount', '$totalApprovals'] },
              100
            ]
          }
        }
      },
      { $sort: { totalApprovals: -1 } }
    ]);

    // Get workflow step analytics
    const workflowAnalytics = await Expense.aggregate([
      { $match: query },
      {
        $project: {
          stepCount: { $size: '$approvalWorkflow.steps' },
          status: 1
        }
      },
      {
        $group: {
          _id: '$stepCount',
          count: { $sum: 1 },
          approvedCount: { 
            $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] }
          },
          rejectedCount: { 
            $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] }
          }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    const result = {
      approvalTimes,
      approverPerformance,
      workflowAnalytics,
      filters: { startDate, endDate }
    };

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Approval analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get employee expense summary
// @route   GET /api/reports/employees
// @access  Private (Manager/Admin)
router.get('/employees', protect, requirePermission('view_reports'), async (req, res) => {
  try {
    const { startDate, endDate, department } = req.query;

    let userQuery = { 
      company: req.user.company._id,
      isActive: true
    };

    if (department) userQuery.department = department;

    // Role-based filtering for managers
    if (req.user.role === 'manager') {
      const subordinates = await User.find({ manager: req.user.id }).select('_id');
      const subordinateIds = subordinates.map(sub => sub._id);
      subordinateIds.push(req.user.id); // Include manager's own data
      userQuery._id = { $in: subordinateIds };
    }

    let expenseQuery = { company: req.user.company._id };
    if (startDate || endDate) {
      expenseQuery.expenseDate = {};
      if (startDate) expenseQuery.expenseDate.$gte = new Date(startDate);
      if (endDate) expenseQuery.expenseDate.$lte = new Date(endDate);
    }

    const employeeStats = await User.aggregate([
      { $match: userQuery },
      {
        $lookup: {
          from: 'expenses',
          let: { userId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$employee', '$$userId'] },
                ...expenseQuery
              }
            }
          ],
          as: 'expenses'
        }
      },
      {
        $project: {
          firstName: 1,
          lastName: 1,
          email: 1,
          department: 1,
          role: 1,
          totalExpenses: { $size: '$expenses' },
          totalAmount: { $sum: '$expenses.convertedAmount' },
          pendingExpenses: {
            $size: {
              $filter: {
                input: '$expenses',
                cond: { $eq: ['$$this.status', 'pending_approval'] }
              }
            }
          },
          approvedExpenses: {
            $size: {
              $filter: {
                input: '$expenses',
                cond: { $eq: ['$$this.status', 'approved'] }
              }
            }
          },
          rejectedExpenses: {
            $size: {
              $filter: {
                input: '$expenses',
                cond: { $eq: ['$$this.status', 'rejected'] }
              }
            }
          },
          avgExpenseAmount: { $avg: '$expenses.convertedAmount' }
        }
      },
      { $sort: { totalAmount: -1 } }
    ]);

    res.json({
      success: true,
      data: {
        employees: employeeStats,
        filters: { startDate, endDate, department }
      }
    });

  } catch (error) {
    console.error('Employee report error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;
