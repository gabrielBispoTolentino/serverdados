import { config } from 'dotenv';
import path from 'path';
import { SERVER_ROOT } from './config/paths';

config({ path: path.resolve(SERVER_ROOT, '.env') });

// Carregando o app e as configurações antes de iniciar o servidor
// eslint-disable-next-line @typescript-eslint/no-var-requires
const app = require('./app').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { logDatabaseConfig } = require('./config/database');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { logStorageConfig } = require('./services/storage');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ensureUploadDirs } = require('./utils/files');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

ensureUploadDirs();
logDatabaseConfig();
logStorageConfig();

app.listen(PORT, HOST, () => {
  console.log(`Servidor rodando em http://${HOST}:${PORT}`);
});
