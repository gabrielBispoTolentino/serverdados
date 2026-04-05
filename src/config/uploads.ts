import type { Request } from 'express';
import multer, { type FileFilterCallback, type StorageEngine } from 'multer';
import path from 'path';
import { ESTABLISHMENT_UPLOADS_DIR, PROFILE_UPLOADS_DIR } from './paths';
import { ensureDir } from '../utils/files';

function buildStorage(destinationDir: string, prefix: string): StorageEngine {
  return multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDir(destinationDir);
      cb(null, destinationDir);
    },
    filename: (_req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const ext = path.extname(file.originalname);
      cb(null, `${prefix}-${uniqueSuffix}${ext}`);
    },
  });
}

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
  storage: buildStorage(PROFILE_UPLOADS_DIR, 'profile'),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

export const uploadEstablishment = multer({
  storage: buildStorage(ESTABLISHMENT_UPLOADS_DIR, 'establishment'),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});
