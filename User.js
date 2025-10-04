const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  role: {
    type: String,
    enum: ['admin', 'manager', 'employee'],
    default: 'employee'
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  manager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  department: {
    type: String,
    trim: true
  },
  employeeId: {
    type: String,
    trim: true
  },
  phoneNumber: {
    type: String,
    trim: true
  },
  avatar: {
    type: String
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date
  },
  preferences: {
    currency: {
      type: String,
      default: 'USD'
    },
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      inApp: {
        type: Boolean,
        default: true
      }
    }
  }
}, {
  timestamps: true
});

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual for subordinates (employees reporting to this manager)
userSchema.virtual('subordinates', {
  ref: 'User',
  localField: '_id',
  foreignField: 'manager'
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Get user permissions based on role
userSchema.methods.getPermissions = function() {
  const permissions = {
    admin: [
      'create_company',
      'manage_users',
      'set_roles',
      'configure_approval_rules',
      'view_all_expenses',
      'override_approvals',
      'view_reports',
      'manage_categories'
    ],
    manager: [
      'approve_expenses',
      'reject_expenses',
      'view_team_expenses',
      'escalate_expenses',
      'view_reports'
    ],
    employee: [
      'submit_expenses',
      'view_own_expenses',
      'track_approval_status',
      'upload_receipts'
    ]
  };
  
  return permissions[this.role] || permissions.employee;
};

// Check if user has specific permission
userSchema.methods.hasPermission = function(permission) {
  return this.getPermissions().includes(permission);
};

module.exports = mongoose.model('User', userSchema);
