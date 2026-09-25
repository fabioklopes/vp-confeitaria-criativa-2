const express = require('express');
const db = require('../db');

const router = express.Router();

function validar(body) {
  if (!body.nome) return 'Informe o nome do cliente.';
  return null;
}

router.get('/', async (req, res, next) => {
  try {
    const rows = await db.query(
      'SELECT id, nome, cpf_cnpj, telefone, whatsapp, email, endereco, bairro, cep, created_at ' +
      'FROM tb_clientes ORDER BY created_at DESC, id DESC'
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const rows = await db.query('SELECT * FROM tb_clientes WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ erro: 'Cliente não encontrado.' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const erro = validar(req.body);
    if (erro) return res.status(400).json({ erro });
    const b = req.body;
    const r = await db.query(
      'INSERT INTO tb_clientes (nome, cpf_cnpj, telefone, whatsapp, email, endereco, bairro, cep) ' +
      'VALUES (?,?,?,?,?,?,?,?)',
      [b.nome, b.cpf_cnpj || null, b.telefone || null,
       b.whatsapp ? 1 : 0, b.email || null, b.endereco || null, b.bairro || null, b.cep || null]
    );
    res.status(201).json({ id: r.insertId, mensagem: 'Cliente cadastrado com sucesso.' });
  } catch (e) { next(e); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const erro = validar(req.body);
    if (erro) return res.status(400).json({ erro });
    const b = req.body;
    const r = await db.query(
      'UPDATE tb_clientes SET nome=?, cpf_cnpj=?, telefone=?, whatsapp=?, email=?, endereco=?, bairro=?, cep=? ' +
      'WHERE id=?',
      [b.nome, b.cpf_cnpj || null, b.telefone || null,
       b.whatsapp ? 1 : 0, b.email || null, b.endereco || null, b.bairro || null, b.cep || null, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ erro: 'Cliente não encontrado.' });
    res.json({ mensagem: 'Cliente atualizado com sucesso.' });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const r = await db.query('DELETE FROM tb_clientes WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ erro: 'Cliente não encontrado.' });
    res.json({ mensagem: 'Cliente excluído com sucesso.' });
  } catch (e) { next(e); }
});

module.exports = router;