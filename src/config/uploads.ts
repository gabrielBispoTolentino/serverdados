import type { Request } from 'express';
import multer, { type FileFilterCallback, type StorageEngine } from 'multer';
import path from 'path';
const memoryStorage: StorageEngine = multer.memoryStorage();

function imageFileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback) {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    cb(null, true);
    return;
  }

  cb(new Error('Apenas imagens sao permitidas (jpeg, jpg, png, gif, webp)'));
}

export const uploadProfile = multer({
  storage: memoryStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

export const uploadEstablishment = multer({
  storage: memoryStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});
