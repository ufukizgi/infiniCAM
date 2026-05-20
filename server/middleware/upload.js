const multer = require('multer');
const path = require('path');

// Use memory storage — StorageService handles writing to disk
const storage = multer.memoryStorage();

const allowedExtensions = ['.stp', '.step'];

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Only STEP files (.stp, .step) are allowed`), false);
  }
};

const uploadSTP = multer({
  storage,
  fileFilter,
  limits: { fileSize: 200 * 1024 * 1024 } // 200 MB max
});

// Separate uploader for thumbnails (PNG)
const uploadThumbnail = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png' || file.mimetype === 'image/jpeg') {
      cb(null, true);
    } else {
      cb(new Error('Only PNG/JPEG images allowed for thumbnails'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5 MB max
});

module.exports = { uploadSTP, uploadThumbnail };
