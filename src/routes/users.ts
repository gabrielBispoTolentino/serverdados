import express from 'express';
import { DEFAULT_PROFILE_PHOTO } from '../config/constants';
import { pool } from '../config/database';
import { uploadProfile } from '../config/uploads';
import {
  BARBER_SUBTYPE_TABLE,
  CLIENT_ROLE,
  ESTABLISHMENT_ADMIN_ROLE,
  findUsersByEmailOrCpf,
  findUsersByLogin,
  formatUser,
  getUserSubtypeTable,
  parseUserRole,
  queryUsers,
  resolveUserById,
} from '../services/users';
import { resolveAppPath, safeUnlink } from '../utils/files';

const router = express.Router();

async function resolveOwnedEstablishment(establishmentId: string, adminUserId: string) {
  const [rows] = await pool.execute(
    `
    SELECT id, nome
    FROM establishments
    WHERE id = ? AND dono_id = ? AND deletedo_em IS NULL
    `,
    [establishmentId, adminUserId],
  );

  return rows[0] ?? null;
}

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

    const subtypeTable = getUserSubtypeTable(parsedRole);

    if (!subtypeTable) {
      safeUnlink(req.file?.path);
      return res.status(400).json({ erro: 'Tipo de usuario ainda nao suportado nesta operacao' });
    }

    const conflitos = await findUsersByEmailOrCpf(pool, { email, cpf });

    if (conflitos.length > 0) {
      safeUnlink(req.file?.path);
      return res.status(409).json({ erro: 'Ja existe um usuario cadastrado com este email ou CPF' });
    }

    const fotoUrl = req.file ? `/uploads/profile-photos/${req.file.filename}` : DEFAULT_PROFILE_PHOTO;
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const [, result] = await connection.execute(
        'INSERT INTO usuario (email, senha, nome, cpf, telefone, role, imagem_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [email, senha, nome, cpf, telefone, parsedRole, fotoUrl],
      );

      const userId = result.insertId;

      if (subtypeTable === 'usuarioADM') {
        await connection.execute(
          'INSERT INTO usuarioADM (usuario_id, role, cnpj) VALUES (?, ?, ?) RETURNING usuario_id',
          [userId, parsedRole, cnpj],
        );
      } else {
        await connection.execute(
          'INSERT INTO usuarioCliente (usuario_id, role) VALUES (?, ?) RETURNING usuario_id',
          [userId, parsedRole],
        );
      }

      await connection.commit();
      connection.release();

      res.status(201).json({
        mensagem: 'Usuario criado com sucesso',
        id: userId,
        fotoUrl,
        role: parsedRole,
        userTable: subtypeTable,
      });
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
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

    const usuarios = await queryUsers(
      pool,
      parsedRole ? 'WHERE u.role = ? ORDER BY u.nome ASC' : 'ORDER BY u.nome ASC',
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

router.get('/establishments/:id/barbers', async (req, res) => {
  try {
    const establishmentId = String(req.params.id);
    const adminUserId =
      typeof req.query.admin_user_id === 'string' ? req.query.admin_user_id.trim() : '';

    if (!adminUserId) {
      return res.status(400).json({ erro: 'admin_user_id e obrigatorio' });
    }

    const estabelecimento = await resolveOwnedEstablishment(establishmentId, adminUserId);

    if (!estabelecimento) {
      return res.status(404).json({ erro: 'Estabelecimento nao encontrado para este administrador' });
    }

    const [barbers] = await pool.execute(
      `
      SELECT
        u.id,
        u.email,
        u.senha,
        u.nome,
        u.cpf,
        u.telefone,
        u.role,
        u.imagem_url,
        NULL::text AS cnpj,
        ub.idbarberworker,
        'usuarioBarber'::text AS user_table
      FROM usuario u
      INNER JOIN usuarioBarber ub ON ub.usuario_id = u.id
      WHERE ub.idbarberworker = ?
      ORDER BY u.nome ASC
      `,
      [establishmentId],
    );

    res.json(barbers.map((barber) => formatUser(barber)));
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar barbeiros' });
  }
});

router.post('/establishments/:id/barbers', async (req, res) => {
  try {
    const establishmentId = String(req.params.id);
    const { admin_user_id, nome, email, senha, cpf, telefone } = req.body;

    if (!admin_user_id || !nome || !email || !senha || !cpf || !telefone) {
      return res.status(400).json({ erro: 'Todos os campos sao obrigatorios' });
    }

    const estabelecimento = await resolveOwnedEstablishment(establishmentId, String(admin_user_id));

    if (!estabelecimento) {
      return res.status(404).json({ erro: 'Estabelecimento nao encontrado para este administrador' });
    }

    const conflitos = await findUsersByEmailOrCpf(pool, { email, cpf });

    if (conflitos.length > 0) {
      return res.status(409).json({ erro: 'Ja existe um usuario cadastrado com este email ou CPF' });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const [, result] = await connection.execute(
        'INSERT INTO usuario (email, senha, nome, cpf, telefone, role, imagem_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [email, senha, nome, cpf, telefone, CLIENT_ROLE, DEFAULT_PROFILE_PHOTO],
      );

      const userId = result.insertId;

      await connection.execute(
        'INSERT INTO usuarioBarber (usuario_id, idbarberworker) VALUES (?, ?) RETURNING usuario_id',
        [userId, establishmentId],
      );

      await connection.commit();
      connection.release();

      const createdBarber = await resolveUserById(pool, userId);

      res.status(201).json({
        mensagem: 'Barbeiro criado com sucesso',
        id: userId,
        usuario: createdBarber ? formatUser(createdBarber) : null,
      });
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao criar barbeiro' });
  }
});

router.delete('/establishments/:id/barbers/:barberId', async (req, res) => {
  try {
    const establishmentId = String(req.params.id);
    const barberId = String(req.params.barberId);
    const adminUserId =
      typeof req.query.admin_user_id === 'string' ? req.query.admin_user_id.trim() : '';

    if (!adminUserId) {
      return res.status(400).json({ erro: 'admin_user_id e obrigatorio' });
    }

    const estabelecimento = await resolveOwnedEstablishment(establishmentId, adminUserId);

    if (!estabelecimento) {
      return res.status(404).json({ erro: 'Estabelecimento nao encontrado para este administrador' });
    }

    const barber = await resolveUserById(pool, barberId);

    if (!barber || barber.user_table !== BARBER_SUBTYPE_TABLE) {
      return res.status(404).json({ erro: 'Barbeiro nao encontrado' });
    }

    if (String(barber.idbarberworker) !== establishmentId) {
      return res.status(403).json({ erro: 'Este barbeiro nao pertence a esta barbearia' });
    }

    const [, result] = await pool.execute('DELETE FROM usuario WHERE id = ?', [barberId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: 'Barbeiro nao encontrado' });
    }

    if (barber.imagem_url && barber.imagem_url !== DEFAULT_PROFILE_PHOTO) {
      safeUnlink(resolveAppPath(barber.imagem_url));
    }

    res.json({ mensagem: 'Barbeiro deletado com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao deletar barbeiro' });
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
    const user = await resolveUserById(pool, req.params.id);

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
    const usuarioAtual = await resolveUserById(pool, id);

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
      excludeId: id,
    });

    if (conflitos.length > 0) {
      safeUnlink(req.file?.path);
      return res.status(409).json({ erro: 'Ja existe um usuario cadastrado com este email ou CPF' });
    }

    const nomeAtualizado = nome ?? usuarioAtual.nome;
    const senhaAtualizada = senha ?? usuarioAtual.senha;
    const telefoneAtualizado = telefone ?? usuarioAtual.telefone;
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const [, result] = await connection.execute(
        'UPDATE usuario SET nome = ?, email = ?, senha = ?, cpf = ?, telefone = ?, imagem_url = ?, updated_em = NOW() WHERE id = ?',
        [nomeAtualizado, proximoEmail, senhaAtualizada, proximoCpf, telefoneAtualizado, fotoUrl, id],
      );

      if (usuarioAtual.user_table === 'usuarioADM' && (cnpj !== undefined || usuarioAtual.cnpj !== undefined)) {
        await connection.execute(
          'UPDATE usuarioADM SET cnpj = ? WHERE usuario_id = ?',
          [cnpj ?? usuarioAtual.cnpj ?? null, id],
        );
      }

      await connection.commit();
      connection.release();

      if (result.affectedRows === 0) {
        return res.status(404).json({ erro: 'Usuario nao encontrado' });
      }

      res.json({
        mensagem: 'Usuario atualizado com sucesso',
        fotoUrl,
      });
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  } catch (error) {
    console.error(error);
    safeUnlink(req.file?.path);
    res.status(500).json({ erro: 'Erro ao atualizar usuario' });
  }
});

router.delete('/usuarios/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    const usuario = await resolveUserById(pool, id);

    if (!usuario) {
      return res.status(404).json({ erro: 'Usuario nao encontrado' });
    }

    const [, result] = await pool.execute('DELETE FROM usuario WHERE id = ?', [id]);

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
