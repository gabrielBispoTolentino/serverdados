import express from 'express';
import { pool } from '../config/database';

const router = express.Router();

router.get('/servicos', async (_req, res) => {
  try {
    const [servicos] = await pool.execute('SELECT * FROM servicos WHERE ativo = 1 ORDER BY nome ASC');

    res.json(servicos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar servicos' });
  }
});

export default router;
