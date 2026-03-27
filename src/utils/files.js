const fs = require('fs');
const path = require('path');
const {
  SERVER_ROOT,
  PROFILE_UPLOADS_DIR,
  ESTABLISHMENT_UPLOADS_DIR,
} = require('../config/paths');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function ensureUploadDirs() {
  ensureDir(PROFILE_UPLOADS_DIR);
  ensureDir(ESTABLISHMENT_UPLOADS_DIR);
}

function resolveAppPath(relativePath) {
  const sanitized = String(relativePath || '').replace(/^[/\\]+/, '');
  return path.join(SERVER_ROOT, sanitized);
}

function safeUnlink(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

module.exports = {
  ensureDir,
  ensureUploadDirs,
  resolveAppPath,
  safeUnlink,
};
