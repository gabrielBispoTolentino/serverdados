const express = require('express');
const cors = require('cors');
const path = require('path');
const usersRoutes = require('./routes/users');
const establishmentsRoutes = require('./routes/establishments');
const agendamentosRoutes = require('./routes/agendamentos');
const avaliacoesRoutes = require('./routes/avaliacoes');
const planosRoutes = require('./routes/planos');
const inscricoesRoutes = require('./routes/inscricoes');
const servicosRoutes = require('./routes/servicos');
const reportLucroRoutes = require('./routes/report-lucro');
const { SERVER_ROOT } = require('./config/paths');

const app = express();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(SERVER_ROOT, 'uploads')));

app.use(usersRoutes);
app.use(establishmentsRoutes);
app.use(agendamentosRoutes);
app.use(avaliacoesRoutes);
app.use(planosRoutes);
app.use(inscricoesRoutes);
app.use(servicosRoutes);
app.use(reportLucroRoutes);

module.exports = app;
