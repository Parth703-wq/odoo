const mongoose = require('mongoose');

const approvalStepSchema = new mongoose.Schema({
  approver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  comments: {
    type: String,
    trim: true
  },
  processedAt: {
    type: Date
  },
  order: {
    type: Number,
    required: true
  }
});

const receiptSchema = new mongoose.Schema({
  filename: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  mimetype: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  path: {
    type: String,
    required: true
  },
  ocrData: {
    extractedText: String,
    confidence: Number,
    extractedAmount: Number,
    extractedDate: Date,
    extractedMerchant: String,
    extractedCategory: String
  }
});

const expenseSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    code: {
      type: String,
      required: true,
      default: 'USD'
    },
    rate: {
      type: Number,
      default: 1
    }
  },
  convertedAmount: {
    type: Number,
    required: true
  },
  category: {
    type: String,
    required: true
  },
  expenseDate: {
    type: Date,
    required: true
  },
  merchant: {
    type: String,
    trim: true
  },
  receipts: [receiptSchema],
  status: {
    type: String,
    enum: ['draft', 'submitted', 'pending_approval', 'approved', 'rejected', 'reimbursed'],
    default: 'draft'
  },
  approvalWorkflow: {
    currentStep: {
      type: Number,
      default: 0
    },
    steps: [approvalStepSchema],
    completedAt: Date,
    finalStatus: {
      type: String,
      enum: ['approved', 'rejected']
    }
  },
  submittedAt: {
    type: Date
  },
  approvedAt: {
    type: Date
  },
  rejectedAt: {
    type: Date
  },
  reimbursedAt: {
    type: Date
  },
  tags: [String],
  notes: [{
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    content: {
      type: String,
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  metadata: {
    ipAddress: String,
    userAgent: String,
    location: {
      latitude: Number,
      longitude: Number,
      address: String
    }
  }
}, {
  timestamps: true
});

// Indexes for better query performance
expenseSchema.index({ employee: 1, status: 1 });
expenseSchema.index({ company: 1, status: 1 });
expenseSchema.index({ 'approvalWorkflow.steps.approver': 1, status: 1 });
expenseSchema.index({ expenseDate: -1 });
expenseSchema.index({ createdAt: -1 });

// Virtual for current approver
expenseSchema.virtual('currentApprover').get(function() {
  if (this.approvalWorkflow.steps.length === 0) return null;
  return this.approvalWorkflow.steps[this.approvalWorkflow.currentStep];
});

// Method to get next approver
expenseSchema.methods.getNextApprover = function() {
  const nextStep = this.approvalWorkflow.currentStep + 1;
  if (nextStep < this.approvalWorkflow.steps.length) {
    return this.approvalWorkflow.steps[nextStep];
  }
  return null;
};

// Method to check if expense can be approved by user
expenseSchema.methods.canBeApprovedBy = function(userId) {
  if (this.status !== 'pending_approval') return false;
  
  const currentStep = this.approvalWorkflow.steps[this.approvalWorkflow.currentStep];
  return currentStep && currentStep.approver.toString() === userId.toString() && currentStep.status === 'pending';
};

// Method to approve expense
expenseSchema.methods.approve = function(approverId, comments) {
  const currentStep = this.approvalWorkflow.steps[this.approvalWorkflow.currentStep];
  
  if (!currentStep || currentStep.approver.toString() !== approverId.toString()) {
    throw new Error('Unauthorized to approve this expense');
  }
  
  currentStep.status = 'approved';
  currentStep.comments = comments;
  currentStep.processedAt = new Date();
  
  // Move to next step or complete approval
  if (this.approvalWorkflow.currentStep + 1 < this.approvalWorkflow.steps.length) {
    this.approvalWorkflow.currentStep += 1;
  } else {
    this.status = 'approved';
    this.approvedAt = new Date();
    this.approvalWorkflow.completedAt = new Date();
    this.approvalWorkflow.finalStatus = 'approved';
  }
};

// Method to reject expense
expenseSchema.methods.reject = function(approverId, comments) {
  const currentStep = this.approvalWorkflow.steps[this.approvalWorkflow.currentStep];
  
  if (!currentStep || currentStep.approver.toString() !== approverId.toString()) {
    throw new Error('Unauthorized to reject this expense');
  }
  
  currentStep.status = 'rejected';
  currentStep.comments = comments;
  currentStep.processedAt = new Date();
  
  this.status = 'rejected';
  this.rejectedAt = new Date();
  this.approvalWorkflow.completedAt = new Date();
  this.approvalWorkflow.finalStatus = 'rejected';
};

module.exports = mongoose.model('Expense', expenseSchema);
