import express from 'express';
import { randomBytes } from 'crypto';
import { DEFAULT_PROFILE_PHOTO } from '../config/constants';
import { pool } from '../config/database';
import { uploadProfile } from '../config/uploads';
import {
  BARBER_ROLE,
  BARBER_SUBTYPE_TABLE,
  CLIENT_ROLE,
  ESTABLISHMENT_ADMIN_ROLE,
  findAdminByCnpj,
  findUserByEmail,
  findUsersByEmailOrCpf,
  findUsersByLogin,
  formatUser,
  getUserSubtypeTable,
  parseUserRole,
  queryUsers,
  resolveUserById,
  UnifiedUser,
} from '../services/users';
import { safeUnlink } from '../utils/files';
import { deleteImageAsset, uploadImageAsset } from '../services/storage';
import { sendVerificationEmail, sendBarberInviteEmail } from '../services/email';

const router = express.Router();

function generateVerifyCode() {
  return randomBytes(4).toString('hex').toUpperCase();
}

type BarbershopPlanTypeRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  price: number | string;
  billing_cycle: string;
  max_barbers: number | null;
  max_establishments: number;
  active: boolean;
  sort_order: number;
};

async function resolveActiveBarbershopPlanType(planId: number) {
  const [rows] = await pool.execute<BarbershopPlanTypeRow>(
    `
    SELECT
      id,
      code,
      name,
      description,
      price,
      billing_cycle,
      max_barbers,
      max_establishments,
      active,
      sort_order
    FROM barbershop_plan_types
    WHERE id = ? AND active = TRUE
    LIMIT 1
    `,
    [planId],
  );

  return rows[0] ?? null;
}

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

function isPgErrorWithCode(
  error: unknown,
  code: string,
): error is { code: string; constraint?: string; detail?: string } {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === code;
}

router.get('/barbershop-plan-types', async (_req, res) => {
  try {
    const [rows] = await pool.execute<BarbershopPlanTypeRow>(
      `
      SELECT
        id,
        code,
        name,
        description,
        price,
        billing_cycle,
        max_barbers,
        max_establishments,
        active,
        sort_order
      FROM barbershop_plan_types
      WHERE active = TRUE
      ORDER BY sort_order ASC, price ASC, name ASC
      `,
    );

    res.json(
      rows.map((plan) => ({
        id: plan.id,
        code: plan.code,
        name: plan.name,
        description: plan.description,
        price: Number(plan.price),
        billingCycle: plan.billing_cycle,
        maxBarbers: plan.max_barbers,
        maxEstablishments: plan.max_establishments,
      })),
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar planos de conta da barbearia' });
  }
});

router.post('/usuarios', uploadProfile.single('foto'), async (req, res) => {
  let fotoUrlParaLimpeza: string | null = null;

  try {
    const { nome, email, senha, cpf, telefone, role, cnpj, barbershop_plan_id } = req.body;
    const parsedRole = parseUserRole(role);
    const normalizedCnpj = typeof cnpj === 'string' ? cnpj.trim() : '';

    if (!nome || !email || !senha || !cpf || !telefone || !parsedRole) {
      safeUnlink(req.file?.path);
      return res.status(400).json({ erro: 'Todos os campos sao obrigatorios' });
    }

    if (parsedRole === ESTABLISHMENT_ADMIN_ROLE && !normalizedCnpj) {
      safeUnlink(req.file?.path);
      return res.status(400).json({ erro: 'CNPJ e obrigatorio para administradores de estabelecimento' });
    }

    let selectedBarbershopPlanId: number | null = null;

    if (parsedRole === ESTABLISHMENT_ADMIN_ROLE) {
      selectedBarbershopPlanId = Number.parseInt(String(barbershop_plan_id || ''), 10);

      if (!Number.isInteger(selectedBarbershopPlanId) || selectedBarbershopPlanId <= 0) {
        safeUnlink(req.file?.path);
        return res.status(400).json({ erro: 'Plano da barbearia e obrigatorio para criar a conta' });
      }

      const planType = await resolveActiveBarbershopPlanType(selectedBarbershopPlanId);

      if (!planType) {
        safeUnlink(req.file?.path);
        return res.status(404).json({ erro: 'Plano da barbearia nao encontrado ou indisponivel' });
      }
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

    if (parsedRole === ESTABLISHMENT_ADMIN_ROLE) {
      const conflitosCnpj = await findAdminByCnpj(pool, { cnpj: normalizedCnpj });

      if (conflitosCnpj.length > 0) {
        safeUnlink(req.file?.path);
        return res.status(409).json({ erro: 'Ja existe um administrador cadastrado com este CNPJ' });
      }
    }

    const fotoUrl = req.file ? await uploadImageAsset(req.file, 'profile') : DEFAULT_PROFILE_PHOTO;
    fotoUrlParaLimpeza = req.file ? fotoUrl : null;
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const verifycode = generateVerifyCode();
      const [, result] = await connection.execute(
        'INSERT INTO usuario (email, senha, nome, cpf, telefone, role, imagem_url, verifycode, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [email, senha, nome, cpf, telefone, parsedRole, fotoUrl, verifycode, false],
      );
      sendVerificationEmail(email, nome, verifycode).catch((err) => {
        console.error("Erro ao enviar email:", err);
      });

      const userId = result.insertId;

      if (subtypeTable === 'usuarioADM') {
        await connection.execute(
          'INSERT INTO usuarioADM (usuario_id, role, cnpj, barbershop_plan_id, plan_selected_em) VALUES (?, ?, ?, ?, NOW()) RETURNING usuario_id',
          [userId, parsedRole, normalizedCnpj, selectedBarbershopPlanId],
        );
      } else {
        await connection.execute(
          'INSERT INTO usuarioCliente (usuario_id, role) VALUES (?, ?) RETURNING usuario_id',
          [userId, parsedRole],
        );
      }

      await connection.commit();
      connection.release();
      fotoUrlParaLimpeza = null;

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
    if (fotoUrlParaLimpeza) {
      await deleteImageAsset(fotoUrlParaLimpeza, 'profile', DEFAULT_PROFILE_PHOTO);
    }

    if (isPgErrorWithCode(error, '23505') && error.constraint === 'usuarioadm_cnpj_key') {
      return res.status(409).json({ erro: 'Ja existe um administrador cadastrado com este CNPJ' });
    }

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

    const [barbers] = await pool.execute<UnifiedUser>(
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
        u.verifycode,
        u.verified,
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

router.get('/establishments/:id/barbers/public', async (req, res) => {
  try {
    const establishmentId = String(req.params.id);

    const [estabelecimentos] = await pool.execute(
      'SELECT id FROM establishments WHERE id = ? AND deletedo_em IS NULL',
      [establishmentId],
    );

    if (estabelecimentos.length === 0) {
      return res.status(404).json({ erro: 'Estabelecimento nao encontrado' });
    }

    const [barbers] = await pool.execute<{ id: number; nome: string; imagem_url: string | null }>(
      `
      SELECT
        u.id,
        u.nome,
        u.imagem_url
      FROM usuario u
      INNER JOIN usuarioBarber ub ON ub.usuario_id = u.id
      WHERE ub.idbarberworker = ?
      ORDER BY u.nome ASC
      `,
      [establishmentId],
    );

    res.json(
      barbers.map((barber) => ({
        id: barber.id,
        nome: barber.nome,
        fotoUrl: barber.imagem_url || null,
        imagem_url: barber.imagem_url || null,
      })),
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar barbeiros do estabelecimento' });
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

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    let usuarioRemovido = false;

    try {
      const [, barberResult] = await connection.execute(
        'DELETE FROM usuarioBarber WHERE usuario_id = ? AND idbarberworker = ?',
        [barberId, establishmentId],
      );

      if (barberResult.affectedRows === 0) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({ erro: 'Barbeiro nao encontrado' });
      }

      const [agendamentos] = await connection.execute<{ total: number }>(
        'SELECT COUNT(*)::int AS total FROM agendamentos WHERE idbarbeiro = ?',
        [barberId],
      );

      if ((agendamentos[0]?.total ?? 0) === 0) {
        const [, userResult] = await connection.execute('DELETE FROM usuario WHERE id = ?', [barberId]);
        usuarioRemovido = userResult.affectedRows > 0;
      }

      await connection.commit();
      connection.release();
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }

    if (usuarioRemovido) {
      await deleteImageAsset(barber.imagem_url, 'profile', DEFAULT_PROFILE_PHOTO);
    }

    res.json({ mensagem: 'Barbeiro deletado com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao deletar barbeiro' });
  }
});


router.post('/verify', async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ erro: 'Email e codigo de verificacao sao obrigatorios' });
    }

    const usuario = await findUserByEmail(pool, String(email));

    if (!usuario) {
      return res.status(404).json({ erro: 'Usuario nao encontrado' });
    }

    if (usuario.verified) {
      return res.json({ mensagem: 'Usuario ja verificado' });
    }

    if (usuario.verifycode !== String(code).trim()) {
      return res.status(400).json({ erro: 'Codigo de verificacao invalido' });
    }

    await pool.execute('UPDATE usuario SET verified = ?, updated_em = NOW() WHERE id = ?', [true, usuario.id]);

    res.json({ mensagem: 'Usuario verificado com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao verificar usuario' });
  }
});

router.post('/resend-code', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ erro: 'Email e obrigatorio' });
    }

    const usuario = await findUserByEmail(pool, String(email));

    if (!usuario) {
      return res.status(404).json({ erro: 'Usuario nao encontrado' });
    }

    const verifycode = generateVerifyCode();
    await pool.execute('UPDATE usuario SET verifycode = ?, updated_em = NOW() WHERE id = ?', [verifycode, usuario.id]);
    await sendVerificationEmail(email, usuario.nome, verifycode);

    res.json({ mensagem: 'Codigo de verificacao reenviado com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao reenviar codigo de verificacao' });
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
  let uploadedPhotoUrl: string | null = null;

  try {
    const id = String(req.params.id);
    const { nome, email, senha, cpf, telefone, cnpj } = req.body;
    const usuarioAtual = await resolveUserById(pool, id);
    const normalizedCnpj = typeof cnpj === 'string' ? cnpj.trim() : cnpj;

    if (!usuarioAtual) {
      safeUnlink(req.file?.path);
      return res.status(404).json({ erro: 'Usuario nao encontrado' });
    }

    let fotoUrl = usuarioAtual.imagem_url;

    if (req.file) {
      uploadedPhotoUrl = await uploadImageAsset(req.file, 'profile');
      fotoUrl = uploadedPhotoUrl;
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

    if (usuarioAtual.user_table === 'usuarioADM') {
      const conflitosCnpj = await findAdminByCnpj(pool, {
        cnpj: typeof normalizedCnpj === 'string' ? normalizedCnpj : (usuarioAtual.cnpj ?? null),
        excludeId: id,
      });

      if (conflitosCnpj.length > 0) {
        safeUnlink(req.file?.path);
        return res.status(409).json({ erro: 'Ja existe um administrador cadastrado com este CNPJ' });
      }
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
          [normalizedCnpj ?? usuarioAtual.cnpj ?? null, id],
        );
      }

      await connection.commit();
      connection.release();
      uploadedPhotoUrl = null;

      if (req.file && usuarioAtual.imagem_url !== fotoUrl) {
        await deleteImageAsset(usuarioAtual.imagem_url, 'profile', DEFAULT_PROFILE_PHOTO);
      }

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
    if (uploadedPhotoUrl) {
      await deleteImageAsset(uploadedPhotoUrl, 'profile', DEFAULT_PROFILE_PHOTO);
    }

    if (isPgErrorWithCode(error, '23505') && error.constraint === 'usuarioadm_cnpj_key') {
      return res.status(409).json({ erro: 'Ja existe um administrador cadastrado com este CNPJ' });
    }

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

    await deleteImageAsset(usuario.imagem_url, 'profile', DEFAULT_PROFILE_PHOTO);

    res.json({ mensagem: 'Usuario deletado com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao deletar usuario' });
  }
});

router.post('/barber-signup/validate', async (req, res) => {
  try {
    const { barbercode } = req.body;

    if (!barbercode || typeof barbercode !== 'string') {
      return res.status(400).json({ erro: 'Codigo da barbearia e obrigatorio' });
    }

    const [rows] = await pool.execute(
      'SELECT id, nome FROM establishments WHERE barbercode = ? AND deletedo_em IS NULL LIMIT 1',
      [barbercode.trim().toUpperCase()],
    );

    if (rows.length === 0) {
      return res.status(404).json({ erro: 'Codigo da barbearia invalido' });
    }

    res.json({
      valid: true,
      establishment: {
        id: rows[0].id,
        nome: rows[0].nome,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao validar codigo da barbearia' });
  }
});

router.post('/barber-signup', async (req, res) => {
  try {
    const { barbercode, nome, email, senha, cpf, telefone } = req.body;

    if (!barbercode || !nome || !email || !senha || !cpf || !telefone) {
      return res.status(400).json({ erro: 'Todos os campos sao obrigatorios' });
    }

    const [estRows] = await pool.execute(
      'SELECT id, nome FROM establishments WHERE barbercode = ? AND deletedo_em IS NULL LIMIT 1',
      [String(barbercode).trim().toUpperCase()],
    );

    if (estRows.length === 0) {
      return res.status(404).json({ erro: 'Codigo da barbearia invalido' });
    }

    const establishmentId = estRows[0].id;

    const conflitos = await findUsersByEmailOrCpf(pool, { email, cpf });

    if (conflitos.length > 0) {
      return res.status(409).json({ erro: 'Ja existe um usuario cadastrado com este email ou CPF' });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const verifycode = generateVerifyCode();

      const [, result] = await connection.execute(
        'INSERT INTO usuario (email, senha, nome, cpf, telefone, role, imagem_url, verifycode, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [email, senha, nome, cpf, telefone, BARBER_ROLE, DEFAULT_PROFILE_PHOTO, verifycode, false],
      );

      const userId = result.insertId;

      await connection.execute(
        'INSERT INTO usuarioBarber (usuario_id, idbarberworker) VALUES (?, ?) RETURNING usuario_id',
        [userId, establishmentId],
      );

      sendVerificationEmail(email, nome, verifycode).catch((err) => {
        console.error('Erro ao enviar email de verificacao:', err);
      });

      await connection.commit();
      connection.release();

      const createdUser = await resolveUserById(pool, userId);

      res.status(201).json({
        mensagem: 'Conta de barbeiro criada com sucesso',
        id: userId,
        usuario: createdUser ? formatUser(createdUser) : null,
      });
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  } catch (error) {
    console.error(error);

    if (isPgErrorWithCode(error, '23505')) {
      return res.status(409).json({ erro: 'Ja existe um usuario cadastrado com este email ou CPF' });
    }

    res.status(500).json({ erro: 'Erro ao criar conta de barbeiro' });
  }
});

router.post('/barber-invite', async (req, res) => {
  try {
    const { admin_user_id, establishment_id, email } = req.body;

    if (!admin_user_id || !establishment_id || !email) {
      return res.status(400).json({ erro: 'admin_user_id, establishment_id e email sao obrigatorios' });
    }

    const estabelecimento = await resolveOwnedEstablishment(String(establishment_id), String(admin_user_id));

    if (!estabelecimento) {
      return res.status(404).json({ erro: 'Estabelecimento nao encontrado para este administrador' });
    }

    const [estRows] = await pool.execute(
      'SELECT barbercode, nome FROM establishments WHERE id = ? AND deletedo_em IS NULL',
      [establishment_id],
    );

    if (estRows.length === 0 || !estRows[0].barbercode) {
      return res.status(400).json({ erro: 'Estabelecimento nao possui codigo de barbeiro configurado' });
    }

    const barbercode = estRows[0].barbercode;
    const establishmentName = estRows[0].nome;
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
    const signupUrl = `${frontendUrl}/barber-signup?email=${encodeURIComponent(email)}`;

    await sendBarberInviteEmail(email, establishmentName, signupUrl);

    res.json({ mensagem: 'Convite enviado com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao enviar convite para barbeiro' });
  }
});

export default router;
