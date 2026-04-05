import express from 'express';
import { DEFAULT_ESTABLISHMENT_PHOTO } from '../config/constants';
import { pool } from '../config/database';
import { uploadEstablishment } from '../config/uploads';
import { resolveAppPath, safeUnlink } from '../utils/files';

const router = express.Router();

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
        cidade AS address,
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

    res.json(establishments);
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
        imagem_url
      FROM establishments
      WHERE id = ? AND deletedo_em IS NULL
    `,
      [req.params.id],
    );

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
  try {
    const { dono_id, nome, description, rua, cidade, stado, pais, cep, phone, mei } = req.body;

    if (!dono_id || !nome || !rua || !cidade || !stado || !cep) {
      safeUnlink(req.file?.path);
      return res
        .status(400)
        .json({ erro: 'Campos obrigatorios: dono_id, nome, rua, cidade, stado, cep' });
    }

    const imagemUrl = req.file
      ? `/uploads/establishment-photos/${req.file.filename}`
      : DEFAULT_ESTABLISHMENT_PHOTO;

    const meiTratado = mei === '' || mei === null || mei === undefined ? 0 : parseInt(mei, 10);

    const [, result] = await pool.execute(
      `
      INSERT INTO establishments
        (dono_id, nome, description, rua, cidade, stado, pais, cep, phone, mei, rating_avg, rating_count, imagem_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)
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
  } catch (error) {
    console.error(error);
    safeUnlink(req.file?.path);
    res.status(500).json({ erro: 'Erro ao criar estabelecimento' });
  }
});

router.put('/establishments/:id', uploadEstablishment.single('foto'), async (req, res) => {
  try {
    const id = String(req.params.id);
    const { nome, description, rua, cidade, stado, pais, cep, phone, mei } = req.body;

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
      if (imagemUrl && imagemUrl !== DEFAULT_ESTABLISHMENT_PHOTO) {
        safeUnlink(resolveAppPath(imagemUrl));
      }
      imagemUrl = `/uploads/establishment-photos/${req.file.filename}`;
    }

    const [, result] = await pool.execute(
      `
      UPDATE establishments
      SET nome = ?, description = ?, rua = ?, cidade = ?, stado = ?, pais = ?, cep = ?, phone = ?, mei = ?, imagem_url = ?, updated_em = NOW()
      WHERE id = ? AND deletedo_em IS NULL
    `,
      [nome, description, rua, cidade, stado, pais || 'Brasil', cep, phone, mei, imagemUrl, id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: 'Estabelecimento nao encontrado' });
    }

    res.json({
      mensagem: 'Estabelecimento atualizado com sucesso',
      imagemUrl,
    });
  } catch (error) {
    console.error(error);
    safeUnlink(req.file?.path);
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

    if (
      estabelecimento.length > 0 &&
      estabelecimento[0].imagem_url &&
      estabelecimento[0].imagem_url !== DEFAULT_ESTABLISHMENT_PHOTO
    ) {
      safeUnlink(resolveAppPath(estabelecimento[0].imagem_url));
    }

    res.json({ mensagem: 'Estabelecimento deletado com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro ao deletar estabelecimento' });
  }
});

export default router;
