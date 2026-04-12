import cors from 'cors';
import express from 'express';
import path from 'path';
import agendamentosRoutes from './routes/agendamentos';
import avaliacoesRoutes from './routes/avaliacoes';
import establishmentsRoutes from './routes/establishments';
import inscricoesRoutes from './routes/inscricoes';
import planosRoutes from './routes/planos';
import reportLucroRoutes from './routes/report-lucro';
import servicosRoutes from './routes/servicos';
import usersRoutes from './routes/users';
import { SERVER_ROOT } from './config/paths';

const app = express();
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Origem nao permitida pelo CORS'));
  },
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(SERVER_ROOT, 'uploads')));
app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.use(usersRoutes);
app.use(establishmentsRoutes);
app.use(agendamentosRoutes);
app.use(avaliacoesRoutes);
app.use(planosRoutes);
app.use(inscricoesRoutes);
app.use(servicosRoutes);
app.use(reportLucroRoutes);

export default app;
