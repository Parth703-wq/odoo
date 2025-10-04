const express = require('express');
const { body, validationResult } = require('express-validator');
const axios = require('axios');
const Company = require('../models/Company');
const { protect, authorize, requirePermission } = require('../middleware/auth');

const router = express.Router();

// @desc    Get company details
// @route   GET /api/companies/current
// @access  Private
router.get('/current', protect, async (req, res) => {
  try {
    const company = await Company.findById(req.user.company._id);
    
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    res.json({
      success: true,
      data: { company }
    });

  } catch (error) {
    console.error('Get company error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Update company details
// @route   PUT /api/companies/current
// @access  Private (Admin only)
router.put('/current', protect, requirePermission('create_company'), [
  body('name').optional().trim().notEmpty(),
  body('country').optional().trim().notEmpty()
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

    const company = await Company.findById(req.user.company._id);
    
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    const { name, country, settings } = req.body;

    // Update fields if provided
    if (name) company.name = name;
    if (country) company.country = country;
    if (settings) {
      company.settings = { ...company.settings, ...settings };
    }

    await company.save();

    res.json({
      success: true,
      message: 'Company updated successfully',
      data: { company }
    });

  } catch (error) {
    console.error('Update company error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get expense categories
// @route   GET /api/companies/categories
// @access  Private
router.get('/categories', protect, async (req, res) => {
  try {
    const company = await Company.findById(req.user.company._id)
      .select('expenseCategories');

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    const activeCategories = company.expenseCategories.filter(cat => cat.isActive);

    res.json({
      success: true,
      data: { categories: activeCategories }
    });

  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Add expense category
// @route   POST /api/companies/categories
// @access  Private (Admin only)
router.post('/categories', protect, requirePermission('manage_categories'), [
  body('name').trim().notEmpty(),
  body('description').optional().trim()
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

    const { name, description } = req.body;

    const company = await Company.findById(req.user.company._id);
    
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    // Check if category already exists
    const existingCategory = company.expenseCategories.find(
      cat => cat.name.toLowerCase() === name.toLowerCase()
    );

    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: 'Category already exists'
      });
    }

    company.expenseCategories.push({
      name,
      description: description || '',
      isActive: true
    });

    await company.save();

    res.status(201).json({
      success: true,
      message: 'Category added successfully',
      data: { 
        category: company.expenseCategories[company.expenseCategories.length - 1] 
      }
    });

  } catch (error) {
    console.error('Add category error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Update expense category
// @route   PUT /api/companies/categories/:categoryId
// @access  Private (Admin only)
router.put('/categories/:categoryId', protect, requirePermission('manage_categories'), [
  body('name').optional().trim().notEmpty(),
  body('description').optional().trim(),
  body('isActive').optional().isBoolean()
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

    const { name, description, isActive } = req.body;

    const company = await Company.findById(req.user.company._id);
    
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    const category = company.expenseCategories.id(req.params.categoryId);
    
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Update fields if provided
    if (name) category.name = name;
    if (description !== undefined) category.description = description;
    if (isActive !== undefined) category.isActive = isActive;

    await company.save();

    res.json({
      success: true,
      message: 'Category updated successfully',
      data: { category }
    });

  } catch (error) {
    console.error('Update category error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get approval rules
// @route   GET /api/companies/approval-rules
// @access  Private (Admin/Manager)
router.get('/approval-rules', protect, async (req, res) => {
  try {
    const company = await Company.findById(req.user.company._id)
      .select('approvalRules')
      .populate('approvalRules.specificApprovers.user', 'firstName lastName email');

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    const activeRules = company.approvalRules.filter(rule => rule.isActive);

    res.json({
      success: true,
      data: { approvalRules: activeRules }
    });

  } catch (error) {
    console.error('Get approval rules error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Add approval rule
// @route   POST /api/companies/approval-rules
// @access  Private (Admin only)
router.post('/approval-rules', protect, requirePermission('configure_approval_rules'), [
  body('name').trim().notEmpty(),
  body('type').isIn(['percentage', 'specific', 'hybrid']),
  body('percentage').optional().isInt({ min: 0, max: 100 }),
  body('minAmount').optional().isNumeric({ min: 0 }),
  body('maxAmount').optional().isNumeric({ min: 0 })
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
      name, 
      type, 
      percentage, 
      specificApprovers, 
      minAmount, 
      maxAmount, 
      categories 
    } = req.body;

    const company = await Company.findById(req.user.company._id);
    
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    // Validate rule based on type
    if (type === 'percentage' && !percentage) {
      return res.status(400).json({
        success: false,
        message: 'Percentage is required for percentage type rules'
      });
    }

    if (type === 'specific' && (!specificApprovers || specificApprovers.length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'Specific approvers are required for specific type rules'
      });
    }

    const newRule = {
      name,
      type,
      percentage: percentage || null,
      specificApprovers: specificApprovers || [],
      minAmount: minAmount || 0,
      maxAmount: maxAmount || null,
      categories: categories || [],
      isActive: true
    };

    company.approvalRules.push(newRule);
    await company.save();

    // Populate the new rule
    const populatedCompany = await Company.findById(company._id)
      .populate('approvalRules.specificApprovers.user', 'firstName lastName email');

    const addedRule = populatedCompany.approvalRules[populatedCompany.approvalRules.length - 1];

    res.status(201).json({
      success: true,
      message: 'Approval rule added successfully',
      data: { approvalRule: addedRule }
    });

  } catch (error) {
    console.error('Add approval rule error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get currencies from API
// @route   GET /api/companies/currencies
// @access  Private
router.get('/currencies', protect, async (req, res) => {
  try {
    // Get exchange rates from API
    const response = await axios.get(`https://api.exchangerate-api.com/v4/latest/USD`);
    
    const currencies = Object.keys(response.data.rates).map(code => ({
      code,
      rate: response.data.rates[code]
    }));

    res.json({
      success: true,
      data: { 
        currencies,
        baseCurrency: 'USD',
        lastUpdated: response.data.date
      }
    });

  } catch (error) {
    console.error('Get currencies error:', error);
    
    // Fallback to basic currency list if API fails
    const fallbackCurrencies = [
      { code: 'USD', rate: 1 },
      { code: 'EUR', rate: 0.85 },
      { code: 'GBP', rate: 0.73 },
      { code: 'JPY', rate: 110 },
      { code: 'CAD', rate: 1.25 },
      { code: 'AUD', rate: 1.35 },
      { code: 'INR', rate: 75 }
    ];

    res.json({
      success: true,
      data: { 
        currencies: fallbackCurrencies,
        baseCurrency: 'USD',
        lastUpdated: new Date().toISOString(),
        note: 'Using fallback currency data'
      }
    });
  }
});

// @desc    Get countries from API
// @route   GET /api/companies/countries
// @access  Private
router.get('/countries', protect, async (req, res) => {
  try {
    const response = await axios.get('https://restcountries.com/v3.1/all?fields=name,currencies');
    
    const countries = response.data.map(country => ({
      name: country.name.common,
      currencies: country.currencies || {}
    })).sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      success: true,
      data: { countries }
    });

  } catch (error) {
    console.error('Get countries error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch countries data'
    });
  }
});

module.exports = router;
