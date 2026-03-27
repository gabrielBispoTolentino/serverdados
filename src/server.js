const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const app = require('./app');
const { logDatabaseConfig } = require('./config/database');
const { ensureUploadDirs } = require('./utils/files');

const PORT = process.env.PORT || 3000;

ensureUploadDirs();
logDatabaseConfig();

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
