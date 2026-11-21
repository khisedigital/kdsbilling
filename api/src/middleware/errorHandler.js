const AppError = require('../utils/AppError');

function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
    });
  }

  if (err.name === 'SequelizeUniqueConstraintError') {
    const field = err.errors?.[0];
    const path = String(field?.path || Object.keys(err.fields || {})[0] || '');
    const value = field?.value ?? err.fields?.[path];
    let message = 'Record already exists';
    if (/sku/i.test(path)) {
      message = value ? `SKU ${value} is already used` : 'SKU is already used';
    } else if (/barcode/i.test(path)) {
      message = value ? `Barcode ${value} is already used by another product` : 'Barcode is already used by another product';
    }
    return res.status(409).json({
      success: false,
      error: {
        code: 'DUPLICATE_ENTRY',
        message,
      },
    });
  }

  const isProduction = process.env.NODE_ENV === 'production';

  if (err.name === 'SequelizeDatabaseError') {
    console.error('[Database Error]', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'DB_ERROR',
        message: isProduction ? 'A database error occurred' : (err.message || 'Database error'),
      },
    });
  }

  if (err.name === 'SequelizeForeignKeyConstraintError') {
    console.error('[Database Error]', err);
    return res.status(409).json({
      success: false,
      error: {
        code: 'FOREIGN_KEY_CONFLICT',
        message: isProduction
          ? 'Cannot complete operation due to related records'
          : (err.message || 'Foreign key constraint error'),
      },
    });
  }

  if (err.name === 'MulterError') {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'File is too large (max 5 MB)'
      : err.message;
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_FILE',
        message,
      },
    });
  }

  console.error('[Internal Error]', err);
  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: isProduction ? 'Something went wrong' : (err.message || 'Something went wrong'),
    },
  });
}

module.exports = errorHandler;
