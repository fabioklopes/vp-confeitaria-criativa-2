const express = require('express');
const db = require('../db');

const router = express.Router();

function validar(body) {
  if (!body.descricao) return 'Informe a descrição da medida.';
  return null;
}

router.get('/', async (req, res, next) => {
  try {
    const rows = await db.query('SELECT id, descricao, inteiro, created_at FROM tb_medidas ORDER BY descricao');
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const erro = validar(req.body);
    if (erro) return res.status(400).json({ erro });
    const s = String(req.body.descricao).trim();
    const existe = await db.query('SELECT id FROM tb_medidas WHERE LOWER(descricao) = LOWER(?)', [s]);
    if (existe.length) return res.status(400).json({ erro: 'Essa medida já está cadastrada.' });
    const r = await db.query('INSERT INTO tb_medidas (descricao, inteiro) VALUES (?,?)', [s, req.body.inteiro ? 1 : 0]);
    res.status(201).json({ id: r.insertId, mensagem: 'Medida cadastrada com sucesso.' });
  } catch (e) { next(e); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const erro = validar(req.body);
    if (erro) return res.status(400).json({ erro });
    const s = String(req.body.descricao).trim();
    const r = await db.query('UPDATE tb_medidas SET descricao = ?, inteiro = ? WHERE id = ?', [s, req.body.inteiro ? 1 : 0, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ erro: 'Medida não encontrada.' });
    res.json({ mensagem: 'Medida atualizada com sucesso.' });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const r = await db.query('DELETE FROM tb_medidas WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ erro: 'Medida não encontrada.' });
    res.json({ mensagem: 'Medida excluída com sucesso.' });
  } catch (e) { next(e); }
});

module.exports = router;