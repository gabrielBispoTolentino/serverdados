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
app.post('/agendamentos', async (req, res) => {
  try{
    const { usuario_id, estabelecimento_id, plano_id, proximo_pag, status } = req.body;
    if (!usuario_id || !estabelecimento_id || !plano_id || !proximo_pag || !status) {
      return res.status(400).json({ erro: 'Todos os campos são obrigatórios' });
    }
    const [result] = await pool.execute(
      'INSERT INTO inscricoes (usuario_id, estabelecimento_id, plano_id, proxima_data_cobrança, status) VALUES (?, ?, ?, ?, ?)',
      [usuario_id, estabelecimento_id, plano_id, proximo_pag, status]
    );
    res.status(201).json({ mensagem: 'Agendamento criado com sucesso', id: result.insertId });
  }catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao criar agendamento' });
  }})
  app.get('/agendamentos', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT 
        i.id,
        i.usuario_id,
        i.estabelecimento_id,
        i.plano_id,
        i.proxima_data_cobrança,
        i.status,
        u.nome AS usuario_nome,
        e.nome AS estabelecimento_nome
      FROM inscricoes i
      LEFT JOIN usuario u ON u.id = i.usuario_id
      LEFT JOIN establishments e ON e.id = i.estabelecimento_id
      ORDER BY i.id DESC
    `);

    res.json(rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: "Erro ao buscar agendamentos" });
  }
});

//==========================AVALIACAO=========================
app.post('/avaliacoes', async (req, res) => {
  try{
    const { usuario_id, estabelecimento_id, rating, comentario } = req.body;
    const [result] = await pool.execute(
      'INSERT INTO avaliacoes (usuario_id, id_estabelecimento, score, comment) VALUES (?, ?, ?, ?)',
      [usuario_id, estabelecimento_id, rating, comentario]
    );
    res.status(201).json({ mensagem: 'Avaliação criada com sucesso', id: result.insertId });
  }catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao criar avaliação' });
  }})
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