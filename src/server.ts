import { config } from 'dotenv';
import path from 'path';
import app from './app';
import { logDatabaseConfig } from './config/database';
import { SERVER_ROOT } from './config/paths';
import { ensureUploadDirs } from './utils/files';

config({ path: path.resolve(SERVER_ROOT, '.env') });

const PORT = Number(process.env.PORT || 3000);

ensureUploadDirs();
logDatabaseConfig();

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
