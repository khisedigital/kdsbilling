const multer = require('multer');
const AppError = require('../utils/AppError');

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new AppError('Only image files are allowed', 400, 'INVALID_FILE'));
    }
    cb(null, true);
  },
});

module.exports = upload;
