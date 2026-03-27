const express = require('express');
const { pool } = require('../config/database');

const router = express.Router();

router.post('/report-lucro/auto', async (req, res) => {
  try {
    const {
      estabelecimento_id,
      periodo_comeco,
      periodo_final,
    } = req.body;

    if (!estabelecimento_id || !periodo_comeco || !periodo_final) {
      return res.status(400).json({
        erro: 'Campos obrigatorios: estabelecimento_id, periodo_comeco, periodo_final',
      });
    }

    const [lucroRows] = await pool.execute(`
      SELECT COALESCE(SUM(quantidade), 0) AS lucro_total
      FROM pagamento
      WHERE estabelecimento_id = ?
        AND status = 'completo'
        AND pago_em BETWEEN ? AND ?
    `, [estabelecimento_id, periodo_comeco, periodo_final]);

    const lucro_total = Number(lucroRows[0].lucro_total);

    const [reembolsoRows] = await pool.execute(`
      SELECT COALESCE(SUM(quantidade), 0) AS reembolso_total
      FROM pagamento
      WHERE estabelecimento_id = ?
        AND status = 'reembolsado'
        AND pago_em BETWEEN ? AND ?
    `, [estabelecimento_id, periodo_comeco, periodo_final]);

    const reembolso_total = Number(reembolsoRows[0].reembolso_total);

    await pool.execute(`
      INSERT INTO report_lucro
        (estabelecimento_id, "periodo_começo", periodo_final, lucro_total, reembolso_total)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (estabelecimento_id, "periodo_começo", periodo_final)
      DO UPDATE SET
        lucro_total = EXCLUDED.lucro_total,
        reembolso_total = EXCLUDED.reembolso_total,
        generado_em = CURRENT_TIMESTAMP
    `, [estabelecimento_id, periodo_comeco, periodo_final, lucro_total, reembolso_total]);

    res.json({
      mensagem: 'Relatorio de lucro gerado automaticamente com sucesso!',
      dados: {
        estabelecimento_id,
        periodo_comeco,
        periodo_final,
        lucro_total,
        reembolso_total,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao gerar relatorio automatico' });
  }
});

router.get('/report-lucro', async (req, res) => {
  try {
    const { estabelecimento_id } = req.query;

    if (!estabelecimento_id) {
      return res.status(400).json({ erro: 'estabelecimento_id e obrigatorio' });
    }

    const [relatorios] = await pool.execute(`
      SELECT
        id,
        estabelecimento_id,
        "periodo_começo" AS periodo_comeco,
        periodo_final,
        lucro_total,
        reembolso_total,
        generado_em
      FROM report_lucro
      WHERE estabelecimento_id = ?
      ORDER BY "periodo_começo" DESC
    `, [estabelecimento_id]);

    res.json(relatorios);
  } catch (error) {
    console.error('Erro ao buscar relatorios:', error);
    res.status(500).json({ erro: 'Erro ao buscar relatorios de lucro' });
  }
});

module.exports = router;
