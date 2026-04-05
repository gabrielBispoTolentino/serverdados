import express from 'express';
import { pool } from '../config/database';

const router = express.Router();

router.post('/inscricoes', async (req, res) => {
  try {
    const { usuario_id, plano_id, pagamento_metodo_id } = req.body;

    if (!usuario_id || !plano_id) {
      return res.status(400).json({ erro: 'usuario_id e plano_id sao obrigatorios' });
    }

    const [planos] = await pool.execute(
      'SELECT * FROM planos WHERE id = ? AND active = 1 AND deletado_em IS NULL',
      [plano_id],
    );

    if (planos.length === 0) {
      return res.status(404).json({ erro: 'Plano nao encontrado ou inativo' });
    }

    const plano = planos[0];
    const hoje = new Date();
    const dataInicio = hoje.toISOString().split('T')[0];

    const proximaCobranca = new Date(hoje);
    if (plano.dias_freetrial > 0) {
      proximaCobranca.setDate(proximaCobranca.getDate() + plano.dias_freetrial);
    } else {
      switch (plano.ciclo_pagamento) {
        case 'mensalmente':
          proximaCobranca.setMonth(proximaCobranca.getMonth() + 1);
          break;
        case 'quartenamente':
          proximaCobranca.setMonth(proximaCobranca.getMonth() + 3);
          break;
        case 'anual':
          proximaCobranca.setFullYear(proximaCobranca.getFullYear() + 1);
          break;
        default:
          proximaCobranca.setMonth(proximaCobranca.getMonth() + 1);
      }
    }

    const status = plano.dias_freetrial > 0 ? 'free trial' : 'ativo';
    const metodoId = pagamento_metodo_id || 1;

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const [, resultInscricao] = await connection.execute(
        `
        INSERT INTO inscricoes
          (usuario_id, plano_id, estabelecimento_id, status, data_incio, "proxima_data_cobrança", "preço_periodo_atual", pagamento_metodo_id, criado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
        [
          usuario_id,
          plano_id,
          plano.estabelecimento_id,
          status,
          dataInicio,
          proximaCobranca,
          plano.preco,
          metodoId,
        ],
      );

      const inscricaoId = resultInscricao.insertId;

      const dataLimite =
        plano.dias_freetrial > 0
          ? proximaCobranca.toISOString().split('T')[0]
          : new Date(hoje.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      await connection.execute(
        `
        INSERT INTO pagamento
          (inscricao_id, agendamento_id, usuario_id, estabelecimento_id, quantidade, cambio, metodo_id, status, data_limite, criado_em)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
        [
          inscricaoId,
          usuario_id,
          plano.estabelecimento_id,
          plano.preco,
          'BRL',
          metodoId,
          'pendente',
          dataLimite,
        ],
      );

      await connection.commit();
      connection.release();

      res.status(201).json({
        mensagem: 'Inscricao criada com sucesso',
        id: inscricaoId,
        free_trial: plano.dias_freetrial > 0,
        proxima_cobranca: proximaCobranca,
      });
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao criar inscricao' });
  }
});

router.get('/inscricoes/usuario/:id', async (req, res) => {
  try {
    const [inscricoes] = await pool.execute(
      `
      SELECT
        i.id,
        i.status,
        i.data_incio,
        i."proxima_data_cobrança" AS proxima_data_cobranca,
        i."preço_periodo_atual" AS preco_periodo_atual,
        p.nome AS plano_nome,
        p.description AS plano_description,
        p.ciclo_pagamento,
        e.nome AS estabelecimento_nome,
        e.id AS estabelecimento_id
      FROM inscricoes i
      LEFT JOIN planos p ON p.id = i.plano_id
      LEFT JOIN establishments e ON e.id = i.estabelecimento_id
      WHERE i.usuario_id = ?
        AND i.status IN ('ativo', 'free trial', 'atrasado')
      ORDER BY i.criado_em DESC
    `,
      [req.params.id],
    );

    res.json(inscricoes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar inscricoes' });
  }
});

router.patch('/inscricoes/:id/cancelar', async (req, res) => {
  try {
    const [, result] = await pool.execute(
      `
      UPDATE inscricoes
      SET status = 'cancelado', cancelado_por_user = 1, motivo_cancelamento = ?, updated_em = NOW()
      WHERE id = ?
    `,
      [req.body.motivo || null, req.params.id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: 'Inscricao nao encontrada' });
    }

    res.json({ mensagem: 'Inscricao cancelada com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao cancelar inscricao' });
  }
});

export default router;
