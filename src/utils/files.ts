import fs from 'fs';
import path from 'path';
import {
  ESTABLISHMENT_UPLOADS_DIR,
  PROFILE_UPLOADS_DIR,
  SERVER_ROOT,
} from '../config/paths';

export function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function ensureUploadDirs() {
  ensureDir(PROFILE_UPLOADS_DIR);
  ensureDir(ESTABLISHMENT_UPLOADS_DIR);
}

export function resolveAppPath(relativePath: string | null | undefined) {
  const sanitized = String(relativePath || '').replace(/^[/\\]+/, '');
  return path.join(SERVER_ROOT, sanitized);
}

export function safeUnlink(filePath: string | null | undefined) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
