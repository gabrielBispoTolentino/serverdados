import express from 'express';
import { DEFAULT_PROFILE_PHOTO } from '../config/constants';
import { pool } from '../config/database';
import { uploadProfile } from '../config/uploads';
import {
  ESTABLISHMENT_ADMIN_ROLE,
  findUsersByEmailOrCpf,
  findUsersByLogin,
  formatUser,
  getUserTable,
  parseUserRole,
  queryUnifiedUsers,
  resolveUserById,
} from '../services/users';
import { resolveAppPath, safeUnlink } from '../utils/files';

const router = express.Router();

router.post('/usuarios', uploadProfile.single('foto'), async (req, res) => {
  try {
    const { nome, email, senha, cpf, telefone, role, cnpj } = req.body;
    const parsedRole = parseUserRole(role);

    if (!nome || !email || !senha || !cpf || !telefone || !parsedRole) {
      safeUnlink(req.file?.path);
      return res.status(400).json({ erro: 'Todos os campos sao obrigatorios' });
    }

    if (parsedRole === ESTABLISHMENT_ADMIN_ROLE && !cnpj) {
      safeUnlink(req.file?.path);
      return res.status(400).json({ erro: 'CNPJ e obrigatorio para administradores de estabelecimento' });
    }

    const conflitos = await findUsersByEmailOrCpf(pool, { email, cpf });

    if (conflitos.length > 0) {
      safeUnlink(req.file?.path);
      return res.status(409).json({ erro: 'Ja existe um usuario cadastrado com este email ou CPF' });
    }

    const fotoUrl = req.file ? `/uploads/profile-photos/${req.file.filename}` : DEFAULT_PROFILE_PHOTO;
    const tabela = getUserTable(parsedRole);

    const insertSql =
      tabela === 'usuarioADM'
        ? 'INSERT INTO usuarioADM (email, senha, nome, cpf, telefone, role, imagem_url, cnpj) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        : 'INSERT INTO usuarioCliente (email, senha, nome, cpf, telefone, role, imagem_url) VALUES (?, ?, ?, ?, ?, ?, ?)';

    const insertParams =
      tabela === 'usuarioADM'
        ? [email, senha, nome, cpf, telefone, parsedRole, fotoUrl, cnpj]
        : [email, senha, nome, cpf, telefone, parsedRole, fotoUrl];

    const [, result] = await pool.execute(
      insertSql,
      insertParams,
    );

    res.status(201).json({
      mensagem: 'Usuario criado com sucesso',
      id: result.insertId,
      fotoUrl,
      role: parsedRole,
      userTable: tabela,
    });
  } catch (error) {
    console.error(error);
    safeUnlink(req.file?.path);
    res.status(500).json({ erro: 'Erro ao criar usuario' });
  }
});

router.get('/usuarios', async (_req, res) => {
  try {
    const roleQuery = typeof _req.query.role === 'string' ? _req.query.role : undefined;
    const parsedRole = roleQuery ? parseUserRole(roleQuery) : null;

    if (roleQuery && !parsedRole) {
      return res.status(400).json({ erro: 'Role informado e invalido' });
    }

    const usuarios = await queryUnifiedUsers(
      pool,
      parsedRole ? 'WHERE role = ? ORDER BY nome ASC' : 'ORDER BY nome ASC',
      parsedRole ? [parsedRole] : [],
    );

    res.json(
      usuarios.map((usuario) => ({
        ...formatUser(usuario),
        foto_url: usuario.imagem_url || null,
      })),
    );
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

    const usuarios = await findUsersByLogin(pool, usuario, senha);

    if (usuarios.length === 0) {
      return res.status(401).json({ erro: 'Credenciais invalidas' });
    }

    if (usuarios.length > 1) {
      return res.status(409).json({ erro: 'Ha mais de uma conta com estas credenciais. Informe o tipo de conta.' });
    }

    const usuarioLogado = usuarios[0];
    res.json({
      mensagem: 'Login realizado com sucesso',
      usuario: {
        ...formatUser(usuarioLogado),
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
    const { user, ambiguous, invalidRole } = await resolveUserById(pool, req.params.id, req.query.role);

    if (invalidRole) {
      return res.status(400).json({ erro: 'Role informado e invalido' });
    }

    if (ambiguous) {
      return res.status(409).json({ erro: 'Ha contas Cliente e ADM com o mesmo id. Informe o role na requisicao.' });
    }

    if (!user) {
      return res.status(404).json({ erro: 'Usuario nao encontrado' });
    }

    res.json({
      ...formatUser(user),
      foto_url: user.imagem_url || null,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar usuario' });
  }
});

router.put('/usuarios/:id', uploadProfile.single('foto'), async (req, res) => {
  try {
    const id = String(req.params.id);
    const { nome, email, senha, cpf, telefone, cnpj } = req.body;
    const roleHint = req.body.role ?? req.query.role;

    const { user: usuarioAtual, ambiguous, invalidRole } = await resolveUserById(pool, id, roleHint);

    if (invalidRole) {
      safeUnlink(req.file?.path);
      return res.status(400).json({ erro: 'Role informado e invalido' });
    }

    if (ambiguous) {
      safeUnlink(req.file?.path);
      return res.status(409).json({ erro: 'Ha contas Cliente e ADM com o mesmo id. Informe o role na requisicao.' });
    }

    if (!usuarioAtual) {
      safeUnlink(req.file?.path);
      return res.status(404).json({ erro: 'Usuario nao encontrado' });
    }

    let fotoUrl = usuarioAtual.imagem_url;

    if (req.file) {
      if (fotoUrl && fotoUrl !== DEFAULT_PROFILE_PHOTO) {
        safeUnlink(resolveAppPath(fotoUrl));
      }
      fotoUrl = `/uploads/profile-photos/${req.file.filename}`;
    }

    const proximoEmail = email ?? usuarioAtual.email;
    const proximoCpf = cpf ?? usuarioAtual.cpf;
    const conflitos = await findUsersByEmailOrCpf(pool, {
      email: proximoEmail,
      cpf: proximoCpf,
      exclude: {
        id,
        sourceTable: usuarioAtual.source_table,
      },
    });

    if (conflitos.length > 0) {
      safeUnlink(req.file?.path);
      return res.status(409).json({ erro: 'Ja existe um usuario cadastrado com este email ou CPF' });
    }

    const tabela = usuarioAtual.source_table;
    const nomeAtualizado = nome ?? usuarioAtual.nome;
    const senhaAtualizada = senha ?? usuarioAtual.senha;
    const telefoneAtualizado = telefone ?? usuarioAtual.telefone;

    const updateSql =
      tabela === 'usuarioADM'
        ? 'UPDATE usuarioADM SET nome = ?, email = ?, senha = ?, cpf = ?, telefone = ?, imagem_url = ?, cnpj = ? WHERE id = ?'
        : 'UPDATE usuarioCliente SET nome = ?, email = ?, senha = ?, cpf = ?, telefone = ?, imagem_url = ? WHERE id = ?';

    const updateParams =
      tabela === 'usuarioADM'
        ? [
            nomeAtualizado,
            proximoEmail,
            senhaAtualizada,
            proximoCpf,
            telefoneAtualizado,
            fotoUrl,
            cnpj ?? usuarioAtual.cnpj ?? null,
            id,
          ]
        : [nomeAtualizado, proximoEmail, senhaAtualizada, proximoCpf, telefoneAtualizado, fotoUrl, id];

    const [, result] = await pool.execute(
      updateSql,
      updateParams,
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
    const id = String(req.params.id);
    const roleHint = req.body?.role ?? req.query.role;
    const { user: usuario, ambiguous, invalidRole } = await resolveUserById(pool, id, roleHint);

    if (invalidRole) {
      return res.status(400).json({ erro: 'Role informado e invalido' });
    }

    if (ambiguous) {
      return res.status(409).json({ erro: 'Ha contas Cliente e ADM com o mesmo id. Informe o role na requisicao.' });
    }

    if (!usuario) {
      return res.status(404).json({ erro: 'Usuario nao encontrado' });
    }

    const tabela = usuario.source_table;
    const [, result] = await pool.execute(`DELETE FROM ${tabela} WHERE id = ?`, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: 'Usuario nao encontrado' });
    }

    if (usuario.imagem_url && usuario.imagem_url !== DEFAULT_PROFILE_PHOTO) {
      safeUnlink(resolveAppPath(usuario.imagem_url));
    }

    res.json({ mensagem: 'Usuario deletado com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao deletar usuario' });
  }
});

export default router;
