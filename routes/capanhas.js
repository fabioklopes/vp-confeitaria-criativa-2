const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const wa = require('../lib/whatsapp');

const router = express.Router();

const DIR_CAMPANHAS = path.join(config.uploadDir, 'campanhas');
fs.mkdirSync(DIR_CAMPANHAS, { recursive: true, mode: 0o700 });

const FORMATOS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.svg', '.gif']);

const MIME_EXT = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/pjpeg': '.jpg',
  'image/png': '.png',
  'image/x-png': '.png',
  'image/gif': '.gif',
  'image/svg+xml': '.svg'
};
const MIME_OK = new Set(Object.keys(MIME_EXT));

// extensão para salvar: prioriza a extensão do nome; se não houver (ex.: imagem
// arrastada/colada sem nome), usa o mimetype enviado pelo navegador
function extDoArquivo(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (FORMATOS.has(ext)) return ext;
  return MIME_EXT[(file.mimetype || '').toLowerCase()] || '';
}

const uploadCampanha = multer({
  storage: multer.diskStorage({
    destination: DIR_CAMPANHAS,
    filename: (req, file, cb) => {
      const ext = extDoArquivo(file);
      cb(null, `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    }
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    if (!FORMATOS.has(ext) && !MIME_OK.has(mime)) {
      const e = new Error('Formato não permitido. Envie apenas arquivos PDF, JPG, PNG, SVG ou GIF.');
      e.status = 400;
      return cb(e);
    }
    cb(null, true);
  }
});

function uploadSingle(field) {
  return (req, res, next) => {
    uploadCampanha.single(field)(req, res, (err) => {
      if (!err) return next();
      err.status = err.status || 400;
      err.message = err.message || 'Erro no upload do arquivo.';
      next(err);
    });
  };
}

/* ---- utilitários de arquivo ---- */
function slugify(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'campanha';
}

function hojeLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// Regra de nome: AAAA-MM-DD-Campanha-nome-da-campanha.ext
function nomeFinal(nome, ext) {
  const base = `${hojeLocal()}-Campanha-${slugify(nome)}.${ext}`;
  let final = base;
  let i = 1;
  while (fs.existsSync(path.join(DIR_CAMPANHAS, final))) {
    final = `${base.replace(/\.\w+$/, '')}-${i++}.${ext}`;
  }
  return final;
}

function urlArquivo(arquivo) {
  return arquivo ? `/uploads/${arquivo}` : null;
}

function validarPlain(body) {
  if (!body.nome) return 'Informe o nome da campanha.';
  if (!body.data_inicio) return 'Informe a data de início.';
  return null;
}

const cols = `id, nome, descricao, DATE_FORMAT(data_inicio, "%Y-%m-%d") data_inicio,
  DATE_FORMAT(data_termino, "%Y-%m-%d") data_termino, arquivo, created_at`;

router.get('/', async (req, res, next) => {
  try {
    const rows = await db.query(`SELECT ${cols} FROM tb_capanhas ORDER BY created_at DESC, id DESC`);
    res.json(rows.map(r => ({ ...r, arquivo_url: urlArquivo(r.arquivo) })));
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const rows = await db.query(`SELECT ${cols} FROM tb_capanhas WHERE id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ erro: 'Campanha não encontrada.' });
    res.json({ ...rows[0], arquivo_url: urlArquivo(rows[0].arquivo) });
  } catch (e) { next(e); }
});

router.post('/', uploadSingle('arquivo'), async (req, res, next) => {
  try {
    const erro = validarPlain(req.body);
    if (erro) return res.status(400).json({ erro });
    const b = req.body;

    let arquivo = null;
    if (req.file) {
      const ext = extDoArquivo(req.file).replace(/^\./, '');
      const final = nomeFinal(b.nome, ext);
      fs.renameSync(req.file.path, path.join(DIR_CAMPANHAS, final));
      arquivo = `campanhas/${final}`;
    }

    const r = await db.query(
      'INSERT INTO tb_capanhas (nome, descricao, data_inicio, data_termino, arquivo) VALUES (?,?,?,?,?)',
      [b.nome, b.descricao || null, b.data_inicio, b.data_termino || null, arquivo]
    );
    const cont = await db.query('SELECT COUNT(*) c FROM tb_clientes WHERE whatsapp = 1 AND desabilitar_whatsapp = 0');
    res.status(201).json({
      id: r.insertId,
      mensagem: 'Campanha cadastrada com sucesso.',
      arquivo,
      arquivo_url: urlArquivo(arquivo),
      clientes_whatsapp: cont[0].c
    });
  } catch (e) { next(e); }
});

router.put('/:id', uploadSingle('arquivo'), async (req, res, next) => {
  try {
    const erro = validarPlain(req.body);
    if (erro) return res.status(400).json({ erro });
    const b = req.body;
    const antiga = await db.query('SELECT arquivo FROM tb_capanhas WHERE id = ?', [req.params.id]);
    if (!antiga.length) return res.status(404).json({ erro: 'Campanha não encontrada.' });

    let arquivo = antiga[0].arquivo;
    if (req.file) {
      const ext = extDoArquivo(req.file).replace(/^\./, '');
      const final = nomeFinal(b.nome, ext);
      fs.renameSync(req.file.path, path.join(DIR_CAMPANHAS, final));
      arquivo = `campanhas/${final}`;
      if (antiga[0].arquivo) {
        const velho = path.join(config.uploadDir, antiga[0].arquivo);
        if (fs.existsSync(velho)) fs.unlinkSync(velho);
      }
    }

    const r = await db.query(
      'UPDATE tb_capanhas SET nome=?, descricao=?, data_inicio=?, data_termino=?, arquivo=? WHERE id=?',
      [b.nome, b.descricao || null, b.data_inicio, b.data_termino || null, arquivo, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ erro: 'Campanha não encontrada.' });
    res.json({ mensagem: 'Campanha atualizada com sucesso.', arquivo, arquivo_url: urlArquivo(arquivo) });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const linhas = await db.query('SELECT arquivo FROM tb_capanhas WHERE id = ?', [req.params.id]);
    if (!linhas.length) return res.status(404).json({ erro: 'Campanha não encontrada.' });
    if (linhas[0].arquivo) {
      const p = path.join(config.uploadDir, linhas[0].arquivo);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    const r = await db.query('DELETE FROM tb_capanhas WHERE id = ?', [req.params.id]);
    res.json({ mensagem: 'Campanha excluída com sucesso.' });
  } catch (e) { next(e); }
});

/* ---- Envio via WhatsApp ---- */
router.post('/:id/enviar', async (req, res, next) => {
  try {
    const camp = await db.query('SELECT id, nome, arquivo, descricao FROM tb_capanhas WHERE id = ?', [req.params.id]);
    if (!camp.length) return res.status(404).json({ erro: 'Campanha não encontrada.' });
    if (!camp[0].arquivo) return res.status(400).json({ erro: 'Esta campanha não possui arquivo anexado para envio.' });
    const mediaPath = path.join(config.uploadDir, camp[0].arquivo);
    if (!fs.existsSync(mediaPath)) return res.status(400).json({ erro: 'Arquivo da campanha não encontrado no servidor.' });
    const result = await wa.enviarCampanha(camp[0].id, mediaPath, camp[0].descricao || '');
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/envio/status', async (req, res) => {
  const p = wa.getProgresso(req.params.id);
  if (!p) return res.json({ ativo: false, concluido: false });
  res.json({ ativo: !p.concluido, ...p });
});

router.post('/:id/envio/cancelar', async (req, res) => {
  const ok = wa.cancelar(req.params.id);
  res.json({ ok, mensagem: ok ? 'Envio cancelado: após a mensagem em curso.' : 'Nenhum envio ativo para esta campanha.' });
});

module.exports = router;