import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_PROJECT_URL } from '../config/constants';
import {
  ESTABLISHMENT_UPLOADS_DIR,
  PROFILE_UPLOADS_DIR,
} from '../config/paths';
import { ensureDir, resolveAppPath, safeUnlink } from '../utils/files';

type StorageKind = 'profile' | 'establishment';

const SUPABASE_URL = (process.env.SUPABASE_URL || SUPABASE_PROJECT_URL).replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  '';
const PROFILE_BUCKET = process.env.SUPABASE_STORAGE_PROFILE_BUCKET || 'profile-photos';
const ESTABLISHMENT_BUCKET = process.env.SUPABASE_STORAGE_ESTABLISHMENT_BUCKET || 'establishment-photos';
const SIGNED_URL_TTL_SECONDS = Number(process.env.SUPABASE_STORAGE_SIGNED_URL_TTL || 60 * 60 * 24 * 7);

let storageClient: SupabaseClient | null | undefined;

function inferExtension(file: Express.Multer.File) {
  const originalExtension = path.extname(file.originalname || '').toLowerCase();
  if (originalExtension) {
    return originalExtension;
  }

  const extensionByMimeType: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
  };

  return extensionByMimeType[file.mimetype] || '.bin';
}

function getStorageFolder(kind: StorageKind) {
  return kind === 'profile' ? PROFILE_UPLOADS_DIR : ESTABLISHMENT_UPLOADS_DIR;
}

function getBucketName(kind: StorageKind) {
  return kind === 'profile' ? PROFILE_BUCKET : ESTABLISHMENT_BUCKET;
}

function getObjectPrefix(kind: StorageKind) {
  return kind === 'profile' ? 'profiles' : 'establishments';
}

function isMissingBucketError(message: string | undefined) {
  const normalizedMessage = String(message || '').toLowerCase();
  return normalizedMessage.includes('bucket not found');
}

function buildLocalAssetPath(kind: StorageKind, filename: string) {
  return `/uploads/${kind === 'profile' ? 'profile-photos' : 'establishment-photos'}/${filename}`;
}

function getStorageClient() {
  if (storageClient !== undefined) {
    return storageClient;
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    storageClient = null;
    return storageClient;
  }

  storageClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return storageClient;
}

function isRemoteAssetUrl(assetUrl: string | null | undefined) {
  return /^https?:\/\//i.test(String(assetUrl || ''));
}

function extractObjectPath(assetUrl: string, bucketName: string) {
  const publicPrefix = `${SUPABASE_URL}/storage/v1/object/public/${bucketName}/`;
  const signedPrefix = `${SUPABASE_URL}/storage/v1/object/sign/${bucketName}/`;
  const normalizedUrl = assetUrl.split('?')[0];

  if (!assetUrl.startsWith(publicPrefix)) {
    if (!assetUrl.startsWith(signedPrefix)) {
      return null;
    }

    return decodeURIComponent(normalizedUrl.slice(signedPrefix.length));
  }

  return decodeURIComponent(normalizedUrl.slice(publicPrefix.length));
}

async function buildRemoteAssetUrl(
  client: SupabaseClient,
  bucketName: string,
  objectPath: string,
) {
  return client.storage.from(bucketName).getPublicUrl(objectPath).data.publicUrl;
}

async function buildSignedAssetUrl(
  client: SupabaseClient,
  bucketName: string,
  objectPath: string,
) {
  const { data, error } = await client.storage
    .from(bucketName)
    .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);

  if (!error && data?.signedUrl) {
    return data.signedUrl;
  }

  if (error) {
    console.warn(
      `Nao foi possivel gerar URL assinada para ${bucketName}/${objectPath}. Usando referencia original: ${error.message}`,
    );
  }

  return null;
}

async function uploadLocally(file: Express.Multer.File, kind: StorageKind) {
  ensureDir(getStorageFolder(kind));
  const filename = `${kind}-${Date.now()}-${Math.round(Math.random() * 1e9)}${inferExtension(file)}`;
  const absolutePath = path.join(getStorageFolder(kind), filename);
  await fs.writeFile(absolutePath, file.buffer);
  return buildLocalAssetPath(kind, filename);
}

async function uploadToSupabase(file: Express.Multer.File, kind: StorageKind) {
  const client = getStorageClient();

  if (!client) {
    return uploadLocally(file, kind);
  }

  const objectPath = `${getObjectPrefix(kind)}/${Date.now()}-${randomUUID()}${inferExtension(file)}`;
  const bucketName = getBucketName(kind);
  const { error } = await client.storage.from(bucketName).upload(objectPath, file.buffer, {
    contentType: file.mimetype,
    cacheControl: '3600',
    upsert: false,
  });

  if (error) {
    if (isMissingBucketError(error.message)) {
      console.warn(
        `Bucket "${bucketName}" nao encontrado no Supabase Storage. Fazendo fallback para upload local.`,
      );
      return uploadLocally(file, kind);
    }

    throw new Error(`Erro ao enviar imagem para o Supabase Storage: ${error.message}`);
  }

  return buildRemoteAssetUrl(client, bucketName, objectPath);
}

export async function uploadImageAsset(file: Express.Multer.File, kind: StorageKind) {
  return uploadToSupabase(file, kind);
}

export async function resolveImageAssetUrl(
  assetUrl: string | null | undefined,
  kind: StorageKind,
) {
  if (!assetUrl || !isRemoteAssetUrl(assetUrl)) {
    return assetUrl || null;
  }

  const client = getStorageClient();
  if (!client) {
    return assetUrl;
  }

  const bucketName = getBucketName(kind);
  const objectPath = extractObjectPath(assetUrl, bucketName);
  if (!objectPath) {
    return assetUrl;
  }

  return (await buildSignedAssetUrl(client, bucketName, objectPath)) || assetUrl;
}

export async function deleteImageAsset(
  assetUrl: string | null | undefined,
  kind: StorageKind,
  defaultAssetUrl: string,
) {
  if (!assetUrl || assetUrl === defaultAssetUrl) {
    return;
  }

  if (!isRemoteAssetUrl(assetUrl)) {
    safeUnlink(resolveAppPath(assetUrl));
    return;
  }

  const client = getStorageClient();
  if (!client) {
    return;
  }

  const bucketName = getBucketName(kind);
  const objectPath = extractObjectPath(assetUrl, bucketName);
  if (!objectPath) {
    return;
  }

  const { error } = await client.storage.from(bucketName).remove([objectPath]);
  if (error) {
    console.error(`Erro ao remover imagem do Supabase Storage (${bucketName}/${objectPath}):`, error.message);
  }
}

export function logStorageConfig() {
  const usingSupabaseStorage = Boolean(getStorageClient());

  if (usingSupabaseStorage) {
    console.log(
      `Uploads configurados para Supabase Storage (${PROFILE_BUCKET}, ${ESTABLISHMENT_BUCKET}) em ${SUPABASE_URL}`,
    );
    return;
  }

  console.warn(
    'SUPABASE_SERVICE_ROLE_KEY nao definido. Uploads de imagem continuarao em disco local; configure Supabase Storage para producao.',
  );
}
