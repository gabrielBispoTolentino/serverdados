import express from 'express';
import { pool } from '../config/database';

const router = express.Router();

router.post('/planos', async (req, res) => {
  try {
    const {
      criador_estabelecimento_id,
      nome,
      description,
      preco,
      ciclo_pagamento,
      dias_freetrial,
      is_public,
    } = req.body;

    if (!criador_estabelecimento_id || !nome || !preco || !ciclo_pagamento) {
      return res.status(400).json({
        erro: 'Campos obrigatorios: criador_estabelecimento_id, nome, preco, ciclo_pagamento',
      });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const [, result] = await connection.execute(
        `
        INSERT INTO planos
          (criador_estabelecimento_id, estabelecimento_id, nome, description, preco, ciclo_pagamento, dias_freetrial, is_public, active, criado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())
      `,
        [
          criador_estabelecimento_id,
          criador_estabelecimento_id,
          nome,
          description || null,
          preco,
          ciclo_pagamento,
          dias_freetrial || 0,
          is_public !== false ? 1 : 0,
        ],
      );

      const planoId = result.insertId;

      await connection.execute(
        "INSERT INTO plano_parcerias (plano_id, estabelecimento_id, status) VALUES (?, ?, 'ativo')",
        [planoId, criador_estabelecimento_id],
      );

      await connection.commit();
      connection.release();

      res.status(201).json({
        mensagem: 'Plano criado com sucesso',
        id: planoId,
      });
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao criar plano' });
  }
});

router.get('/planos/meus/:estabelecimentoId', async (req, res) => {
  try {
    const { estabelecimentoId } = req.params;

    const [planos] = await pool.execute(
      `
      SELECT
        p.id,
        p.nome,
        p.description,
        p.preco,
        p.ciclo_pagamento,
        p.dias_freetrial,
        p.active,
        p.is_public,
        p.criador_estabelecimento_id,
        p.criado_em,
        e.nome AS criador_nome,
        CASE
          WHEN p.criador_estabelecimento_id = ? THEN 'criador'
          ELSE 'parceiro'
        END AS tipo,
        (SELECT COUNT(*)::int FROM plano_parcerias pp2 WHERE pp2.plano_id = p.id AND pp2.status = 'ativo') AS num_parceiros
      FROM planos p
      LEFT JOIN establishments e ON e.id = p.criador_estabelecimento_id
      INNER JOIN plano_parcerias pp ON pp.plano_id = p.id
      WHERE pp.estabelecimento_id = ?
        AND pp.status = 'ativo'
        AND p.deletado_em IS NULL
      ORDER BY tipo DESC, p.criado_em DESC
    `,
      [estabelecimentoId, estabelecimentoId],
    );

    res.json(planos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar planos' });
  }
});

router.get('/planos/marketplace', async (req, res) => {
  try {
    const { estabelecimento_id } = req.query;

    if (!estabelecimento_id) {
      return res.status(400).json({ erro: 'estabelecimento_id e obrigatorio' });
    }

    const [planos] = await pool.execute(
      `
      SELECT
        p.id,
        p.nome,
        p.description,
        p.preco,
        p.ciclo_pagamento,
        p.dias_freetrial,
        p.criador_estabelecimento_id,
        e.nome AS criador_nome,
        e.cidade AS criador_cidade,
        (SELECT COUNT(*)::int FROM plano_parcerias pp WHERE pp.plano_id = p.id AND pp.status = 'ativo') AS num_parceiros
      FROM planos p
      LEFT JOIN establishments e ON e.id = p.criador_estabelecimento_id
      WHERE p.is_public = 1
        AND p.active = 1
        AND p.deletado_em IS NULL
        AND e.deletedo_em IS NULL
        AND p.id NOT IN (
          SELECT plano_id
          FROM plano_parcerias
          WHERE estabelecimento_id = ? AND status = 'ativo'
        )
      ORDER BY num_parceiros DESC, p.criado_em DESC
    `,
      [estabelecimento_id as string],
    );

    res.json(planos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar planos do marketplace' });
  }
});

router.post('/planos/:planoId/participar', async (req, res) => {
  try {
    const { planoId } = req.params;
    const { estabelecimento_id } = req.body;

    if (!estabelecimento_id) {
      return res.status(400).json({ erro: 'estabelecimento_id e obrigatorio' });
    }

    const [planos] = await pool.execute(
      'SELECT id, is_public, criador_estabelecimento_id FROM planos WHERE id = ? AND active = 1 AND deletado_em IS NULL',
      [planoId],
    );

    if (planos.length === 0) {
      return res.status(404).json({ erro: 'Plano nao encontrado ou inativo' });
    }

    if (!planos[0].is_public) {
      return res.status(403).json({ erro: 'Este plano nao esta disponivel para parceria' });
    }

    if (planos[0].criador_estabelecimento_id === parseInt(estabelecimento_id, 10)) {
      return res.status(400).json({ erro: 'Voce ja e o criador deste plano' });
    }

    const [parceriaExistente] = await pool.execute(
      'SELECT id, status FROM plano_parcerias WHERE plano_id = ? AND estabelecimento_id = ?',
      [planoId, estabelecimento_id],
    );

    if (parceriaExistente.length > 0) {
      if (parceriaExistente[0].status === 'ativo') {
        return res.status(400).json({ erro: 'Voce ja e parceiro deste plano' });
      }

      await pool.execute("UPDATE plano_parcerias SET status = 'ativo', data_saida = NULL WHERE id = ?", [
        parceriaExistente[0].id,
      ]);

      return res.json({ mensagem: 'Parceria reativada com sucesso' });
    }

    await pool.execute(
      "INSERT INTO plano_parcerias (plano_id, estabelecimento_id, status) VALUES (?, ?, 'ativo')",
      [planoId, estabelecimento_id],
    );

    res.status(201).json({ mensagem: 'Parceria criada com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao participar do plano' });
  }
});

router.delete('/planos/:planoId/sair', async (req, res) => {
  try {
    const { planoId } = req.params;
    const { estabelecimento_id } = req.body;

    if (!estabelecimento_id) {
      return res.status(400).json({ erro: 'estabelecimento_id e obrigatorio' });
    }

    const [planos] = await pool.execute('SELECT criador_estabelecimento_id FROM planos WHERE id = ?', [planoId]);

    if (planos.length === 0) {
      return res.status(404).json({ erro: 'Plano nao encontrado' });
    }

    if (planos[0].criador_estabelecimento_id === parseInt(estabelecimento_id, 10)) {
      return res.status(400).json({
        erro: 'Criador nao pode sair do plano. Para remover o plano, delete-o.',
      });
    }

    const [, result] = await pool.execute(
      "UPDATE plano_parcerias SET status = 'inativo', data_saida = NOW() WHERE plano_id = ? AND estabelecimento_id = ?",
      [planoId, estabelecimento_id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: 'Parceria nao encontrada' });
    }

    res.json({ mensagem: 'Voce saiu da parceria com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao sair da parceria' });
  }
});

router.get('/planos/disponiveis', async (_req, res) => {
  try {
    const [planos] = await pool.execute(`
      SELECT DISTINCT
        p.id,
        p.nome,
        p.description,
        p.preco,
        p.ciclo_pagamento,
        p.dias_freetrial,
        p.criador_estabelecimento_id,
        e.nome AS criador_nome,
        (SELECT COUNT(*)::int FROM plano_parcerias pp2 WHERE pp2.plano_id = p.id AND pp2.status = 'ativo') AS num_estabelecimentos
      FROM planos p
      LEFT JOIN establishments e ON e.id = p.criador_estabelecimento_id
      INNER JOIN plano_parcerias pp ON pp.plano_id = p.id
      WHERE p.active = 1
        AND p.deletado_em IS NULL
        AND e.deletedo_em IS NULL
        AND pp.status = 'ativo'
      ORDER BY num_estabelecimentos DESC, p.nome ASC
    `);

    res.json(planos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar planos disponiveis' });
  }
});

router.get('/planos/estabelecimento/:id/disponiveis', async (req, res) => {
  try {
    const [planos] = await pool.execute(
      `
      SELECT DISTINCT
        p.id,
        p.nome,
        p.description,
        p.preco,
        p.ciclo_pagamento,
        p.dias_freetrial,
        p.active
      FROM planos p
      INNER JOIN plano_parcerias pp ON pp.plano_id = p.id
      WHERE pp.estabelecimento_id = ?
        AND pp.status = 'ativo'
        AND p.active = 1
        AND p.deletado_em IS NULL
      ORDER BY p.preco ASC
    `,
      [req.params.id],
    );

    res.json(planos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar planos disponiveis' });
  }
});

router.get('/planos/estabelecimento/:id', async (req, res) => {
  try {
    const [planos] = await pool.execute(
      `
      SELECT
        p.id,
        p.nome,
        p.description,
        p.preco,
        p.ciclo_pagamento,
        p.dias_freetrial,
        p.active,
        p.criado_em
      FROM planos p
      INNER JOIN plano_parcerias pp ON pp.plano_id = p.id
      WHERE pp.estabelecimento_id = ?
        AND pp.status = 'ativo'
        AND p.deletado_em IS NULL
      ORDER BY p.criado_em DESC
    `,
      [req.params.id],
    );

    res.json(planos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar planos' });
  }
});

router.get('/planos/:planoId/parceiros', async (req, res) => {
  try {
    const [parceiros] = await pool.execute(
      `
      SELECT
        pp.id,
        pp.estabelecimento_id,
        pp.status,
        pp.data_entrada,
        e.nome AS estabelecimento_nome,
        e.cidade,
        e.stado,
        CASE
          WHEN p.criador_estabelecimento_id = pp.estabelecimento_id THEN 1
          ELSE 0
        END AS is_criador
      FROM plano_parcerias pp
      LEFT JOIN establishments e ON e.id = pp.estabelecimento_id
      LEFT JOIN planos p ON p.id = pp.plano_id
      WHERE pp.plano_id = ? AND pp.status = 'ativo' AND e.deletedo_em IS NULL
      ORDER BY is_criador DESC, pp.data_entrada ASC
    `,
      [req.params.planoId],
    );

    res.json(parceiros);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar parceiros' });
  }
});

router.get('/planos/:planoId/beneficios', async (req, res) => {
  try {
    const [beneficios] = await pool.execute(
      `
      SELECT
        pb.*,
        s.nome AS servico_nome,
        s.preco_base AS servico_preco
      FROM plano_beneficios pb
      LEFT JOIN servicos s ON s.id = pb.servico_id
      WHERE pb.plano_id = ? AND pb.ativo = 1
      ORDER BY pb.ordem ASC
    `,
      [req.params.planoId],
    );

    res.json(beneficios);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar beneficios' });
  }
});

router.post('/planos/:planoId/beneficios', async (req, res) => {
  try {
    const { planoId } = req.params;
    const {
      tipo_beneficio,
      servico_id,
      condicao_tipo,
      condicao_valor,
      desconto_percentual,
      desconto_fixo,
      ordem,
    } = req.body;

    const [, result] = await pool.execute(
      `
      INSERT INTO plano_beneficios
        (plano_id, tipo_beneficio, servico_id, condicao_tipo, condicao_valor, desconto_percentual, desconto_fixo, ordem)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        planoId,
        tipo_beneficio,
        servico_id || null,
        condicao_tipo,
        condicao_valor || null,
        desconto_percentual || null,
        desconto_fixo || null,
        ordem || 0,
      ],
    );

    res.status(201).json({
      mensagem: 'Beneficio adicionado com sucesso',
      id: result.insertId,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao adicionar beneficio' });
  }
});

router.put('/planos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { estabelecimento_id, nome, description, preco, ciclo_pagamento, dias_freetrial, active, is_public } =
      req.body;

    const [planos] = await pool.execute(
      'SELECT criador_estabelecimento_id FROM planos WHERE id = ? AND deletado_em IS NULL',
      [id],
    );

    if (planos.length === 0) {
      return res.status(404).json({ erro: 'Plano nao encontrado' });
    }

    if (estabelecimento_id && planos[0].criador_estabelecimento_id !== parseInt(estabelecimento_id, 10)) {
      return res.status(403).json({ erro: 'Apenas o criador pode editar este plano' });
    }

    const [, result] = await pool.execute(
      `
      UPDATE planos
      SET nome = ?, description = ?, preco = ?, ciclo_pagamento = ?, dias_freetrial = ?, active = ?, is_public = ?, updated_em = NOW()
      WHERE id = ? AND deletado_em IS NULL
    `,
      [nome, description, preco, ciclo_pagamento, dias_freetrial, active, is_public !== undefined ? is_public : 1, id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: 'Plano nao encontrado' });
    }

    res.json({ mensagem: 'Plano atualizado com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao atualizar plano' });
  }
});

router.delete('/planos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { estabelecimento_id } = req.body;

    const [planos] = await pool.execute(
      'SELECT criador_estabelecimento_id FROM planos WHERE id = ? AND deletado_em IS NULL',
      [id],
    );

    if (planos.length === 0) {
      return res.status(404).json({ erro: 'Plano nao encontrado' });
    }

    if (estabelecimento_id && planos[0].criador_estabelecimento_id !== parseInt(estabelecimento_id, 10)) {
      return res.status(403).json({ erro: 'Apenas o criador pode deletar este plano' });
    }

    const [, result] = await pool.execute(
      'UPDATE planos SET deletado_em = NOW() WHERE id = ? AND deletado_em IS NULL',
      [id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: 'Plano nao encontrado' });
    }

    res.json({ mensagem: 'Plano deletado com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao deletar plano' });
  }
});

export default router;
