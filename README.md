# Expense Reimbursement & Approval Workflow System

A modern, user-friendly expense management platform that solves the pain points companies face with manual, error-prone, and non-transparent processes.

## 🚀 Features

### Core Features
- **Authentication & User Management**: Auto-create company and admin user on first signup
- **Role-Based Access Control**: Admin, Manager, and Employee roles with specific permissions
- **Multi-Currency Support**: Automatic currency conversion using real-time exchange rates
- **OCR Receipt Processing**: Automatic data extraction from receipt images
- **Flexible Approval Workflows**: Multi-step approval with conditional rules
- **Real-time Dashboard**: Comprehensive analytics and reporting
- **Modern UI**: Responsive design with Material-UI components

### Key Capabilities
- ✅ Submit expenses with receipt uploads
- ✅ OCR-powered automatic data extraction
- ✅ Multi-step approval workflows
- ✅ Conditional approval rules (percentage, specific approvers)
- ✅ Real-time currency conversion
- ✅ Comprehensive reporting and analytics
- ✅ Role-based permissions
- ✅ Mobile-responsive design

## 🛠 Tech Stack

### Backend
- **Node.js** with Express.js
- **MongoDB** with Mongoose ODM
- **JWT** for authentication
- **Tesseract.js** for OCR processing
- **Sharp** for image processing
- **Axios** for API integrations

### Frontend
- **React 18** with hooks
- **Material-UI (MUI)** for components
- **React Router** for navigation
- **React Query** for data fetching
- **React Hook Form** for form handling
- **Recharts** for data visualization

## 📁 Project Structure

```
expense-reimbursement-system/
├── backend/                 # Node.js + Express API Server
│   ├── config/             # Database configuration
│   ├── middleware/         # Auth, upload, validation middleware
│   ├── models/             # MongoDB schemas (User, Company, Expense)
│   ├── routes/             # API endpoints
│   ├── uploads/            # File storage directory
│   ├── .env                # Backend environment variables
│   ├── package.json        # Backend dependencies
│   └── index.js            # Main server file
├── frontend/               # React.js Client Application
│   ├── public/             # Static assets
│   ├── src/                # React components and logic
│   │   ├── components/     # Reusable UI components
│   │   ├── contexts/       # React contexts (Auth, etc.)
│   │   ├── pages/          # Page components
│   │   └── App.js          # Main React app
│   └── package.json        # Frontend dependencies
├── package.json            # Root package.json for scripts
└── README.md               # This file
```

## 📋 Prerequisites

- Node.js (v16 or higher)
- MongoDB (v4.4 or higher)
- npm or yarn package manager

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone <repository-url>
cd expense-reimbursement-system
```

### 2. Install Dependencies
```bash
# Install root dependencies
npm install

# Install all dependencies (backend + frontend)
npm run install-all
```

### 3. Environment Setup
```bash
# Copy environment file
cp backend/.env.example backend/.env
```

Edit `backend/.env` with your configuration:
```env
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://localhost:27017/expense_reimbursement
JWT_SECRET=your_very_long_and_secure_jwt_secret_key_here
JWT_EXPIRE=7d

# Optional: Exchange Rate API Key (uses free tier if not provided)
EXCHANGE_RATE_API_KEY=your_exchange_rate_api_key_here

# File Upload Settings
MAX_FILE_SIZE=5242880
UPLOAD_PATH=uploads/

# OCR Settings
OCR_LANGUAGE=eng
```

### 4. Start MongoDB
Make sure MongoDB is running on your system:
```bash
# On macOS with Homebrew
brew services start mongodb-community

# On Ubuntu/Debian
sudo systemctl start mongod

# On Windows
net start MongoDB
```

### 5. Run the Application
```bash
# Development mode (runs both backend and frontend)
npm run dev

# Or run separately:
# Backend only
npm run backend

# Frontend only
npm run frontend
```

The application will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:5000

## 👥 Default User Roles

After registration, you can create additional users with different roles:

### Admin
- Full system access
- Create/manage users
- Configure approval rules
- View all expenses and reports
- Override approvals

### Manager
- Approve/reject expenses
- View team expenses
- Access to reports
- Manage subordinates

### Employee
- Submit expenses
- Upload receipts
- Track approval status
- View own expense history

## 📱 Usage Guide

### Getting Started
1. **Register**: Create your company account at `/register`
2. **Setup**: Configure company settings and expense categories
3. **Add Users**: Create employee and manager accounts
4. **Configure Workflows**: Set up approval rules and workflows

### For Employees
1. **Submit Expense**: Click "New Expense" and fill in details
2. **Upload Receipt**: Drag and drop or click to upload receipt images
3. **OCR Processing**: System automatically extracts data from receipts
4. **Submit for Approval**: Review and submit for manager approval
5. **Track Status**: Monitor approval progress in real-time

### For Managers
1. **Review Expenses**: Access pending approvals from dashboard
2. **Approve/Reject**: Review details and make decisions
3. **Add Comments**: Provide feedback for rejections
4. **View Reports**: Access team expense analytics

### For Admins
1. **User Management**: Create and manage user accounts
2. **Approval Rules**: Configure conditional approval workflows
3. **Company Settings**: Manage categories, currencies, and limits
4. **System Reports**: Access comprehensive analytics

## 🔧 Configuration

### Approval Workflows
Configure flexible approval rules in Company Settings:
- **Percentage Rules**: Require X% of approvers to approve
- **Specific Approvers**: Route to specific users (e.g., CFO auto-approval)
- **Hybrid Rules**: Combine percentage and specific approver rules
- **Amount Thresholds**: Different rules for different expense amounts

### Currency Support
- Automatic currency detection based on company country
- Real-time exchange rate conversion
- Support for 150+ currencies via ExchangeRate-API

### OCR Configuration
- Supports JPEG, PNG image formats
- Automatic extraction of amount, date, merchant, category
- Configurable language support (default: English)
- Smart categorization based on merchant patterns

## 🔒 Security Features

- JWT-based authentication
- Role-based access control
- Input validation and sanitization
- Rate limiting
- Secure file upload handling
- Password hashing with bcrypt

## 📊 API Documentation

### Authentication Endpoints
- `POST /api/auth/register` - Register new company and admin
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user
- `PUT /api/auth/profile` - Update user profile

### Expense Endpoints
- `GET /api/expenses` - List expenses (filtered by role)
- `POST /api/expenses` - Create new expense
- `GET /api/expenses/:id` - Get expense details
- `PUT /api/expenses/:id/submit` - Submit for approval
- `PUT /api/expenses/:id/approve` - Approve expense
- `PUT /api/expenses/:id/reject` - Reject expense

### User Management
- `GET /api/users` - List company users (Admin only)
- `POST /api/users` - Create new user (Admin only)
- `PUT /api/users/:id` - Update user (Admin only)

### Reports
- `GET /api/reports/dashboard` - Dashboard statistics
- `GET /api/reports/expenses` - Detailed expense reports
- `GET /api/reports/approvals` - Approval analytics

## 🚀 Deployment

### Production Build
```bash
# Build client
npm run build

# Start production server
npm start
```

### Environment Variables for Production
```env
NODE_ENV=production
MONGODB_URI=mongodb://your-production-db-url
JWT_SECRET=your-production-jwt-secret
```

### Docker Deployment (Optional)
```dockerfile
# Dockerfile example
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN npm run build
EXPOSE 5000
CMD ["npm", "start"]
```

## 🧪 Testing

```bash
# Run server tests
cd server && npm test

# Run client tests
cd client && npm test
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For support and questions:
- Create an issue on GitHub
- Check the documentation
- Review the API endpoints

## 🔄 Changelog

### v1.0.0
- Initial release
- Core expense management features
- OCR receipt processing
- Multi-step approval workflows
- Real-time dashboard and reporting
- Role-based access control
- Multi-currency support

---

**Built with ❤️ for modern expense management**
