import express from 'express';
import { pool } from '../config/database';
import { calcularBeneficios } from '../services/benefits';
import { findClientById } from '../services/users';

const router = express.Router();

router.post('/agendamentos', async (req, res) => {
  try {
    const { usuario_id, estabelecimento_id, servico_id, proximo_pag, metodo_pagamento } = req.body;

    if (!usuario_id || !estabelecimento_id || !servico_id || !proximo_pag) {
      return res.status(400).json({
        erro: 'Campos obrigatorios: usuario_id, estabelecimento_id, servico_id, proximo_pag',
      });
    }

    const cliente = await findClientById(pool, usuario_id);

    if (!cliente) {
      return res.status(404).json({ erro: 'Cliente nao encontrado' });
    }

    const [servicos] = await pool.execute('SELECT * FROM servicos WHERE id = ? AND ativo = 1', [
      servico_id,
    ]);

    if (servicos.length === 0) {
      return res.status(404).json({ erro: 'Servico nao encontrado' });
    }

    const servico = servicos[0];
    const valorOriginal = Number(servico.preco_base);

    const [estabelecimentos] = await pool.execute('SELECT dono_id FROM establishments WHERE id = ?', [
      estabelecimento_id,
    ]);

    if (estabelecimentos.length === 0) {
      return res.status(404).json({ erro: 'Estabelecimento nao encontrado' });
    }

    const barbeiroId = estabelecimentos[0].dono_id;

    const [conflitos] = await pool.execute(
      `
      SELECT id
      FROM agendamentos
      WHERE barbeiro_id = ?
        AND data_hora = ?
        AND status IN ('pendente', 'confirmado')
    `,
      [barbeiroId, proximo_pag],
    );

    if (conflitos.length > 0) {
      return res.status(409).json({
        erro: 'Este horario ja esta ocupado. Por favor, escolha outro horario.',
      });
    }

    const [inscricoes] = await pool.execute(
      `
      SELECT i.id, i.plano_id, p.nome AS plano_nome
      FROM inscricoes i
      INNER JOIN planos p ON p.id = i.plano_id
      WHERE i.usuario_id = ?
        AND i.estabelecimento_id = ?
        AND i.status IN ('ativo', 'free trial')
      ORDER BY i.criado_em DESC
      LIMIT 1
    `,
      [usuario_id, estabelecimento_id],
    );

    let inscricaoId = null;
    let valorFinal = valorOriginal;
    let beneficiosInfo: Awaited<ReturnType<typeof calcularBeneficios>> = {
      valorFinal: valorOriginal,
      descontoTotal: 0,
      beneficiosAplicados: [],
    };

    if (inscricoes.length > 0) {
      inscricaoId = inscricoes[0].id;
      beneficiosInfo = await calcularBeneficios(pool, inscricaoId, servico_id, valorOriginal);
      valorFinal = beneficiosInfo.valorFinal;
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const [, resultAgendamento] = await connection.execute(
        'INSERT INTO agendamentos (cliente_id, barbeiro_id, estabelecimento_id, data_hora, status, criado_em) VALUES (?, ?, ?, ?, ?, NOW())',
        [usuario_id, barbeiroId, estabelecimento_id, proximo_pag, 'pendente'],
      );

      const agendamentoId = resultAgendamento.insertId;
      const metodoId = metodo_pagamento || 1;

      await connection.execute(
        `
        INSERT INTO pagamento
          (inscricao_id, agendamento_id, usuario_id, estabelecimento_id, quantidade, cambio, metodo_id, status, criado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
        [
          inscricaoId,
          agendamentoId,
          usuario_id,
          estabelecimento_id,
          valorFinal,
          'BRL',
          metodoId,
          'pendente',
        ],
      );

      if (inscricaoId) {
        const beneficioAplicadoId =
          beneficiosInfo.beneficiosAplicados.length > 0 ? beneficiosInfo.beneficiosAplicados[0].id : null;

        await connection.execute(
          `
          INSERT INTO uso_servicos
            (inscricao_id, usuario_id, servico_id, agendamento_id, valor_pago, beneficio_aplicado_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
          [inscricaoId, usuario_id, servico_id, agendamentoId, valorFinal, beneficioAplicadoId],
        );
      }

      await connection.commit();
      connection.release();

      res.status(201).json({
        mensagem: 'Agendamento criado com sucesso',
        id: agendamentoId,
        servico: servico.nome,
        valor_original: valorOriginal,
        valor_final: valorFinal,
        desconto_total: beneficiosInfo.descontoTotal,
        beneficios_aplicados: beneficiosInfo.beneficiosAplicados,
        tem_assinatura: inscricaoId !== null,
      });
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao criar agendamento' });
  }
});

router.get('/agendamentos', async (req, res) => {
  try {
    const { usuario_id } = req.query;

    if (!usuario_id) {
      return res.status(400).json({ erro: 'usuario_id e obrigatorio' });
    }

    const [rows] = await pool.execute(
      `
      SELECT DISTINCT
        a.id,
        a.cliente_id AS usuario_id,
        e.id AS estabelecimento_id,
        99 AS plano_id,
        a.data_hora AS proximo_pag,
        a.status,
        u.nome AS usuario_nome,
        e.nome AS estabelecimento_nome,
        (SELECT status FROM pagamento WHERE agendamento_id = a.id ORDER BY criado_em DESC LIMIT 1) AS pagamento_status,
        (SELECT quantidade FROM pagamento WHERE agendamento_id = a.id ORDER BY criado_em DESC LIMIT 1) AS valor
      FROM agendamentos a
      LEFT JOIN usuarioCliente u ON u.id = a.cliente_id
      LEFT JOIN establishments e ON e.id = a.estabelecimento_id
      WHERE a.cliente_id = ?
      ORDER BY a.data_hora DESC
    `,
      [usuario_id as string],
    );

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar agendamentos' });
  }
});

router.get('/agendamentos/minha-barbearia', async (req, res) => {
  try {
    const { usuario_id } = req.query;

    if (!usuario_id) {
      return res.status(400).json({ erro: 'usuario_id e obrigatorio' });
    }

    const [barbearias] = await pool.execute(
      'SELECT id, nome FROM establishments WHERE dono_id = ? AND deletedo_em IS NULL',
      [usuario_id as string],
    );

    if (!barbearias || barbearias.length === 0) {
      return res.json([]);
    }

    const ids = barbearias.map((barbearia) => barbearia.id);
    const placeholders = ids.map(() => '?').join(',');

    const [rows] = await pool.execute(
      `
      SELECT
        i.id,
        i.usuario_id,
        i.estabelecimento_id,
        i.plano_id,
        i."proxima_data_cobrança" AS proximo_pag,
        i.status,
        u.nome AS usuario_nome,
        e.nome AS estabelecimento_nome
      FROM inscricoes i
      LEFT JOIN usuarioCliente u ON u.id = i.usuario_id
      LEFT JOIN establishments e ON e.id = i.estabelecimento_id
      WHERE i.estabelecimento_id IN (${placeholders})
      ORDER BY i."proxima_data_cobrança" DESC
    `,
      ids,
    );

    res.json(rows);
  } catch (error) {
    console.error('/agendamentos/minha-barbearia erro:', error);
    res.status(500).json({ erro: 'Erro ao buscar agendamentos da(s) barbearia(s)' });
  }
});

router.get('/agendamentos/horarios-disponiveis/:estabelecimento_id', async (req, res) => {
  try {
    const { estabelecimento_id } = req.params;
    const { data } = req.query;

    if (!data) {
      return res.status(400).json({ erro: 'Data e obrigatoria' });
    }

    const [estabelecimentos] = await pool.execute('SELECT dono_id FROM establishments WHERE id = ?', [
      estabelecimento_id,
    ]);

    if (estabelecimentos.length === 0) {
      return res.status(404).json({ erro: 'Estabelecimento nao encontrado' });
    }

    const barbeiroId = estabelecimentos[0].dono_id;

    const [ocupados] = await pool.execute(
      `
      SELECT data_hora
      FROM agendamentos
      WHERE barbeiro_id = ?
        AND DATE(data_hora) = ?
        AND status IN ('pendente', 'confirmado')
    `,
      [barbeiroId, data as string],
    );

    const horariosOcupados = ocupados.map((row) => new Date(row.data_hora).toISOString());

    res.json({ horariosOcupados });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar horarios disponiveis' });
  }
});

router.patch('/agendamentos/:id/cancelar', async (req, res) => {
  try {
    const { id } = req.params;
    const { usuario_id } = req.body;

    const [agendamento] = await pool.execute('SELECT * FROM agendamentos WHERE id = ? AND cliente_id = ?', [
      id,
      usuario_id,
    ]);

    if (agendamento.length === 0) {
      return res.status(404).json({ erro: 'Agendamento nao encontrado' });
    }

    await pool.execute('UPDATE agendamentos SET status = ? WHERE id = ?', ['cancelado', id]);

    res.json({ mensagem: 'Agendamento cancelado com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao cancelar agendamento' });
  }
});

router.patch('/agendamentos/:id/reagendar', async (req, res) => {
  try {
    const { id } = req.params;
    const { usuario_id, nova_data } = req.body;

    if (!nova_data) {
      return res.status(400).json({ erro: 'Nova data e obrigatoria' });
    }

    const [agendamento] = await pool.execute('SELECT * FROM agendamentos WHERE id = ? AND cliente_id = ?', [
      id,
      usuario_id,
    ]);

    if (agendamento.length === 0) {
      return res.status(404).json({ erro: 'Agendamento nao encontrado' });
    }

    const barbeiroId = agendamento[0].barbeiro_id;

    const [conflitos] = await pool.execute(
      `
      SELECT id
      FROM agendamentos
      WHERE barbeiro_id = ?
        AND data_hora = ?
        AND status IN ('pendente', 'confirmado')
        AND id != ?
    `,
      [barbeiroId, nova_data, id],
    );

    if (conflitos.length > 0) {
      return res.status(409).json({
        erro: 'Este horario ja esta ocupado. Por favor, escolha outro horario.',
      });
    }

    await pool.execute('UPDATE agendamentos SET data_hora = ? WHERE id = ?', [nova_data, id]);

    res.json({ mensagem: 'Agendamento reagendado com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao reagendar agendamento' });
  }
});

router.patch('/agendamentos/:id/pagar', async (req, res) => {
  try {
    const { id } = req.params;

    const [pagamento] = await pool.execute('SELECT id FROM pagamento WHERE agendamento_id = ?', [id]);

    if (pagamento.length === 0) {
      return res.status(404).json({ erro: 'Pagamento nao encontrado para este agendamento' });
    }

    await pool.execute(
      `
      UPDATE pagamento
      SET status = 'completo', pago_em = NOW()
      WHERE agendamento_id = ?
    `,
      [id],
    );

    res.json({ mensagem: 'Pagamento confirmado com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao confirmar pagamento' });
  }
});

export default router;
