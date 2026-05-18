import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
const HASH_PREFIX = 'scrypt';
const SCRYPT_PARAMS = {
  cost: 16384,
  blockSize: 8,
  parallelization: 1,
  keyLength: 64,
};

function encode(value: Buffer) {
  return value.toString('base64url');
}

function decode(value: string) {
  return Buffer.from(value, 'base64url');
}

function deriveKey(password: string, salt: Buffer, keyLength: number, cost: number, blockSize: number, parallelization: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keyLength, { N: cost, r: blockSize, p: parallelization }, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });
}

export function isPasswordHash(value: string | null | undefined) {
  return typeof value === 'string' && value.startsWith(`${HASH_PREFIX}$`);
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derivedKey = await deriveKey(
    password,
    salt,
    SCRYPT_PARAMS.keyLength,
    SCRYPT_PARAMS.cost,
    SCRYPT_PARAMS.blockSize,
    SCRYPT_PARAMS.parallelization,
  );

  return [
    HASH_PREFIX,
    SCRYPT_PARAMS.cost,
    SCRYPT_PARAMS.blockSize,
    SCRYPT_PARAMS.parallelization,
    encode(salt),
    encode(derivedKey),
  ].join('$');
}

export async function verifyPassword(password: string, storedPassword: string) {
  if (!isPasswordHash(storedPassword)) {
    return {
      valid: password === storedPassword,
      needsRehash: password === storedPassword,
    };
  }

  const [prefix, cost, blockSize, parallelization, encodedSalt, encodedHash] = storedPassword.split('$');

  if (prefix !== HASH_PREFIX || !cost || !blockSize || !parallelization || !encodedSalt || !encodedHash) {
    return { valid: false, needsRehash: false };
  }

  let storedHash: Buffer;
  let derivedKey: Buffer;

  try {
    storedHash = decode(encodedHash);
    derivedKey = await deriveKey(
      password,
      decode(encodedSalt),
      storedHash.length,
      Number(cost),
      Number(blockSize),
      Number(parallelization),
    );
  } catch {
    return { valid: false, needsRehash: false };
  }

  if (storedHash.length !== derivedKey.length) {
    return { valid: false, needsRehash: false };
  }

  const usesCurrentParams =
    Number(cost) === SCRYPT_PARAMS.cost &&
    Number(blockSize) === SCRYPT_PARAMS.blockSize &&
    Number(parallelization) === SCRYPT_PARAMS.parallelization &&
    storedHash.length === SCRYPT_PARAMS.keyLength;

  return {
    valid: timingSafeEqual(storedHash, derivedKey),
    needsRehash: !usesCurrentParams,
  };
}
