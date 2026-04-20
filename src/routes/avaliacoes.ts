import express from 'express';
import { pool } from '../config/database';
import { findClientById } from '../services/users';

const router = express.Router();

async function refreshEstablishmentRating(establishmentId: number | string) {
  const [rows] = await pool.execute<{
    rating_avg: number | string | null;
    rating_count: number | string | null;
  }>(
    `
    SELECT
      COALESCE(AVG(score), 0) AS rating_avg,
      COUNT(*) AS rating_count
    FROM avaliacoes
    WHERE id_estabelecimento = ?
    `,
    [establishmentId],
  );

  const ratingAvg = Number(rows[0]?.rating_avg ?? 0);
  const ratingCount = Number(rows[0]?.rating_count ?? 0);

  await pool.execute(
    `
    UPDATE establishments
    SET rating_avg = ?, rating_count = ?, updated_em = NOW()
    WHERE id = ? AND deletedo_em IS NULL
    `,
    [ratingAvg, ratingCount, establishmentId],
  );

  return { ratingAvg, ratingCount };
}

router.get('/avaliacoes/estabelecimento/:id', async (req, res) => {
  try {
    const estabelecimentoId = String(req.params.id);

    const [reviews] = await pool.execute<{
      id: number;
      score: number | string;
      comment: string | null;
      usuario_nome: string;
      usuario_foto_url: string | null;
    }>(
      `
      SELECT
        a.id,
        a.score,
        a.comment,
        u.nome AS usuario_nome,
        u.imagem_url AS usuario_foto_url
      FROM avaliacoes a
      INNER JOIN usuario u ON u.id = a.usuario_id
      WHERE a.id_estabelecimento = ?
      ORDER BY a.id DESC
      `,
      [estabelecimentoId],
    );

    const summary = await refreshEstablishmentRating(estabelecimentoId);

    res.json({
      reviews: reviews.map((review) => ({
        id: review.id,
        rating: Number(review.score ?? 0),
        comentario: review.comment ?? '',
        usuarioNome: review.usuario_nome,
        usuarioFotoUrl: review.usuario_foto_url ?? null,
      })),
      ratingAvg: summary.ratingAvg,
      ratingCount: summary.ratingCount,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar avaliacoes' });
  }
});

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

    const summary = await refreshEstablishmentRating(estabelecimento_id);

    res.status(201).json({
      mensagem: 'Avaliacao criada com sucesso',
      id: result.insertId,
      ratingAvg: summary.ratingAvg,
      ratingCount: summary.ratingCount,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao criar avaliacao' });
  }
});

export default router;
