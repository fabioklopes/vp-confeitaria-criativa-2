const express = require('express');
const db = require('../db');

const router = express.Router();

function validar(body) {
  if (!body.tipo || !['entrada', 'saida'].includes(body.tipo)) return 'Informe o tipo (entrada ou saída).';
  if (!body.descricao) return 'Informe a descrição do lançamento.';
  if (body.valor == null || Number(body.valor) <= 0) return 'Informe um valor maior que zero.';
  if (!body.data_lancamento) return 'Informe a data do lançamento.';
  return null;
}

router.get('/', async (req, res, next) => {
  try {
    const { inicio, fim } = req.query;
    let where = '1=1';
    const params = [];
    if (inicio) { where += ' AND data_lancamento >= ?'; params.push(inicio); }
    if (fim) { where += ' AND data_lancamento <= ?'; params.push(fim); }
    const lancamentos = await db.query(
      `SELECT id, tipo, descricao, valor, DATE_FORMAT(data_lancamento, "%Y-%m-%d") data_lancamento, created_at
       FROM tb_caixa WHERE ${where} ORDER BY data_lancamento DESC, id DESC`, params
    );
    const [totais] = await db.query(
      `SELECT
        COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE 0 END), 0) AS total_entradas,
        COALESCE(SUM(CASE WHEN tipo = 'saida' THEN valor ELSE 0 END), 0) AS total_saidas,
        COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END), 0) AS saldo
       FROM tb_caixa WHERE ${where}`, params
    );
    res.json({ lancamentos, totais });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const erro = validar(req.body);
    if (erro) return res.status(400).json({ erro });
    const b = req.body;
    const r = await db.query(
      'INSERT INTO tb_caixa (tipo, descricao, valor, data_lancamento) VALUES (?,?,?,?)',
      [b.tipo, b.descricao, b.valor, b.data_lancamento]
    );
    res.status(201).json({ id: r.insertId, mensagem: 'Lançamento registrado com sucesso.' });
  } catch (e) { next(e); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const erro = validar(req.body);
    if (erro) return res.status(400).json({ erro });
    const b = req.body;
    const r = await db.query(
      'UPDATE tb_caixa SET tipo=?, descricao=?, valor=?, data_lancamento=? WHERE id=?',
      [b.tipo, b.descricao, b.valor, b.data_lancamento, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ erro: 'Lançamento não encontrado.' });
    res.json({ mensagem: 'Lançamento atualizado com sucesso.' });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const r = await db.query('DELETE FROM tb_caixa WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ erro: 'Lançamento não encontrado.' });
    res.json({ mensagem: 'Lançamento excluído com sucesso.' });
  } catch (e) { next(e); }
});

module.exports = router;