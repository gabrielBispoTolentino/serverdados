import express from 'express';
import { pool } from '../config/database';
import { findClientById } from '../services/users';

const router = express.Router();

router.post('/avaliacoes', async (req, res) => {
  try {
    const { usuario_id, estabelecimento_id, rating, comentario } = req.body;

    const cliente = await findClientById(pool, usuario_id);

    if (!cliente) {
      return res.status(404).json({ erro: 'Cliente nao encontrado' });
    }

    const [, result] = await pool.execute(
      'INSERT INTO avaliacoes (usuario_id, id_estabelecimento, score, comment) VALUES (?, ?, ?, ?)',
      [usuario_id, estabelecimento_id, rating, comentario],
    );

    res.status(201).json({
      mensagem: 'Avaliacao criada com sucesso',
      id: result.insertId,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao criar avaliacao' });
  }
});

export default router;
