const express = require('express');
const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const Expense = require('../models/Expense');
const { protect, requirePermission } = require('../middleware/auth');
const { upload, handleUploadError } = require('../middleware/upload');

const router = express.Router();

// Helper function to extract data from OCR text
const extractReceiptData = (text) => {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  const extractedData = {
    extractedText: text,
    confidence: 0,
    extractedAmount: null,
    extractedDate: null,
    extractedMerchant: null,
    extractedCategory: null
  };

  // Extract amount (look for currency symbols and numbers)
  const amountRegex = /[\$£€¥₹]\s*(\d+(?:\.\d{2})?)|(\d+(?:\.\d{2})?)\s*[\$£€¥₹]|(?:total|amount|sum)[\s:]*[\$£€¥₹]?\s*(\d+(?:\.\d{2})?)/i;
  const amountMatch = text.match(amountRegex);
  if (amountMatch) {
    const amount = parseFloat(amountMatch[1] || amountMatch[2] || amountMatch[3]);
    if (!isNaN(amount)) {
      extractedData.extractedAmount = amount;
    }
  }

  // Extract date (various formats)
  const dateRegex = /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})|(\d{2,4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})|(\w{3,9}\s+\d{1,2},?\s+\d{2,4})/i;
  const dateMatch = text.match(dateRegex);
  if (dateMatch) {
    const dateStr = dateMatch[0];
    const parsedDate = new Date(dateStr);
    if (!isNaN(parsedDate.getTime())) {
      extractedData.extractedDate = parsedDate;
    }
  }

  // Extract merchant name (usually first few lines, excluding common receipt words)
  const excludeWords = ['receipt', 'invoice', 'bill', 'total', 'amount', 'date', 'time', 'tax', 'subtotal'];
  for (const line of lines.slice(0, 5)) {
    if (line.length > 3 && 
        !excludeWords.some(word => line.toLowerCase().includes(word)) &&
        !/^\d+[\.\-\/]\d+/.test(line) && // Not a date
        !/^\$?\d+\.?\d*$/.test(line)) { // Not just a number/amount
      extractedData.extractedMerchant = line;
      break;
    }
  }

  // Simple category detection based on merchant name or keywords
  const categoryKeywords = {
    'Travel': ['uber', 'lyft', 'taxi', 'airline', 'hotel', 'airport', 'flight', 'train'],
    'Meals': ['restaurant', 'cafe', 'coffee', 'food', 'pizza', 'burger', 'dining', 'bar'],
    'Office Supplies': ['staples', 'office', 'depot', 'supplies', 'paper', 'pen'],
    'Transportation': ['gas', 'fuel', 'parking', 'metro', 'bus', 'transit'],
    'Software': ['microsoft', 'adobe', 'google', 'software', 'subscription', 'saas'],
    'Marketing': ['facebook', 'google ads', 'marketing', 'advertising', 'promotion']
  };

  const textLower = text.toLowerCase();
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(keyword => textLower.includes(keyword))) {
      extractedData.extractedCategory = category;
      break;
    }
  }

  return extractedData;
};

// Helper function to preprocess image for better OCR
const preprocessImage = async (inputPath, outputPath) => {
  try {
    await sharp(inputPath)
      .grayscale()
      .normalize()
      .sharpen()
      .png()
      .toFile(outputPath);
    return outputPath;
  } catch (error) {
    console.error('Image preprocessing error:', error);
    return inputPath; // Return original if preprocessing fails
  }
};

// @desc    Upload receipt and perform OCR
// @route   POST /api/upload/receipt
// @access  Private (Employee role)
router.post('/receipt', protect, requirePermission('upload_receipts'), 
  upload.single('receipt'), handleUploadError, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { expenseId } = req.body;

    // If expenseId provided, validate it belongs to user
    if (expenseId) {
      const expense = await Expense.findById(expenseId);
      if (!expense || expense.employee.toString() !== req.user.id) {
        // Clean up uploaded file
        fs.unlinkSync(req.file.path);
        return res.status(403).json({
          success: false,
          message: 'Access denied to this expense'
        });
      }
    }

    const receiptData = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: req.file.path,
      ocrData: null
    };

    // Perform OCR if it's an image file
    if (req.file.mimetype.startsWith('image/')) {
      try {
        // Preprocess image for better OCR results
        const preprocessedPath = req.file.path.replace(/\.[^/.]+$/, '_processed.png');
        const processedImagePath = await preprocessImage(req.file.path, preprocessedPath);

        // Perform OCR
        const { data: { text, confidence } } = await Tesseract.recognize(
          processedImagePath,
          process.env.OCR_LANGUAGE || 'eng',
          {
            logger: m => console.log(m) // Optional: log OCR progress
          }
        );

        // Extract structured data from OCR text
        const extractedData = extractReceiptData(text);
        extractedData.confidence = confidence;

        receiptData.ocrData = extractedData;

        // Clean up preprocessed image if it's different from original
        if (processedImagePath !== req.file.path && fs.existsSync(processedImagePath)) {
          fs.unlinkSync(processedImagePath);
        }

      } catch (ocrError) {
        console.error('OCR processing error:', ocrError);
        // Continue without OCR data - don't fail the upload
        receiptData.ocrData = {
          extractedText: '',
          confidence: 0,
          error: 'OCR processing failed'
        };
      }
    }

    // If expenseId provided, add receipt to existing expense
    if (expenseId) {
      const expense = await Expense.findById(expenseId);
      expense.receipts.push(receiptData);
      await expense.save();

      const populatedExpense = await Expense.findById(expense._id)
        .populate('employee', 'firstName lastName email');

      return res.json({
        success: true,
        message: 'Receipt uploaded and processed successfully',
        data: {
          receipt: receiptData,
          expense: populatedExpense
        }
      });
    }

    // Otherwise, return receipt data for new expense creation
    res.json({
      success: true,
      message: 'Receipt uploaded and processed successfully',
      data: {
        receipt: receiptData
      }
    });

  } catch (error) {
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    console.error('Upload receipt error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during file upload'
    });
  }
});

// @desc    Upload multiple receipts
// @route   POST /api/upload/receipts
// @access  Private (Employee role)
router.post('/receipts', protect, requirePermission('upload_receipts'),
  upload.array('receipts', 5), handleUploadError, async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    const { expenseId } = req.body;
    const processedReceipts = [];

    // If expenseId provided, validate it belongs to user
    if (expenseId) {
      const expense = await Expense.findById(expenseId);
      if (!expense || expense.employee.toString() !== req.user.id) {
        // Clean up uploaded files
        req.files.forEach(file => {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        });
        return res.status(403).json({
          success: false,
          message: 'Access denied to this expense'
        });
      }
    }

    // Process each uploaded file
    for (const file of req.files) {
      const receiptData = {
        filename: file.filename,
        originalName: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        path: file.path,
        ocrData: null
      };

      // Perform OCR if it's an image file
      if (file.mimetype.startsWith('image/')) {
        try {
          const preprocessedPath = file.path.replace(/\.[^/.]+$/, '_processed.png');
          const processedImagePath = await preprocessImage(file.path, preprocessedPath);

          const { data: { text, confidence } } = await Tesseract.recognize(
            processedImagePath,
            process.env.OCR_LANGUAGE || 'eng'
          );

          const extractedData = extractReceiptData(text);
          extractedData.confidence = confidence;
          receiptData.ocrData = extractedData;

          if (processedImagePath !== file.path && fs.existsSync(processedImagePath)) {
            fs.unlinkSync(processedImagePath);
          }

        } catch (ocrError) {
          console.error('OCR processing error for file:', file.filename, ocrError);
          receiptData.ocrData = {
            extractedText: '',
            confidence: 0,
            error: 'OCR processing failed'
          };
        }
      }

      processedReceipts.push(receiptData);
    }

    // If expenseId provided, add receipts to existing expense
    if (expenseId) {
      const expense = await Expense.findById(expenseId);
      expense.receipts.push(...processedReceipts);
      await expense.save();

      const populatedExpense = await Expense.findById(expense._id)
        .populate('employee', 'firstName lastName email');

      return res.json({
        success: true,
        message: 'Receipts uploaded and processed successfully',
        data: {
          receipts: processedReceipts,
          expense: populatedExpense
        }
      });
    }

    res.json({
      success: true,
      message: 'Receipts uploaded and processed successfully',
      data: {
        receipts: processedReceipts
      }
    });

  } catch (error) {
    // Clean up uploaded files on error
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }

    console.error('Upload receipts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during file upload'
    });
  }
});

// @desc    Get receipt file
// @route   GET /api/upload/receipt/:filename
// @access  Private
router.get('/receipt/:filename', protect, async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(__dirname, '../uploads/receipts', filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // Find expense with this receipt to check permissions
    const expense = await Expense.findOne({
      'receipts.filename': filename,
      company: req.user.company._id
    });

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Receipt not found'
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

    // Get receipt info
    const receipt = expense.receipts.find(r => r.filename === filename);
    
    // Set appropriate headers
    res.setHeader('Content-Type', receipt.mimetype);
    res.setHeader('Content-Disposition', `inline; filename="${receipt.originalName}"`);

    // Send file
    res.sendFile(path.resolve(filePath));

  } catch (error) {
    console.error('Get receipt error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Delete receipt
// @route   DELETE /api/upload/receipt/:expenseId/:receiptId
// @access  Private (Employee - own expenses only)
router.delete('/receipt/:expenseId/:receiptId', protect, async (req, res) => {
  try {
    const { expenseId, receiptId } = req.params;

    const expense = await Expense.findById(expenseId);

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

    // Find receipt
    const receiptIndex = expense.receipts.findIndex(
      receipt => receipt._id.toString() === receiptId
    );

    if (receiptIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Receipt not found'
      });
    }

    const receipt = expense.receipts[receiptIndex];

    // Delete file from filesystem
    const filePath = path.resolve(receipt.path);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Remove receipt from expense
    expense.receipts.splice(receiptIndex, 1);
    await expense.save();

    res.json({
      success: true,
      message: 'Receipt deleted successfully'
    });

  } catch (error) {
    console.error('Delete receipt error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;
