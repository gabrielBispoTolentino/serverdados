import path from 'path';

const runtimeRoot = path.resolve(__dirname, '..', '..');

export const SERVER_ROOT =
  path.basename(runtimeRoot).toLowerCase() === 'dist'
    ? path.resolve(runtimeRoot, '..')
    : runtimeRoot;

export const UPLOADS_DIR = path.join(SERVER_ROOT, 'uploads');
export const PROFILE_UPLOADS_DIR = path.join(UPLOADS_DIR, 'profile-photos');
export const ESTABLISHMENT_UPLOADS_DIR = path.join(UPLOADS_DIR, 'establishment-photos');
