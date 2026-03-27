const multer = require('multer');
const path = require('path');
const {
  PROFILE_UPLOADS_DIR,
  ESTABLISHMENT_UPLOADS_DIR,
} = require('./paths');
const { ensureDir } = require('../utils/files');

function buildStorage(destinationDir, prefix) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      ensureDir(destinationDir);
      cb(null, destinationDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const ext = path.extname(file.originalname);
      cb(null, `${prefix}-${uniqueSuffix}${ext}`);
    },
  });
}

function imageFileFilter(req, file, cb) {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    cb(null, true);
    return;
  }

  cb(new Error('Apenas imagens sao permitidas (jpeg, jpg, png, gif, webp)'));
}

const uploadProfile = multer({
  storage: buildStorage(PROFILE_UPLOADS_DIR, 'profile'),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

const uploadEstablishment = multer({
  storage: buildStorage(ESTABLISHMENT_UPLOADS_DIR, 'establishment'),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

module.exports = {
  uploadProfile,
  uploadEstablishment,
};
