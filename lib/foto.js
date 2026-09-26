/* ============================================================
   Foto de perfil do usuário
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');

fs.mkdirSync(config.fotoDir, { recursive: true, mode: 0o700 });

const FORMATOS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/pjpeg': '.jpg',
  'image/png': '.png',
  'image/x-png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};
const MIME_OK = new Set(Object.keys(MIME_EXT));

const maxBytes = config.auth.fotoMaxBytes;

// extensão para salvar: prioriza a extensão do nome; sem nome (ex.: imagem
// arrastada), usa o mimetype enviado pelo navegador
function extDoArquivo(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (FORMATOS.has(ext)) return ext;
  return MIME_EXT[(file.mimetype || '').toLowerCase()] || '';
}

const upload = multer({
  storage: multer.diskStorage({
    destination: config.fotoDir,
    filename: (req, file, cb) => {
      const ext = extDoArquivo(file);
      cb(null, `tmp-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: maxBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    if (!FORMATOS.has(ext) && !MIME_OK.has(mime)) {
      const e = new Error('Formato não permitido. Envie apenas imagens JPG, PNG, WEBP ou GIF.');
      e.status = 400;
      return cb(e);
    }
    cb(null, true);
  }
});

function uploadFoto(field = 'foto') {
  return (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (!err) return next();
      err.status = err.status || 400;
      if (err.code === 'LIMIT_FILE_SIZE') {
        err.message = `A imagem deve ter no máximo ${Math.round(maxBytes / 1024)} KB.`;
      } else {
        err.message = err.message || 'Erro no envio da imagem.';
      }
      next(err);
    });
  };
}

// Move o arquivo temporário para o nome definitivo e apaga o anterior.
function salvarFoto(usuarioId, file, fotoAnterior) {
  if (!file) return null;
  const ext = extDoArquivo(file).replace(/^\./, '') || 'jpg';
  const final = `usuario-${usuarioId}-${Date.now()}.${ext}`;
  fs.renameSync(file.path, path.join(config.fotoDir, final));
  apagarFoto(fotoAnterior);
  return `usuarios/${final}`;
}

function apagarFoto(foto) {
  if (!foto) return;
  const alvo = path.join(config.uploadDir, foto);
  // impede que um valor manipulado apague arquivos fora de upload/usuarios
  if (!alvo.startsWith(config.fotoDir + path.sep)) return;
  try {
    if (fs.existsSync(alvo)) fs.unlinkSync(alvo);
  } catch (e) {
    console.error('[foto] falha ao remover arquivo:', e.code || e.message);
  }
}

function urlFoto(foto) {
  return foto ? `/uploads/${foto}` : null;
}

module.exports = { uploadFoto, salvarFoto, apagarFoto, urlFoto, extDoArquivo, maxBytes };
