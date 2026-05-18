import type { DatabaseExecutor } from '../config/database';

export const CLIENT_ROLE = 'Cliente';
export const ESTABLISHMENT_ADMIN_ROLE = 'ADM_Estabelecimento';
export const PLATFORM_ADMIN_ROLE = 'ADM_Plataforma';
export const BARBER_ROLE = 'Barbeiro';
export const BARBER_SUBTYPE_TABLE = 'usuarioBarber';

export type UserRole =
  | typeof CLIENT_ROLE
  | typeof ESTABLISHMENT_ADMIN_ROLE
  | typeof PLATFORM_ADMIN_ROLE
  | typeof BARBER_ROLE;

export type UserSubtypeTable = 'usuarioCliente' | 'usuarioADM' | typeof BARBER_SUBTYPE_TABLE;

export interface UnifiedUser {
  id: number;
  email: string;
  senha: string;
  nome: string;
  cpf: string;
  telefone: string;
  role: string;
  imagem_url: string | null;
  cnpj?: string | null;
  idbarberworker?: number | null;
  verifycode?: string | null;
  verified?: boolean | null;
  user_table?: UserSubtypeTable | null;
  barbershop_plan_id?: number | null;
  barbershop_plan_code?: string | null;
  barbershop_plan_name?: string | null;
  barbershop_plan_price?: number | null;
  barbershop_plan_billing_cycle?: string | null;
}

const BASE_USER_SELECT = `
  SELECT
    u.id,
    u.email,
    u.senha,
    u.nome,
    u.cpf,
    u.telefone,
    u.role,
    u.imagem_url,
    ua.cnpj,
    ua.barbershop_plan_id,
    bpt.code AS barbershop_plan_code,
    bpt.name AS barbershop_plan_name,
    bpt.price AS barbershop_plan_price,
    bpt.billing_cycle AS barbershop_plan_billing_cycle,
    ub.idbarberworker,
    u.verifycode AS verifycode,
    u.verified AS verified,
    CASE
      WHEN u.role = 'Barbeiro' THEN 'usuarioBarber'
      WHEN u.role = 'Cliente' THEN 'usuarioCliente'
      WHEN u.role = 'ADM_Estabelecimento' THEN 'usuarioADM'
      ELSE NULL
    END::text AS user_table
  FROM usuario u
  LEFT JOIN usuarioCliente uc ON uc.usuario_id = u.id
  LEFT JOIN usuarioADM ua ON ua.usuario_id = u.id
  LEFT JOIN barbershop_plan_types bpt ON bpt.id = ua.barbershop_plan_id
  LEFT JOIN usuarioBarber ub ON ub.usuario_id = u.id
`;

const ACTIVE_USER_CONDITION = `
  (
    ub.usuario_id IS NOT NULL
    OR uc.usuario_id IS NOT NULL
    OR ua.usuario_id IS NOT NULL
  )
`;

function withActiveUsers(whereClause = '') {
  const trimmed = whereClause.trim();

  if (!trimmed) {
    return `WHERE ${ACTIVE_USER_CONDITION}`;
  }

  if (/^where\b/i.test(trimmed)) {
    const trailingClauseMatch = trimmed.match(/\b(GROUP\s+BY|ORDER\s+BY|LIMIT|OFFSET)\b/i);

    if (!trailingClauseMatch || trailingClauseMatch.index === undefined) {
      return `${trimmed} AND ${ACTIVE_USER_CONDITION}`;
    }

    const conditions = trimmed.slice(0, trailingClauseMatch.index).trimEnd();
    const trailingClause = trimmed.slice(trailingClauseMatch.index);

    return `${conditions} AND ${ACTIVE_USER_CONDITION} ${trailingClause}`;
  }

  return `WHERE ${ACTIVE_USER_CONDITION} ${trimmed}`;
}

export function parseUserRole(value: unknown): UserRole | null {
  if (value === CLIENT_ROLE || value === ESTABLISHMENT_ADMIN_ROLE || value === PLATFORM_ADMIN_ROLE || value === BARBER_ROLE) {
    return value;
  }

  return null;
}

export function getUserSubtypeTable(role: UserRole): UserSubtypeTable | null {
  if (role === CLIENT_ROLE) {
    return 'usuarioCliente';
  }

  if (role === ESTABLISHMENT_ADMIN_ROLE) {
    return 'usuarioADM';
  }

  if (role === BARBER_ROLE) {
    return 'usuarioBarber';
  }

  return null;
}

export function formatUser(user: Partial<UnifiedUser> & { role?: string | null; user_table?: string | null }) {
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    cpf: user.cpf,
    telefone: user.telefone,
    role: user.role,
    fotoUrl: user.imagem_url || null,
    imagem_url: user.imagem_url || null,
    cnpj: user.cnpj ?? null,
    barbershopPlanId: user.barbershop_plan_id ?? null,
    barbershopPlanCode: user.barbershop_plan_code ?? null,
    barbershopPlanName: user.barbershop_plan_name ?? null,
    barbershopPlanPrice: user.barbershop_plan_price ?? null,
    barbershopPlanBillingCycle: user.barbershop_plan_billing_cycle ?? null,
    idbarberworker: user.idbarberworker ?? null,
    verifycode: user.verifycode ?? null,
    verified: user.verified ?? false,
    userTable: user.user_table ?? null,
  };
}

export async function queryUsers(
  pool: DatabaseExecutor,
  whereClause = '',
  params: Array<string | number | boolean | Date | null | undefined> = [],
) {
  const [rows] = await pool.execute<UnifiedUser>(
    `
    ${BASE_USER_SELECT}
    ${withActiveUsers(whereClause)}
  `,
    params,
  );

  return rows;
}

export async function resolveUserById(pool: DatabaseExecutor, id: string | number) {
  const [rows] = await pool.execute<UnifiedUser>(
    `
    ${BASE_USER_SELECT}
    WHERE u.id = ?
      AND ${ACTIVE_USER_CONDITION}
    `,
    [id],
  );

  return rows[0] ?? null;
}

export async function findUsersByLogin(
  pool: DatabaseExecutor,
  login: string,
) {
  return queryUsers(
    pool,
    'WHERE (u.email = ? OR u.cpf = ?) LIMIT 1',
    [login, login],
  );
}

export async function findUsersByEmailOrCpf(
  pool: DatabaseExecutor,
  {
    email,
    cpf,
    excludeId,
  }: {
    email?: string | null;
    cpf?: string | null;
    excludeId?: string | number | null;
  },
) {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (email) {
    conditions.push('u.email = ?');
    params.push(email);
  }

  if (cpf) {
    conditions.push('u.cpf = ?');
    params.push(cpf);
  }

  if (conditions.length === 0) {
    return [];
  }

  let whereClause = `WHERE (${conditions.join(' OR ')})`;

  if (excludeId !== undefined && excludeId !== null) {
    whereClause += ' AND u.id <> ?';
    params.push(excludeId);
  }

  return queryUsers(pool, whereClause, params);
}

export async function findUserByEmail(pool: DatabaseExecutor, email: string) {
  const [rows] = await pool.execute<UnifiedUser>(
    `
    ${BASE_USER_SELECT}
    WHERE u.email = ?
      AND ${ACTIVE_USER_CONDITION}
    LIMIT 1
    `,
    [email],
  );

  return rows[0] ?? null;
}

export async function findAdminByCnpj(
  pool: DatabaseExecutor,
  {
    cnpj,
    excludeId,
  }: {
    cnpj?: string | null;
    excludeId?: string | number | null;
  },
) {
  if (!cnpj) {
    return [];
  }

  let whereClause = 'WHERE ua.cnpj = ?';
  const params: Array<string | number> = [cnpj];

  if (excludeId !== undefined && excludeId !== null) {
    whereClause += ' AND u.id <> ?';
    params.push(excludeId);
  }

  return queryUsers(pool, whereClause, params);
}

export async function findClientById(pool: DatabaseExecutor, id: string | number) {
  const [rows] = await pool.execute<UnifiedUser>(
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
      NULL::bigint AS idbarberworker,
      NULL::text AS verifycode,
      NULL::boolean AS verified,
      'usuarioCliente'::text AS user_table
    FROM usuario u
    INNER JOIN usuarioCliente uc ON uc.usuario_id = u.id
    WHERE u.id = ?
    `,
    [id],
  );

  return rows[0] ?? null;
}

export async function findAdminById(pool: DatabaseExecutor, id: string | number) {
  const [rows] = await pool.execute<UnifiedUser>(
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
      ua.cnpj,
      NULL::bigint AS idbarberworker,
      NULL::text AS verifycode,
      NULL::boolean AS verified,
      'usuarioADM'::text AS user_table
    FROM usuario u
    INNER JOIN usuarioADM ua ON ua.usuario_id = u.id
    WHERE u.id = ?
    `,
    [id],
  );

  return rows[0] ?? null;
}
