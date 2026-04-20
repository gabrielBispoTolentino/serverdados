import express from 'express';
import { DEFAULT_ESTABLISHMENT_PHOTO } from '../config/constants';
import { pool } from '../config/database';
import { uploadEstablishment } from '../config/uploads';
import { findAdminById } from '../services/users';
import { safeUnlink } from '../utils/files';
import { deleteImageAsset, uploadImageAsset } from '../services/storage';

const router = express.Router();

function isMissingColumnError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '42703'
  );
}

router.get('/establishments', async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 5;
    const offset = (page - 1) * limit;

    let establishments;

    try {
      [establishments] = await pool.query(`
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
          imagem_url,
          latitude,
          longitude,
          google_maps_url,
          location_verified
        FROM establishments
        WHERE deletedo_em IS NULL
        ORDER BY rating_avg DESC, nome ASC
        LIMIT ${limit} OFFSET ${offset}
      `);
    } catch (error) {
      if (!isMissingColumnError(error)) {
        throw error;
      }

      [establishments] = await pool.query(`
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
          imagem_url
        FROM establishments
        WHERE deletedo_em IS NULL
        ORDER BY rating_avg DESC, nome ASC
        LIMIT ${limit} OFFSET ${offset}
      `);
    }

    res.json(establishments);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar estabelecimentos' });
  }
});

router.get('/establishments/:id', async (req, res) => {
  try {
    let establishments;

    try {
      [establishments] = await pool.execute(
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
          imagem_url,
          latitude,
          longitude,
          google_maps_url,
          location_verified
        FROM establishments
        WHERE id = ? AND deletedo_em IS NULL
      `,
        [req.params.id],
      );
    } catch (error) {
      if (!isMissingColumnError(error)) {
        throw error;
      }

      [establishments] = await pool.execute(
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
          imagem_url
        FROM establishments
        WHERE id = ? AND deletedo_em IS NULL
      `,
        [req.params.id],
      );
    }

    if (establishments.length === 0) {
      return res.status(404).json({ erro: 'Estabelecimento nao encontrado' });
    }

    const est = establishments[0];
    res.json({
      id: est.id,
      name: est.name,
      img: est.imagem_url,
      address: `${est.rua}, ${est.cidade} - ${est.stado}`,
      rating: est.rating_avg || 0,
      description: est.description,
      phone: est.phone,
      ratingCount: est.rating_count || 0,
      latitude: est.latitude ?? null,
      longitude: est.longitude ?? null,
      google_maps_url: est.google_maps_url ?? null,
      google_maps_embed_url: est.google_maps_embed_url ?? null,
      location_verified: est.location_verified ?? null,
      fullAddress: {
        rua: est.rua,
        cidade: est.cidade,
        estado: est.stado,
        pais: est.pais,
        cep: est.cep,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao buscar estabelecimento' });
  }
});

router.post('/establishments', uploadEstablishment.single('foto'), async (req, res) => {
  let imagemUrlParaLimpeza: string | null = null;

  try {
    const { dono_id, nome, description, rua, cidade, stado, pais, cep, phone, mei } = req.body;

    if (!dono_id || !nome || !rua || !cidade || !stado || !cep) {
      safeUnlink(req.file?.path);
      return res
        .status(400)
        .json({ erro: 'Campos obrigatorios: dono_id, nome, rua, cidade, stado, cep' });
    }

    const administrador = await findAdminById(pool, dono_id);

    if (!administrador) {
      safeUnlink(req.file?.path);
      return res.status(404).json({ erro: 'Administrador responsavel nao encontrado' });
    }

    const imagemUrl = req.file
      ? await uploadImageAsset(req.file, 'establishment')
      : DEFAULT_ESTABLISHMENT_PHOTO;
    imagemUrlParaLimpeza = req.file ? imagemUrl : null;

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
        imagemUrl,
      ],
    );

    res.status(201).json({
      mensagem: 'Estabelecimento criado com sucesso',
      id: result.insertId,
      imagemUrl,
    });
    imagemUrlParaLimpeza = null;
  } catch (error) {
    console.error(error);
    if (imagemUrlParaLimpeza) {
      await deleteImageAsset(imagemUrlParaLimpeza, 'establishment', DEFAULT_ESTABLISHMENT_PHOTO);
    }
    res.status(500).json({ erro: 'Erro ao criar estabelecimento' });
  }
});

router.put('/establishments/:id', uploadEstablishment.single('foto'), async (req, res) => {
  let imagemUrlUploadNova: string | null = null;

  try {
    const id = String(req.params.id);
    const { nome, description, rua, cidade, stado, pais, cep, phone, mei } = req.body;

    const meiTratado = mei === '' || mei === null || mei === undefined ? 0 : parseInt(mei, 10);

    const [estabelecimentoAtual] = await pool.execute(
      'SELECT imagem_url FROM establishments WHERE id = ? AND deletedo_em IS NULL',
      [id],
    );

    if (estabelecimentoAtual.length === 0) {
      safeUnlink(req.file?.path);
      return res.status(404).json({ erro: 'Estabelecimento nao encontrado' });
    }

    let imagemUrl = estabelecimentoAtual[0].imagem_url;

    if (req.file) {
      imagemUrl = await uploadImageAsset(req.file, 'establishment');
      imagemUrlUploadNova = imagemUrl;
    }

    const [, result] = await pool.execute(
      `
      UPDATE establishments
      SET nome = ?, description = ?, rua = ?, cidade = ?, stado = ?, pais = ?, cep = ?, phone = ?, mei = ?, imagem_url = ?, updated_em = NOW()
      WHERE id = ? AND deletedo_em IS NULL
    `,
      [nome, description, rua, cidade, stado, pais || 'Brasil', cep, phone, Number.isNaN(meiTratado) ? 0 : meiTratado, imagemUrl, id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: 'Estabelecimento nao encontrado' });
    }

    if (req.file && estabelecimentoAtual[0].imagem_url !== imagemUrl) {
      await deleteImageAsset(estabelecimentoAtual[0].imagem_url, 'establishment', DEFAULT_ESTABLISHMENT_PHOTO);
    }

    imagemUrlUploadNova = null;

    res.json({
      mensagem: 'Estabelecimento atualizado com sucesso',
      imagemUrl,
    });
  } catch (error) {
    console.error(error);
    if (imagemUrlUploadNova) {
      await deleteImageAsset(imagemUrlUploadNova, 'establishment', DEFAULT_ESTABLISHMENT_PHOTO);
    }
    res.status(500).json({ erro: 'Erro ao atualizar estabelecimento' });
  }
});

router.delete('/establishments/:id', async (req, res) => {
  try {
    const id = String(req.params.id);

    const [estabelecimento] = await pool.execute(
      'SELECT imagem_url FROM establishments WHERE id = ? AND deletedo_em IS NULL',
      [id],
    );

    const [, result] = await pool.execute(
      'UPDATE establishments SET deletedo_em = NOW() WHERE id = ? AND deletedo_em IS NULL',
      [id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: 'Estabelecimento nao encontrado' });
    }

    if (estabelecimento.length > 0) {
      await deleteImageAsset(estabelecimento[0].imagem_url, 'establishment', DEFAULT_ESTABLISHMENT_PHOTO);
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
