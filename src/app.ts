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

export default app;
