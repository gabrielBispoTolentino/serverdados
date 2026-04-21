import express from 'express';
import { DEFAULT_ESTABLISHMENT_PHOTO } from '../config/constants';
import { pool } from '../config/database';
import { uploadEstablishment } from '../config/uploads';
import { findAdminById } from '../services/users';
import { deleteImageAsset, resolveImageAssetUrl, uploadImageAssetPath } from '../services/storage';

const router = express.Router();
const ESTABLISHMENT_UPLOAD_FIELD_NAMES = ['fotos', 'foto'] as const;
const uploadEstablishmentImages = uploadEstablishment.fields([
  { name: 'fotos', maxCount: 10 },
  { name: 'foto', maxCount: 1 },
]);

type EstablishmentImageRow = {
  id: number | string;
  establishment_id: number | string;
  storage_path: string;
  sort_order: number | string;
  is_cover: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeStoragePathList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    );
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return [];
    }

    if (trimmedValue.startsWith('[')) {
      try {
        return normalizeStoragePathList(JSON.parse(trimmedValue));
      } catch {
        return [];
      }
    }

    return [trimmedValue];
  }

  return [];
}

function getPrimaryEstablishmentImageUrl(imageUrls: string[]) {
  return imageUrls[0] || DEFAULT_ESTABLISHMENT_PHOTO;
}

function getPrimaryEstablishmentImagePath(imagePaths: string[]) {
  return imagePaths[0] || DEFAULT_ESTABLISHMENT_PHOTO;
}

async function getEstablishmentImagesByIds(establishmentIds: Array<number | string>) {
  const normalizedIds = Array.from(
    new Set(
      establishmentIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  );

  const imageMap = new Map<number, EstablishmentImageRow[]>();

  if (normalizedIds.length === 0) {
    return imageMap;
  }

  const placeholders = normalizedIds.map(() => '?').join(', ');
  const [rows] = await pool.execute<EstablishmentImageRow>(
    `
    SELECT id, establishment_id, storage_path, sort_order, is_cover
    FROM establishment_images
    WHERE establishment_id IN (${placeholders})
    ORDER BY establishment_id ASC, is_cover DESC, sort_order ASC, id ASC
  `,
    normalizedIds,
  );

  rows.forEach((row) => {
    const establishmentId = Number(row.establishment_id);
    const currentRows = imageMap.get(establishmentId) || [];
    currentRows.push(row);
    imageMap.set(establishmentId, currentRows);
  });

  return imageMap;
}

async function resolveEstablishmentImageUrls(imagePaths: string[]) {
  return Promise.all(
    imagePaths.map((imagePath) => resolveImageAssetUrl(imagePath, 'establishment')),
  ).then((resolvedImageUrls) =>
    resolvedImageUrls.filter((imageUrl): imageUrl is string => typeof imageUrl === 'string' && Boolean(imageUrl)),
  );
}

async function buildEstablishmentImageResponse(imagePaths: string[]) {
  const resolvedImageUrls = await resolveEstablishmentImageUrls(imagePaths);
  const primaryImageUrl = getPrimaryEstablishmentImageUrl(resolvedImageUrls);

  return {
    imageUrl: primaryImageUrl,
    imageUrls: resolvedImageUrls,
    imagePaths,
  };
}

async function formatEstablishmentForResponse(
  establishment: Record<string, unknown>,
  imagePaths: string[],
) {
  const imageResponse = await buildEstablishmentImageResponse(imagePaths);

  return {
    id: establishment.id,
    dono_id: establishment.dono_id,
    name: establishment.name,
    description: establishment.description ?? null,
    address: establishment.address ?? null,
    phone: establishment.phone ?? null,
    mei: establishment.mei ?? null,
    rating: establishment.rating_avg ?? 0,
    ratingCount: establishment.rating_count ?? 0,
    latitude: establishment.latitude ?? null,
    longitude: establishment.longitude ?? null,
    googleMapsUrl: establishment.google_maps_url ?? null,
    locationVerified: establishment.location_verified ?? null,
    fullAddress: {
      rua: establishment.rua ?? '',
      cidade: establishment.cidade ?? '',
      estado: establishment.stado ?? '',
      pais: establishment.pais ?? 'Brasil',
      cep: establishment.cep ?? '',
    },
    ...imageResponse,
  };
}

function getUploadedEstablishmentFiles(req: express.Request) {
  const files: Express.Multer.File[] = [];

  if (req.file) {
    files.push(req.file);
  }

  const requestFiles = req.files;

  if (Array.isArray(requestFiles)) {
    files.push(...requestFiles);
    return files;
  }

  if (!isRecord(requestFiles)) {
    return files;
  }

  for (const fieldName of ESTABLISHMENT_UPLOAD_FIELD_NAMES) {
    const fieldFiles = requestFiles[fieldName];
    if (Array.isArray(fieldFiles)) {
      files.push(...fieldFiles);
    }
  }

  return files;
}

function parseRequestedExistingImagePaths(value: unknown) {
  if (value === undefined) {
    return null;
  }

  return normalizeStoragePathList(value);
}

async function deleteEstablishmentImageGallery(imagePaths: string[]) {
  const uniqueImagePaths = Array.from(new Set(imagePaths));

  await Promise.all(
    uniqueImagePaths.map((imagePath) =>
      deleteImageAsset(imagePath, 'establishment', DEFAULT_ESTABLISHMENT_PHOTO),
    ),
  );
}

async function uploadEstablishmentImageGallery(files: Express.Multer.File[]) {
  const uploadedImagePaths: string[] = [];

  for (const file of files) {
    uploadedImagePaths.push(await uploadImageAssetPath(file, 'establishment'));
  }

  return uploadedImagePaths;
}

async function syncEstablishmentImages(
  establishmentId: number | string,
  nextImagePaths: string[],
) {
  const [currentRows] = await pool.execute<EstablishmentImageRow>(
    `
    SELECT id, establishment_id, storage_path, sort_order, is_cover
    FROM establishment_images
    WHERE establishment_id = ?
    ORDER BY is_cover DESC, sort_order ASC, id ASC
  `,
    [establishmentId],
  );

  const currentRowsByPath = new Map(currentRows.map((row) => [row.storage_path, row]));
  const nextImagePathSet = new Set(nextImagePaths);

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    for (const row of currentRows) {
      if (!nextImagePathSet.has(row.storage_path)) {
        await connection.execute('DELETE FROM establishment_images WHERE id = ?', [row.id]);
      }
    }

    await connection.execute(
      `
      UPDATE establishment_images
      SET is_cover = FALSE, updated_em = NOW()
      WHERE establishment_id = ?
    `,
      [establishmentId],
    );

    for (const [index, imagePath] of nextImagePaths.entries()) {
      const existingRow = currentRowsByPath.get(imagePath);

      if (existingRow) {
        await connection.execute(
          `
          UPDATE establishment_images
          SET sort_order = ?, is_cover = ?, updated_em = NOW()
          WHERE id = ?
        `,
          [index, false, existingRow.id],
        );
        continue;
      }

      await connection.execute(
        `
        INSERT INTO establishment_images (establishment_id, storage_path, sort_order, is_cover)
        VALUES (?, ?, ?, ?)
      `,
        [establishmentId, imagePath, index, false],
      );
    }

    if (nextImagePaths[0]) {
      await connection.execute(
        `
        UPDATE establishment_images
        SET is_cover = TRUE, updated_em = NOW()
        WHERE establishment_id = ? AND storage_path = ?
      `,
        [establishmentId, nextImagePaths[0]],
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

router.get('/establishments', async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 5;
    const offset = (page - 1) * limit;

    const [establishments] = await pool.query(`
      SELECT
        id,
        dono_id,
        nome AS name,
        description,
        rua,
        cidade,
        TRIM(CONCAT(COALESCE(rua, ''), CASE WHEN cidade IS NOT NULL AND cidade <> '' THEN ', ' || cidade ELSE '' END, CASE WHEN stado IS NOT NULL AND stado <> '' THEN ' - ' || stado ELSE '' END)) AS address,
        stado,
        pais,
        cep,
        phone,
        rating_avg,
        rating_count,
        mei,
        criado_em,
        updated_em,
        deletedo_em,
        latitude,
        longitude,
        google_maps_url,
        location_verified
      FROM establishments
      WHERE deletedo_em IS NULL
      ORDER BY rating_avg DESC, nome ASC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const imageMap = await getEstablishmentImagesByIds(establishments.map((establishment) => establishment.id));

    res.json(await Promise.all(
      establishments.map((establishment) =>
        formatEstablishmentForResponse(
          establishment,
          (imageMap.get(Number(establishment.id)) || []).map((image) => image.storage_path),
        ),
      ),
    ));
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar estabelecimentos' });
  }
});

router.get('/establishments/:id', async (req, res) => {
  try {
    const [establishments] = await pool.execute(
      `
      SELECT
        id,
        dono_id,
        nome AS name,
        description,
        rua,
        cidade,
        stado,
        pais,
        cep,
        phone,
        rating_avg,
        rating_count,
        mei,
        criado_em,
        updated_em,
        latitude,
        longitude,
        google_maps_url,
        location_verified
      FROM establishments
      WHERE id = ? AND deletedo_em IS NULL
    `,
      [req.params.id],
    );

    if (establishments.length === 0) {
      return res.status(404).json({ erro: 'Estabelecimento nao encontrado' });
    }

    const imageMap = await getEstablishmentImagesByIds([req.params.id]);
    const est = establishments[0];

    res.json(
      await formatEstablishmentForResponse(
        {
          ...est,
          address: `${est.rua}, ${est.cidade} - ${est.stado}`,
        },
        (imageMap.get(Number(req.params.id)) || []).map((image) => image.storage_path),
      ),
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar estabelecimento' });
  }
});

router.post('/establishments', uploadEstablishmentImages, async (req, res) => {
  let uploadedImagePaths: string[] = [];

  try {
    const { dono_id, nome, description, rua, cidade, stado, pais, cep, phone, mei } = req.body;
    const uploadedFiles = getUploadedEstablishmentFiles(req);

    if (!dono_id || !nome || !rua || !cidade || !stado || !cep) {
      return res
        .status(400)
        .json({ erro: 'Campos obrigatorios: dono_id, nome, rua, cidade, stado, cep' });
    }

    const administrador = await findAdminById(pool, dono_id);

    if (!administrador) {
      return res.status(404).json({ erro: 'Administrador responsavel nao encontrado' });
    }

    uploadedImagePaths = await uploadEstablishmentImageGallery(uploadedFiles);
    const imagePath = getPrimaryEstablishmentImagePath(uploadedImagePaths);

    const meiTratado = mei === '' || mei === null || mei === undefined ? 0 : parseInt(mei, 10);

    const [, result] = await pool.execute(
      `
      INSERT INTO establishments
        (dono_id, nome, description, rua, cidade, stado, pais, cep, phone, mei, rating_avg, rating_count, imagem_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
    `,
      [
        dono_id,
        nome,
        description || null,
        rua,
        cidade,
        stado,
        pais || 'Brasil',
        cep,
        phone || null,
        Number.isNaN(meiTratado) ? 0 : meiTratado,
        imagePath,
      ],
    );

    if (result.insertId && uploadedImagePaths.length > 0) {
      await syncEstablishmentImages(result.insertId, uploadedImagePaths);
    }

    const imageResponse = await buildEstablishmentImageResponse(uploadedImagePaths);

    res.status(201).json({
      mensagem: 'Estabelecimento criado com sucesso',
      id: result.insertId,
      ...imageResponse,
    });
    uploadedImagePaths = [];
  } catch (error) {
    console.error(error);
    if (uploadedImagePaths.length > 0) {
      await deleteEstablishmentImageGallery(uploadedImagePaths);
    }
    res.status(500).json({ erro: 'Erro ao criar estabelecimento' });
  }
});

router.put('/establishments/:id', uploadEstablishmentImages, async (req, res) => {
  let uploadedImagePaths: string[] = [];

  try {
    const id = String(req.params.id);
    const { nome, description, rua, cidade, stado, pais, cep, phone, mei } = req.body;
    const uploadedFiles = getUploadedEstablishmentFiles(req);

    const meiTratado = mei === '' || mei === null || mei === undefined ? 0 : parseInt(mei, 10);

    const [estabelecimentoAtual] = await pool.execute(
      'SELECT id FROM establishments WHERE id = ? AND deletedo_em IS NULL',
      [id],
    );

    if (estabelecimentoAtual.length === 0) {
      return res.status(404).json({ erro: 'Estabelecimento nao encontrado' });
    }

    const imageMap = await getEstablishmentImagesByIds([id]);
    const currentImagePaths = (imageMap.get(Number(id)) || []).map((image) => image.storage_path);
    const requestedExistingImagePaths = parseRequestedExistingImagePaths(req.body.existing_image_paths);
    const keptImagePaths = requestedExistingImagePaths
      ? currentImagePaths.filter((imagePath) => requestedExistingImagePaths.includes(imagePath))
      : currentImagePaths;

    uploadedImagePaths = await uploadEstablishmentImageGallery(uploadedFiles);

    const nextImagePaths = [...keptImagePaths, ...uploadedImagePaths];
    const imagePath = getPrimaryEstablishmentImagePath(nextImagePaths);

    const [, result] = await pool.execute(
      `
      UPDATE establishments
      SET nome = ?, description = ?, rua = ?, cidade = ?, stado = ?, pais = ?, cep = ?, phone = ?, mei = ?, imagem_url = ?, updated_em = NOW()
      WHERE id = ? AND deletedo_em IS NULL
    `,
      [
        nome,
        description,
        rua,
        cidade,
        stado,
        pais || 'Brasil',
        cep,
        phone,
        Number.isNaN(meiTratado) ? 0 : meiTratado,
        imagePath,
        id,
      ],
    );

    if (result.affectedRows === 0) {
      if (uploadedImagePaths.length > 0) {
        await deleteEstablishmentImageGallery(uploadedImagePaths);
        uploadedImagePaths = [];
      }
      return res.status(404).json({ erro: 'Estabelecimento nao encontrado' });
    }

    await syncEstablishmentImages(id, nextImagePaths);

    const removedImagePaths = currentImagePaths.filter((imagePath) => !keptImagePaths.includes(imagePath));
    await deleteEstablishmentImageGallery(removedImagePaths);

    uploadedImagePaths = [];
    const imageResponse = await buildEstablishmentImageResponse(nextImagePaths);

    res.json({
      mensagem: 'Estabelecimento atualizado com sucesso',
      ...imageResponse,
    });
  } catch (error) {
    console.error(error);
    if (uploadedImagePaths.length > 0) {
      await deleteEstablishmentImageGallery(uploadedImagePaths);
    }
    res.status(500).json({ erro: 'Erro ao atualizar estabelecimento' });
  }
});

router.delete('/establishments/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    const imageMap = await getEstablishmentImagesByIds([id]);
    const currentImagePaths = (imageMap.get(Number(id)) || []).map((image) => image.storage_path);

    const [, result] = await pool.execute(
      'UPDATE establishments SET deletedo_em = NOW() WHERE id = ? AND deletedo_em IS NULL',
      [id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: 'Estabelecimento nao encontrado' });
    }

    if (currentImagePaths.length > 0) {
      await deleteEstablishmentImageGallery(currentImagePaths);
      await pool.execute('DELETE FROM establishment_images WHERE establishment_id = ?', [id]);
    }

    res.json({ mensagem: 'Estabelecimento deletado com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao deletar estabelecimento' });
  }
});
function hasOwn(value: unknown, key: string) {
  return typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeLocationValue(value: unknown) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  return value;
}

function buildGoogleMapsEmbedUrl(query: string) {
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&z=15&output=embed`;
}

function extractEmbedUrlFromGoogleMapsUrl(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null;
  }

  const directValue = value.trim();
  if (!directValue) {
    return null;
  }

  if (directValue.includes('output=embed')) {
    return directValue;
  }

  try {
    const url = new URL(directValue);
    const queryParams = ['q', 'query', 'destination', 'll', 'center'];

    for (const key of queryParams) {
      const paramValue = url.searchParams.get(key)?.trim();
      if (paramValue) {
        return buildGoogleMapsEmbedUrl(paramValue);
      }
    }

    const placeMatch = url.pathname.match(/\/place\/([^/]+)/i);
    if (placeMatch?.[1]) {
      return buildGoogleMapsEmbedUrl(decodeURIComponent(placeMatch[1]).replace(/\+/g, ' '));
    }

    const atMatch = directValue.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (atMatch) {
      return buildGoogleMapsEmbedUrl(`${atMatch[1]},${atMatch[2]}`);
    }

    const dataMatch = directValue.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (dataMatch) {
      return buildGoogleMapsEmbedUrl(`${dataMatch[1]},${dataMatch[2]}`);
    }
  } catch {
    const atMatch = directValue.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (atMatch) {
      return buildGoogleMapsEmbedUrl(`${atMatch[1]},${atMatch[2]}`);
    }
  }

  return null;
}

function isGoogleMapsShortLink(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return false;
  }

  try {
    const url = new URL(value.trim());
    return /(^|\.)maps\.app\.goo\.gl$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function extractEmbedUrlFromGoogleMapsHtml(html: string) {
  const previewHrefMatch = html.match(/<link[^>]+href=\"([^\"]*\/maps\/preview\/place[^\"]+)\"/i);
  if (previewHrefMatch?.[1]) {
    const decodedPreviewHref = previewHrefMatch[1].replace(/&amp;/g, '&');
    try {
      const previewUrl = new URL(decodedPreviewHref, 'https://www.google.com');
      const q = previewUrl.searchParams.get('q')?.trim();
      if (q) {
        return buildGoogleMapsEmbedUrl(q);
      }
    } catch {
      // Ignore malformed preview links and keep trying other patterns.
    }
  }

  const dataMatch = html.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (dataMatch) {
    return buildGoogleMapsEmbedUrl(`${dataMatch[1]},${dataMatch[2]}`);
  }

  return null;
}

async function resolveGoogleMapsShortUrl(value: string | null | undefined) {
  if (!isGoogleMapsShortLink(value)) {
    return typeof value === 'string' ? value.trim() : value ?? null;
  }

  const response = await fetch(value, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; BarberShopMapsResolver/1.0)',
    },
  });

  return response.url || value;
}

async function updateEstablishmentLocation(req: express.Request, res: express.Response) {
  const id = String(req.params.id);
  const latitudeProvided = hasOwn(req.body, 'latitude');
  const longitudeProvided = hasOwn(req.body, 'longitude');
  const mapsUrlProvided = hasOwn(req.body, 'google_maps_url');

  if (!latitudeProvided && !longitudeProvided && !mapsUrlProvided) {
    return res.status(400).json({ erro: 'Nenhum campo de localizacao foi informado' });
  }

  try {
    const [estabelecimentos] = await pool.execute(
      `
      SELECT latitude, longitude, google_maps_url, location_verified
      FROM establishments
      WHERE id = ? AND deletedo_em IS NULL
    `,
      [id],
    );

    if (estabelecimentos.length === 0) {
      return res.status(404).json({ erro: 'Estabelecimento nao encontrado' });
    }

    const estabelecimentoAtual = estabelecimentos[0];
    const nextLatitude = latitudeProvided
      ? normalizeLocationValue(req.body.latitude)
      : estabelecimentoAtual.latitude;
    const nextLongitude = longitudeProvided
      ? normalizeLocationValue(req.body.longitude)
      : estabelecimentoAtual.longitude;
    let nextGoogleMapsUrl = mapsUrlProvided
      ? normalizeLocationValue(
          typeof req.body.google_maps_url === 'string'
            ? req.body.google_maps_url.trim()
            : req.body.google_maps_url,
        )
      : estabelecimentoAtual.google_maps_url;

    if (typeof nextGoogleMapsUrl === 'string' && nextGoogleMapsUrl) {
      try {
        nextGoogleMapsUrl = await resolveGoogleMapsShortUrl(nextGoogleMapsUrl);
      } catch (error) {
        console.error('Erro ao resolver link curto do Google Maps ao salvar:', error);
      }
    }
    const shouldResetVerification =
      nextLatitude !== estabelecimentoAtual.latitude ||
      nextLongitude !== estabelecimentoAtual.longitude ||
      nextGoogleMapsUrl !== estabelecimentoAtual.google_maps_url;

    const [, result] = await pool.execute(
      `
      UPDATE establishments
      SET latitude = ?, longitude = ?, google_maps_url = ?, location_verified = ?, updated_em = NOW()
      WHERE id = ? AND deletedo_em IS NULL
    `,
      [
        nextLatitude,
        nextLongitude,
        nextGoogleMapsUrl,
        shouldResetVerification ? false : estabelecimentoAtual.location_verified,
        id,
      ],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: 'Estabelecimento nao encontrado' });
    }

    res.json({ mensagem: 'Localizacao atualizada com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao atualizar localizacao' });
  }
}

router.put('/establishments/:id/location', updateEstablishmentLocation);
router.post('/establishments/:id/location', updateEstablishmentLocation);
router.post('/establishments/:id/post-location', updateEstablishmentLocation);

router.get('/maps/embed-url', async (req, res) => {
  const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (!rawUrl) {
    return res.status(400).json({ erro: 'url e obrigatoria' });
  }

  const directEmbedUrl = extractEmbedUrlFromGoogleMapsUrl(rawUrl);
  if (directEmbedUrl) {
    return res.json({ embedUrl: directEmbedUrl, resolvedUrl: rawUrl });
  }

  const timeout = AbortSignal.timeout(8000);

  try {
    const response = await fetch(rawUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: timeout,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; BarberShopMapsResolver/1.0)',
      },
    });

    const resolvedUrl = response.url || rawUrl;
    let embedUrl = extractEmbedUrlFromGoogleMapsUrl(resolvedUrl);

    if (!embedUrl) {
      const html = await response.text();
      embedUrl = extractEmbedUrlFromGoogleMapsHtml(html);
    }

    if (!embedUrl) {
      return res.status(422).json({ erro: 'Nao foi possivel converter o link para embed', resolvedUrl });
    }

    res.json({ embedUrl, resolvedUrl });
  } catch (error) {
    console.error(error);
    res.status(502).json({ erro: 'Erro ao resolver link do Google Maps' });
  }
});

export default router;
