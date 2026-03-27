const path = require('path');

const SERVER_ROOT = path.resolve(__dirname, '..', '..');
const UPLOADS_DIR = path.join(SERVER_ROOT, 'uploads');
const PROFILE_UPLOADS_DIR = path.join(UPLOADS_DIR, 'profile-photos');
const ESTABLISHMENT_UPLOADS_DIR = path.join(UPLOADS_DIR, 'establishment-photos');

module.exports = {
  SERVER_ROOT,
  UPLOADS_DIR,
  PROFILE_UPLOADS_DIR,
  ESTABLISHMENT_UPLOADS_DIR,
};
