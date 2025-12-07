const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();
const cors = require('cors');

// Middleware
app.use(cors());
app.use(express.json());

// Servir arquivos estáticos da pasta 'uploads'
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configuração do Multer para upload de imagens de PERFIL
const storageProfile = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads/profile-photos');

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'profile-' + uniqueSuffix + ext);
  }
});

// Configuração do Multer para upload de imagens de ESTABELECIMENTOS
const storageEstablishment = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads/establishment-photos');

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'establishment-' + uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Apenas imagens são permitidas (jpeg, jpg, png, gif, webp)'));
  }
};

const uploadProfile = multer({
  storage: storageProfile,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: fileFilter
});

const uploadEstablishment = multer({
  storage: storageEstablishment,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: fileFilter
});

// Configuração do pool de conexões MySQL
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'root',
  database: 'sistemabarbearia',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const DEFAULT_PROFILE_PHOTO = '/uploads/profile-photos/default-avatar.png';
const DEFAULT_ESTABLISHMENT_PHOTO = '/uploads/establishment-photos/default-establishment.png';

// ============= ROTAS DE USUÁRIOS =============

app.post('/usuarios', uploadProfile.single('foto'), async (req, res) => {
  try {
    const { nome, email, senha, cpf, telefone, role } = req.body;

    if (!nome || !email || !senha || !cpf || !telefone || !role) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ erro: 'Todos os campos são obrigatórios' });
    }

    let fotoUrl = DEFAULT_PROFILE_PHOTO;
    if (req.file) {
      fotoUrl = `/uploads/profile-photos/${req.file.filename}`;
    }

    const [result] = await pool.execute(
      'INSERT INTO usuario (email, senha, nome, cpf, telefone, role, imagem_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [email, senha, nome, cpf, telefone, role, fotoUrl]
    );

    res.status(201).json({
      mensagem: 'Usuário criado com sucesso',
      id: result.insertId,
      fotoUrl: fotoUrl
    });
  } catch (erro) {
    console.error(erro);

    if (req.file) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({ erro: 'Erro ao criar usuário' });
  }
});

app.get('/usuarios', async (req, res) => {
  try {
    const [usuarios] = await pool.execute('SELECT id, nome, email, imagem_url as foto_url FROM usuario');
    res.json(usuarios);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar usuários' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { usuario, senha } = req.body;

    if (!usuario || !senha) {
      return res.status(400).json({ erro: 'Usuário e senha são obrigatórios' });
    }

    const [usuarios] = await pool.execute(
      'SELECT id, nome, email, cpf, telefone, role, imagem_url FROM usuario WHERE (email = ? OR cpf = ?) AND senha = ?',
      [usuario, usuario, senha]
    );

    if (usuarios.length === 0) {
      return res.status(401).json({ erro: 'Credenciais inválidas' });
    }

    const usuarioLogado = usuarios[0];
    res.json({
      mensagem: 'Login realizado com sucesso',
      usuario: {
        id: usuarioLogado.id,
        nome: usuarioLogado.nome,
        email: usuarioLogado.email,
        role: usuarioLogado.role,
        fotoUrl: usuarioLogado.imagem_url || DEFAULT_PROFILE_PHOTO
      }
    });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao realizar login' });
  }
});

app.get('/usuarios/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [usuarios] = await pool.execute(
      'SELECT id, nome, email, imagem_url as foto_url FROM usuario WHERE id = ?',
      [id]
    );

    if (usuarios.length === 0) {
      return res.status(404).json({ erro: 'Usuário não encontrado' });
    }

    res.json(usuarios[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar usuário' });
  }
});

app.put('/usuarios/:id', uploadProfile.single('foto'), async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, email, senha } = req.body;

    const [usuarioAtual] = await pool.execute(
      'SELECT imagem_url FROM usuario WHERE id = ?',
      [id]
    );

    if (usuarioAtual.length === 0) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ erro: 'Usuário não encontrado' });
    }

    let fotoUrl = usuarioAtual[0].imagem_url;

    if (req.file) {
      if (fotoUrl && fotoUrl !== DEFAULT_PROFILE_PHOTO) {
        const oldPhotoPath = path.join(__dirname, fotoUrl);
        if (fs.existsSync(oldPhotoPath)) {
          fs.unlinkSync(oldPhotoPath);
        }
      }

      fotoUrl = `/uploads/profile-photos/${req.file.filename}`;
    }

    const [result] = await pool.execute(
      'UPDATE usuario SET nome = ?, email = ?, senha = ?, imagem_url = ? WHERE id = ?',
      [nome, email, senha, fotoUrl, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: 'Usuário não encontrado' });
    }

    res.json({
      mensagem: 'Usuário atualizado com sucesso',
      fotoUrl: fotoUrl
    });
  } catch (erro) {
    console.error(erro);

    if (req.file) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({ erro: 'Erro ao atualizar usuário' });
  }
});

app.delete('/usuarios/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [usuario] = await pool.execute(
      'SELECT imagem_url FROM usuario WHERE id = ?',
      [id]
    );

    const [result] = await pool.execute('DELETE FROM usuario WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: 'Usuário não encontrado' });
    }

    if (usuario.length > 0 && usuario[0].imagem_url && usuario[0].imagem_url !== DEFAULT_PROFILE_PHOTO) {
      const photoPath = path.join(__dirname, usuario[0].imagem_url);
      if (fs.existsSync(photoPath)) {
        fs.unlinkSync(photoPath);
      }
    }

    res.json({ mensagem: 'Usuário deletado com sucesso' });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao deletar usuário' });
  }
});

// ============= ROTAS DE ESTABELECIMENTOS =============

app.get('/establishments', async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 5;
    const offset = (page - 1) * limit;

    const sql = `
      SELECT 
        id, dono_id, nome as name, description, rua, cidade as address, stado, pais, cep, phone,
        rating_avg, rating_count, mei, criado_em, updated_em, deletedo_em, imagem_url
      FROM establishments
      WHERE deletedo_em IS NULL
      ORDER BY rating_avg DESC, nome ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const [establishments] = await pool.query(sql);
    res.json(establishments);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar estabelecimentos' });
  }
});

app.get('/establishments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [establishments] = await pool.execute(
      `SELECT 
        id, dono_id, nome as name, description, rua, cidade, stado, pais, cep, phone, 
        rating_avg, rating_count, mei, criado_em, updated_em, imagem_url
      FROM establishments 
      WHERE id = ? AND deletedo_em IS NULL`,
      [id]
    );

    if (establishments.length === 0) {
      return res.status(404).json({ erro: 'Estabelecimento não encontrado' });
    }

    const est = establishments[0];
    const formatted = {
      id: est.id,
      name: est.name,
      img: est.imagem_url,
      address: `${est.rua}, ${est.cidade} - ${est.stado}`,
      rating: est.rating_avg || 0,
      description: est.description,
      phone: est.phone,
      ratingCount: est.rating_count || 0,
      fullAddress: {
        rua: est.rua,
        cidade: est.cidade,
        estado: est.stado,
        pais: est.pais,
        cep: est.cep
      }
    };

    res.json(formatted);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar estabelecimento' });
  }
});

app.post('/establishments', uploadEstablishment.single('foto'), async (req, res) => {
  try {
    const { dono_id, nome, description, rua, cidade, stado, pais, cep, phone, mei } = req.body;

    if (!dono_id || !nome || !rua || !cidade || !stado || !cep) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ erro: 'Campos obrigatórios: dono_id, nome, rua, cidade, stado, cep' });
    }

    let imagemUrl = DEFAULT_ESTABLISHMENT_PHOTO;
    if (req.file) {
      imagemUrl = `/uploads/establishment-photos/${req.file.filename}`;
    }

    const meiTratado = (mei === '' || mei === null || mei === undefined) ? 0 : parseInt(mei);
    const [result] = await pool.execute(
      `INSERT INTO establishments 
       (dono_id, nome, description, rua, cidade, stado, pais, cep, phone, mei, rating_avg, rating_count, imagem_url) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)`,
      [dono_id, nome, description || null, rua, cidade, stado, pais || 'Brasil', cep, phone || null, meiTratado ?? 0, imagemUrl]
    );

    res.status(201).json({
      mensagem: 'Estabelecimento criado com sucesso',
      id: result.insertId,
      imagemUrl: imagemUrl
    });
  } catch (erro) {
    console.error(erro);

    if (req.file) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({ erro: 'Erro ao criar estabelecimento' });
  }
});

app.put('/establishments/:id', uploadEstablishment.single('foto'), async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, description, rua, cidade, stado, pais, cep, phone, mei } = req.body;

    const [estabelecimentoAtual] = await pool.execute(
      'SELECT imagem_url FROM establishments WHERE id = ? AND deletedo_em IS NULL',
      [id]
    );

    if (estabelecimentoAtual.length === 0) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ erro: 'Estabelecimento não encontrado' });
    }

    let imagemUrl = estabelecimentoAtual[0].imagem_url;

    if (req.file) {
      if (imagemUrl && imagemUrl !== DEFAULT_ESTABLISHMENT_PHOTO) {
        const oldPhotoPath = path.join(__dirname, imagemUrl);
        if (fs.existsSync(oldPhotoPath)) {
          fs.unlinkSync(oldPhotoPath);
        }
      }

      imagemUrl = `/uploads/establishment-photos/${req.file.filename}`;
    }

    const [result] = await pool.execute(
      `UPDATE establishments 
       SET nome = ?, description = ?, rua = ?, cidade = ?, stado = ?, pais = ?, cep = ?, phone = ?, mei = ?, imagem_url = ?, updated_em = NOW()
       WHERE id = ? AND deletedo_em IS NULL`,
      [nome, description, rua, cidade, stado, pais || 'Brasil', cep, phone, mei, imagemUrl, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: 'Estabelecimento não encontrado' });
    }

    res.json({
      mensagem: 'Estabelecimento atualizado com sucesso',
      imagemUrl: imagemUrl
    });
  } catch (erro) {
    console.error(erro);

    if (req.file) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({ erro: 'Erro ao atualizar estabelecimento' });
  }
});

app.delete('/establishments/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [estabelecimento] = await pool.execute(
      'SELECT imagem_url FROM establishments WHERE id = ? AND deletedo_em IS NULL',
      [id]
    );

    // Soft delete
    const [result] = await pool.execute(
      'UPDATE establishments SET deletedo_em = NOW() WHERE id = ? AND deletedo_em IS NULL',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: 'Estabelecimento não encontrado' });
    }

    // Opcional: deletar a foto físicamente
    if (estabelecimento.length > 0 && estabelecimento[0].imagem_url && estabelecimento[0].imagem_url !== DEFAULT_ESTABLISHMENT_PHOTO) {
      const photoPath = path.join(__dirname, estabelecimento[0].imagem_url);
      if (fs.existsSync(photoPath)) {
        fs.unlinkSync(photoPath);
      }
    }

    res.json({ mensagem: 'Estabelecimento deletado com sucesso' });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao deletar estabelecimento' });
  }
});
//==========================AGENDAMENTO=========================
const PLAN_PRICES = {
  1: 25.00, // Corte Simples
  2: 40.00, // Corte + Barba
  3: 60.00  // Pacote Premium
};

app.post('/agendamentos', async (req, res) => {
  try {
    const { usuario_id, estabelecimento_id, plano_id, proximo_pag, status, metodo_pagamento } = req.body;

    if (!usuario_id || !estabelecimento_id || !plano_id || !proximo_pag || !status) {
      return res.status(400).json({ erro: 'Todos os campos são obrigatórios' });
    }

    // 1. Obter ID do dono do estabelecimento (Barbeiro)
    const [estabelecimentos] = await pool.execute(
      'SELECT dono_id FROM establishments WHERE id = ?',
      [estabelecimento_id]
    );

    if (estabelecimentos.length === 0) {
      return res.status(404).json({ erro: 'Estabelecimento não encontrado' });
    }
    const barbeiroId = estabelecimentos[0].dono_id;

    // 2. Verificar conflito de horário na tabela agendamentos
    const [conflitos] = await pool.execute(`
      SELECT id FROM agendamentos 
      WHERE barbeiro_id = ? 
      AND data_hora = ? 
      AND status IN ('pendente', 'confirmado')
    `, [barbeiroId, proximo_pag]);

    if (conflitos.length > 0) {
      return res.status(409).json({
        erro: 'Este horário já está ocupado. Por favor, escolha outro horário.'
      });
    }

    // Iniciar transação
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // 3. Inserir em 'agendamentos'
      const [resultAgendamento] = await connection.execute(
        'INSERT INTO agendamentos (cliente_id, barbeiro_id, estabelecimento_id, data_hora, status, criado_em) VALUES (?, ?, ?, ?, ?, NOW())',
        [usuario_id, barbeiroId, estabelecimento_id, proximo_pag, 'pendente']
      );

      const agendamentoId = resultAgendamento.insertId;
      const valor = PLAN_PRICES[plano_id] || 0;
      const metodoId = metodo_pagamento || 1;

      // 4. Inserir Pagamento (usando agendamento_id)
      await connection.execute(
        `INSERT INTO pagamento 
        (inscricao_id, agendamento_id, usuario_id, estabelecimento_id, quantidade, cambio, metodo_id, status, criado_em) 
        VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [agendamentoId, usuario_id, estabelecimento_id, valor, 'BRL', metodoId, 'pendente']
      );

      await connection.commit();
      connection.release();

      res.status(201).json({ mensagem: 'Agendamento criado com sucesso', id: agendamentoId });

    } catch (err) {
      await connection.rollback();
      connection.release();
      throw err;
    }

  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao criar agendamento' });
  }
});

// Buscar agendamentos do usuário
app.get('/agendamentos', async (req, res) => {
  try {
    const { usuario_id } = req.query;

    if (!usuario_id) {
      return res.status(400).json({ erro: "usuario_id é obrigatório" });
    }

    const [rows] = await pool.execute(`
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
      LEFT JOIN usuario u ON u.id = a.cliente_id
      LEFT JOIN establishments e ON e.id = a.estabelecimento_id
      WHERE a.cliente_id = ?
      ORDER BY a.data_hora DESC
    `, [usuario_id]);

    console.log('Agendamentos retornados:', rows.length);
    console.log('Dados:', JSON.stringify(rows, null, 2));

    res.json(rows);

  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: "Erro ao buscar agendamentos" });
  }
});
app.get('/agendamentos/minha-barbearia', async (req, res) => {
  try {
    const { usuario_id } = req.query;
    if (!usuario_id) {
      return res.status(400).json({ erro: 'usuario_id é obrigatório' });
    }
    const [barbearias] = await pool.execute(
      'SELECT id, nome FROM establishments WHERE dono_id = ? AND deletedo_em IS NULL',
      [usuario_id]
    );

    if (!barbearias || barbearias.length === 0) {
      return res.json([]); // nenhuma barbearia -> sem agendamentos
    }
    const ids = barbearias.map(b => b.id);
    const placeholders = ids.map(() => '?').join(','); // '?, ?, ?'

    // 3) buscar os agendamentos para essas barbearias
    const [rows] = await pool.execute(
      `
      SELECT
        i.id,
      i.usuario_id,
      i.estabelecimento_id,
      i.plano_id,
      i.proxima_data_cobrança AS proximo_pag,
      i.status,
      u.nome AS usuario_nome,
      e.nome AS estabelecimento_nome
      FROM inscricoes i
      LEFT JOIN usuario u ON u.id = i.usuario_id
      LEFT JOIN establishments e ON e.id = i.estabelecimento_id
      WHERE i.estabelecimento_id IN(${placeholders})
      ORDER BY i.proxima_data_cobrança DESC
      `,
      ids
    );

    return res.json(rows);
  } catch (erro) {
    console.error('/agendamentos/minha-barbearia erro:', erro);
    return res.status(500).json({ erro: 'Erro ao buscar agendamentos da(s) barbearia(s)' });
  }
});

// Buscar horários disponíveis de um estabelecimento
app.get('/agendamentos/horarios-disponiveis/:estabelecimento_id', async (req, res) => {
  try {
    const { estabelecimento_id } = req.params;
    const { data } = req.query; // formato: YYYY-MM-DD

    if (!data) {
      return res.status(400).json({ erro: 'Data é obrigatória' });
    }

    // 1. Obter Barbeiro ID
    const [estabelecimentos] = await pool.execute(
      'SELECT dono_id FROM establishments WHERE id = ?',
      [estabelecimento_id]
    );

    if (estabelecimentos.length === 0) {
      return res.status(404).json({ erro: 'Estabelecimento não encontrado' });
    }
    const barbeiroId = estabelecimentos[0].dono_id;


    // Buscar todos os horários ocupados nesse dia
    const [ocupados] = await pool.execute(`
      SELECT data_hora 
      FROM agendamentos 
      WHERE barbeiro_id = ? 
      AND DATE(data_hora) = ?
      AND status IN ('pendente', 'confirmado')
    `, [barbeiroId, data]);

    const horariosOcupados = ocupados.map(row =>
      new Date(row.data_hora).toISOString()
    );

    res.json({ horariosOcupados });

  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar horários disponíveis' });
  }
});

// Cancelar agendamento
app.patch('/agendamentos/:id/cancelar', async (req, res) => {
  try {
    const { id } = req.params;
    const { usuario_id } = req.body;

    // Verificar se o agendamento pertence ao usuário
    const [agendamento] = await pool.execute(
      'SELECT * FROM agendamentos WHERE id = ? AND cliente_id = ?',
      [id, usuario_id]
    );

    if (agendamento.length === 0) {
      return res.status(404).json({ erro: 'Agendamento não encontrado' });
    }

    // Atualizar status para cancelado
    await pool.execute(
      'UPDATE agendamentos SET status = ? WHERE id = ?',
      ['cancelado', id]
    );

    res.json({ mensagem: 'Agendamento cancelado com sucesso' });

  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao cancelar agendamento' });
  }
});

// Reagendar agendamento
app.patch('/agendamentos/:id/reagendar', async (req, res) => {
  try {
    const { id } = req.params;
    const { usuario_id, nova_data } = req.body;

    if (!nova_data) {
      return res.status(400).json({ erro: 'Nova data é obrigatória' });
    }

    // Verificar se o agendamento pertence ao usuário
    const [agendamento] = await pool.execute(
      'SELECT * FROM agendamentos WHERE id = ? AND cliente_id = ?',
      [id, usuario_id]
    );

    if (agendamento.length === 0) {
      return res.status(404).json({ erro: 'Agendamento não encontrado' });
    }

    const barbeiroId = agendamento[0].barbeiro_id;

    // Verificar conflito no novo horário
    const [conflitos] = await pool.execute(`
      SELECT id FROM agendamentos 
      WHERE barbeiro_id = ? 
      AND data_hora = ? 
      AND status IN ('pendente', 'confirmado')
      AND id != ?
    `, [barbeiroId, nova_data, id]);

    if (conflitos.length > 0) {
      return res.status(409).json({
        erro: 'Este horário já está ocupado. Por favor, escolha outro horário.'
      });
    }

    // Atualizar data do agendamento
    await pool.execute(
      'UPDATE agendamentos SET data_hora = ? WHERE id = ?',
      [nova_data, id]
    );

    res.json({ mensagem: 'Agendamento reagendado com sucesso' });

  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao reagendar agendamento' });
  }
});


//==========================AVALIACAO=========================
app.post('/avaliacoes', async (req, res) => {
  try {
    const { usuario_id, estabelecimento_id, rating, comentario } = req.body;
    const [result] = await pool.execute(
      'INSERT INTO avaliacoes (usuario_id, id_estabelecimento, score, comment) VALUES (?, ?, ?, ?)',
      [usuario_id, estabelecimento_id, rating, comentario]
    );
    res.status(201).json({ mensagem: 'Avaliação criada com sucesso', id: result.insertId });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao criar avaliação' });
  }
})

// Pagar agendamento
app.patch('/agendamentos/:id/pagar', async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar se existe pagamento associado
    const [pagamento] = await pool.execute(
      'SELECT id FROM pagamento WHERE agendamento_id = ?',
      [id]
    );

    if (pagamento.length === 0) {
      return res.status(404).json({ erro: 'Pagamento não encontrado para este agendamento' });
    }

    // Atualizar pagamento para completo
    await pool.execute(
      `UPDATE pagamento 
       SET status = 'completo', pago_em = NOW() 
       WHERE agendamento_id = ?`,
      [id]
    );

    res.json({ mensagem: 'Pagamento confirmado com sucesso' });

  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao confirmar pagamento' });
  }
});

//==========================PLANOS (SUBSCRIPTION PLANS)=========================

// Criar plano (Admin)
app.post('/planos', async (req, res) => {
  try {
    const { estabelecimento_id, nome, description, preco, ciclo_pagamento, dias_freetrial } = req.body;

    if (!estabelecimento_id || !nome || !preco || !ciclo_pagamento) {
      return res.status(400).json({ erro: 'Campos obrigatórios: estabelecimento_id, nome, preco, ciclo_pagamento' });
    }

    const [result] = await pool.execute(
      `INSERT INTO planos 
       (estabelecimento_id, nome, description, preco, ciclo_pagamento, dias_freetrial, active, criado_em) 
       VALUES (?, ?, ?, ?, ?, ?, 1, NOW())`,
      [estabelecimento_id, nome, description || null, preco, ciclo_pagamento, dias_freetrial || 0]
    );

    res.status(201).json({ mensagem: 'Plano criado com sucesso', id: result.insertId });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao criar plano' });
  }
});

// Listar planos de um estabelecimento
app.get('/planos/estabelecimento/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [planos] = await pool.execute(
      `SELECT id, nome, description, preco, ciclo_pagamento, dias_freetrial, active, criado_em
       FROM planos 
       WHERE estabelecimento_id = ? AND deletado_em IS NULL
       ORDER BY criado_em DESC`,
      [id]
    );
    res.json(planos);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar planos' });
  }
});

// Listar todos os planos disponíveis
app.get('/planos/disponiveis', async (req, res) => {
  try {
    const [planos] = await pool.execute(
      `SELECT 
        p.id, p.nome, p.description, p.preco, p.ciclo_pagamento, p.dias_freetrial,
        p.estabelecimento_id, e.nome AS estabelecimento_nome
       FROM planos p
       LEFT JOIN establishments e ON e.id = p.estabelecimento_id
       WHERE p.active = 1 AND p.deletado_em IS NULL AND e.deletedo_em IS NULL
       ORDER BY p.nome, e.nome`
    );
    res.json(planos);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar planos disponíveis' });
  }
});

// Atualizar plano
app.put('/planos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, description, preco, ciclo_pagamento, dias_freetrial, active } = req.body;
    const [result] = await pool.execute(
      `UPDATE planos 
       SET nome = ?, description = ?, preco = ?, ciclo_pagamento = ?, 
           dias_freetrial = ?, active = ?, updated_em = NOW()
       WHERE id = ? AND deletado_em IS NULL`,
      [nome, description, preco, ciclo_pagamento, dias_freetrial, active, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: 'Plano não encontrado' });
    }
    res.json({ mensagem: 'Plano atualizado com sucesso' });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao atualizar plano' });
  }
});

// Deletar plano (soft delete)
app.delete('/planos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute(
      'UPDATE planos SET deletado_em = NOW() WHERE id = ? AND deletado_em IS NULL',
      [id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: 'Plano não encontrado' });
    }
    res.json({ mensagem: 'Plano deletado com sucesso' });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao deletar plano' });
  }
});

//==========================INSCRICOES (SUBSCRIPTIONS)=========================

// Assinar plano
app.post('/inscricoes', async (req, res) => {
  try {
    const { usuario_id, plano_id, pagamento_metodo_id } = req.body;

    if (!usuario_id || !plano_id) {
      return res.status(400).json({ erro: 'usuario_id e plano_id são obrigatórios' });
    }

    // Buscar informações do plano
    const [planos] = await pool.execute(
      'SELECT * FROM planos WHERE id = ? AND active = 1 AND deletado_em IS NULL',
      [plano_id]
    );

    if (planos.length === 0) {
      return res.status(404).json({ erro: 'Plano não encontrado ou inativo' });
    }

    const plano = planos[0];
    const hoje = new Date();
    const dataInicio = hoje.toISOString().split('T')[0];

    // Calcular próxima data de cobrança
    let proximaCobranca = new Date(hoje);
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
      }
    }

    const status = plano.dias_freetrial > 0 ? 'free trial' : 'ativo';

    const [result] = await pool.execute(
      `INSERT INTO inscricoes 
       (usuario_id, plano_id, estabelecimento_id, status, data_incio, proxima_data_cobrança, preço_periodo_atual, pagamento_metodo_id, criado_em) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [usuario_id, plano_id, plano.estabelecimento_id, status, dataInicio, proximaCobranca, plano.preco, pagamento_metodo_id || 1]
    );

    res.status(201).json({ mensagem: 'Inscrição criada com sucesso', id: result.insertId });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao criar inscrição' });
  }
});

// Buscar inscrições do usuário
app.get('/inscricoes/usuario/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [inscricoes] = await pool.execute(
      `SELECT 
        i.id, i.status, i.data_incio, i.proxima_data_cobrança, i.preço_periodo_atual,
        p.nome AS plano_nome, p.description AS plano_description, p.ciclo_pagamento,
        e.nome AS estabelecimento_nome
       FROM inscricoes i
       LEFT JOIN planos p ON p.id = i.plano_id
       LEFT JOIN establishments e ON e.id = i.estabelecimento_id
       WHERE i.usuario_id = ? AND i.status IN ('ativo', 'free trial', 'atrasado')
       ORDER BY i.criado_em DESC`,
      [id]
    );
    res.json(inscricoes);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar inscrições' });
  }
});

// Cancelar inscrição
app.patch('/inscricoes/:id/cancelar', async (req, res) => {
  try {
    const { id } = req.params;
    const { motivo } = req.body;

    const [result] = await pool.execute(
      `UPDATE inscricoes 
       SET status = 'cancelado', cancelado_por_user = 1, motivo_cancelamento = ?, updated_em = NOW()
       WHERE id = ?`,
      [motivo || null, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: 'Inscrição não encontrada' });
    }

    res.json({ mensagem: 'Inscrição cancelada com sucesso' });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao cancelar inscrição' });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);

  // Criar diretórios de upload se não existirem
  const dirs = [
    path.join(__dirname, 'uploads/profile-photos'),
    path.join(__dirname, 'uploads/establishment-photos')
  ];

  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Diretório criado: ${dir}`);
    }
  });
});