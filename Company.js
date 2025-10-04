const mongoose = require('mongoose');

const approvalRuleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['percentage', 'specific', 'hybrid'],
    required: true
  },
  percentage: {
    type: Number,
    min: 0,
    max: 100
  },
  specificApprovers: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    autoApprove: {
      type: Boolean,
      default: false
    }
  }],
  minAmount: {
    type: Number,
    default: 0
  },
  maxAmount: {
    type: Number
  },
  categories: [String],
  isActive: {
    type: Boolean,
    default: true
  }
});

const companySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  country: {
    type: String,
    required: true
  },
  defaultCurrency: {
    code: {
      type: String,
      required: true
    },
    name: {
      type: String,
      required: true
    },
    symbol: {
      type: String,
      required: true
    }
  },
  expenseCategories: [{
    name: {
      type: String,
      required: true
    },
    description: String,
    isActive: {
      type: Boolean,
      default: true
    }
  }],
  approvalRules: [approvalRuleSchema],
  settings: {
    isManagerApproverEnabled: {
      type: Boolean,
      default: true
    },
    maxExpenseAmount: {
      type: Number,
      default: 10000
    },
    allowedFileTypes: {
      type: [String],
      default: ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf']
    },
    maxFileSize: {
      type: Number,
      default: 5242880 // 5MB
    },
    autoApprovalLimit: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true
});

// Default expense categories
companySchema.pre('save', function(next) {
  if (this.isNew && this.expenseCategories.length === 0) {
    this.expenseCategories = [
      { name: 'Travel', description: 'Travel related expenses' },
      { name: 'Meals', description: 'Business meals and entertainment' },
      { name: 'Office Supplies', description: 'Office equipment and supplies' },
      { name: 'Transportation', description: 'Local transportation costs' },
      { name: 'Accommodation', description: 'Hotel and lodging expenses' },
      { name: 'Training', description: 'Professional development and training' },
      { name: 'Software', description: 'Software licenses and subscriptions' },
      { name: 'Marketing', description: 'Marketing and promotional expenses' },
      { name: 'Other', description: 'Miscellaneous business expenses' }
    ];
  }
  next();
});

module.exports = mongoose.model('Company', companySchema);
