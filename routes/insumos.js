const express = require('express');
const db = require('../db');

const router = express.Router();

function validar(body, medida) {
  if (!body.produto) return 'Informe o produto.';
  if (body.quantidade_compra == null || Number(body.quantidade_compra) <= 0) return 'Informe a quantidade de compra (maior que zero).';
  if (medida && medida.inteiro) {
    if (!Number.isInteger(Number(body.quantidade_compra))) {
      return `Para a medida "${medida.descricao}" a quantidade deve ser um número inteiro positivo.`;
    }
  }
  if (body.valor == null || Number(body.valor) < 0) return 'Informe o valor de compra.';
  return null;
}

async function medidasInteiras() {
  const rows = await db.query('SELECT * FROM tb_medidas');
  return new Map(rows.map(m => [m.id, { descricao: m.descricao, inteiro: !!m.inteiro }]));
}

router.get('/', async (req, res, next) => {
  try {
    const rows = await db.query(
      'SELECT i.id, i.produto, i.quantidade_compra, i.valor, i.medida_id, i.created_at, ' +
      'm.descricao AS medida, m.inteiro AS medida_inteiro, ' +
      'ROUND(i.valor / NULLIF(i.quantidade_compra, 0), 4) AS custo_unitario ' +
      'FROM tb_insumos i LEFT JOIN tb_medidas m ON m.id = i.medida_id ' +
      'ORDER BY i.created_at DESC, i.id DESC'
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const rows = await db.query(
      'SELECT i.*, m.descricao AS medida, m.inteiro AS medida_inteiro, ' +
      'ROUND(i.valor / NULLIF(i.quantidade_compra, 0), 4) AS custo_unitario ' +
      'FROM tb_insumos i LEFT JOIN tb_medidas m ON m.id = i.medida_id WHERE i.id = ?', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'Insumo não encontrado.' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const medidas = await medidasInteiras();
    const erro = validar(req.body, medidas.get(req.body.medida_id || ''));
    if (erro) return res.status(400).json({ erro });
    const b = req.body;
    const r = await db.query(
      'INSERT INTO tb_insumos (produto, quantidade_compra, valor, medida_id) VALUES (?,?,?,?)',
      [b.produto, b.quantidade_compra, b.valor, b.medida_id || null]
    );
    res.status(201).json({ id: r.insertId, mensagem: 'Insumo cadastrado com sucesso.' });
  } catch (e) { next(e); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const medidas = await medidasInteiras();
    const erro = validar(req.body, medidas.get(req.body.medida_id || ''));
    if (erro) return res.status(400).json({ erro });
    const b = req.body;
    const r = await db.query(
      'UPDATE tb_insumos SET produto=?, quantidade_compra=?, valor=?, medida_id=? WHERE id=?',
      [b.produto, b.quantidade_compra, b.valor, b.medida_id || null, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ erro: 'Insumo não encontrado.' });
    res.json({ mensagem: 'Insumo atualizado com sucesso.' });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const r = await db.query('DELETE FROM tb_insumos WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ erro: 'Insumo não encontrado.' });
    res.json({ mensagem: 'Insumo excluído com sucesso.' });
  } catch (e) { next(e); }
});

module.exports = router;