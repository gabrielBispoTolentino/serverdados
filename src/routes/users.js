const express = require('express');
const { pool } = require('../config/database');
const { uploadProfile } = require('../config/uploads');
const { DEFAULT_PROFILE_PHOTO } = require('../config/constants');
const { resolveAppPath, safeUnlink } = require('../utils/files');

const router = express.Router();

router.post('/usuarios', uploadProfile.single('foto'), async (req, res) => {
  try {
    const {
      nome,
      email,
      senha,
      cpf,
      telefone,
      role,
    } = req.body;

    if (!nome || !email || !senha || !cpf || !telefone || !role) {
      safeUnlink(req.file?.path);
      return res.status(400).json({ erro: 'Todos os campos sao obrigatorios' });
    }

    const fotoUrl = req.file
      ? `/uploads/profile-photos/${req.file.filename}`
      : DEFAULT_PROFILE_PHOTO;

    const [, result] = await pool.execute(
      'INSERT INTO usuario (email, senha, nome, cpf, telefone, role, imagem_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [email, senha, nome, cpf, telefone, role, fotoUrl],
    );

    res.status(201).json({
      mensagem: 'Usuario criado com sucesso',
      id: result.insertId,
      fotoUrl,
    });
  } catch (error) {
    console.error(error);
    safeUnlink(req.file?.path);
    res.status(500).json({ erro: 'Erro ao criar usuario' });
  }
});

router.get('/usuarios', async (req, res) => {
  try {
    const [usuarios] = await pool.execute(
      'SELECT id, nome, email, imagem_url AS foto_url FROM usuario',
    );
    res.json(usuarios);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar usuarios' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { usuario, senha } = req.body;

    if (!usuario || !senha) {
      return res.status(400).json({ erro: 'Usuario e senha sao obrigatorios' });
    }

    const [usuarios] = await pool.execute(
      'SELECT id, nome, email, cpf, telefone, role, imagem_url FROM usuario WHERE (email = ? OR cpf = ?) AND senha = ?',
      [usuario, usuario, senha],
    );

    if (usuarios.length === 0) {
      return res.status(401).json({ erro: 'Credenciais invalidas' });
    }

    const usuarioLogado = usuarios[0];
    res.json({
      mensagem: 'Login realizado com sucesso',
      usuario: {
        id: usuarioLogado.id,
        nome: usuarioLogado.nome,
        email: usuarioLogado.email,
        role: usuarioLogado.role,
        fotoUrl: usuarioLogado.imagem_url || DEFAULT_PROFILE_PHOTO,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao realizar login' });
  }
});

router.get('/usuarios/:id', async (req, res) => {
  try {
    const [usuarios] = await pool.execute(
      'SELECT id, nome, email, imagem_url AS foto_url FROM usuario WHERE id = ?',
      [req.params.id],
    );

    if (usuarios.length === 0) {
      return res.status(404).json({ erro: 'Usuario nao encontrado' });
    }

    res.json(usuarios[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar usuario' });
  }
});

router.put('/usuarios/:id', uploadProfile.single('foto'), async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, email, senha } = req.body;

    const [usuarioAtual] = await pool.execute(
      'SELECT imagem_url FROM usuario WHERE id = ?',
      [id],
    );

    if (usuarioAtual.length === 0) {
      safeUnlink(req.file?.path);
      return res.status(404).json({ erro: 'Usuario nao encontrado' });
    }

    let fotoUrl = usuarioAtual[0].imagem_url;

    if (req.file) {
      if (fotoUrl && fotoUrl !== DEFAULT_PROFILE_PHOTO) {
        safeUnlink(resolveAppPath(fotoUrl));
      }
      fotoUrl = `/uploads/profile-photos/${req.file.filename}`;
    }

    const [, result] = await pool.execute(
      'UPDATE usuario SET nome = ?, email = ?, senha = ?, imagem_url = ? WHERE id = ?',
      [nome, email, senha, fotoUrl, id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: 'Usuario nao encontrado' });
    }

    res.json({
      mensagem: 'Usuario atualizado com sucesso',
      fotoUrl,
    });
  } catch (error) {
    console.error(error);
    safeUnlink(req.file?.path);
    res.status(500).json({ erro: 'Erro ao atualizar usuario' });
  }
});

router.delete('/usuarios/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [usuario] = await pool.execute(
      'SELECT imagem_url FROM usuario WHERE id = ?',
      [id],
    );

    const [, result] = await pool.execute(
      'DELETE FROM usuario WHERE id = ?',
      [id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: 'Usuario nao encontrado' });
    }

    if (usuario.length > 0 && usuario[0].imagem_url && usuario[0].imagem_url !== DEFAULT_PROFILE_PHOTO) {
      safeUnlink(resolveAppPath(usuario[0].imagem_url));
    }

    res.json({ mensagem: 'Usuario deletado com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao deletar usuario' });
  }
});

module.exports = router;
