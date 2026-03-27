const express = require('express');
const { pool } = require('../config/database');

const router = express.Router();

router.get('/servicos', async (req, res) => {
  try {
    const [servicos] = await pool.execute(
      'SELECT * FROM servicos WHERE ativo = 1 ORDER BY nome ASC',
    );

    res.json(servicos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar servicos' });
  }
});

module.exports = router;
