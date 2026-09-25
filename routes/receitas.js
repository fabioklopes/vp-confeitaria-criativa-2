const express = require('express');
const db = require('../db');

const router = express.Router();

function validar(body) {
  if (!body.nome) return 'Informe o nome da receita.';
  if (!Array.isArray(body.itens) || !body.itens.length) return 'Adicione pelo menos um insumo à receita.';
  for (const it of body.itens) {
    if (!it.insumo_id) return 'Todo item deve ter um insumo.';
    if (it.quantidade == null || Number(it.quantidade) <= 0) return 'Todo item deve ter quantidade maior que zero.';
  }
  return null;
}

// Verifica quantidades inteiras quando o insumo usa medida com flag "inteiro".
async function validarInteiros(itens) {
  const ids = [...new Set(itens.map(it => it.insumo_id))];
  if (!ids.length) return null;
  const rows = await db.query(
    'SELECT i.id, i.produto, m.descricao AS medida, m.inteiro FROM tb_insumos i ' +
    'LEFT JOIN tb_medidas m ON m.id = i.medida_id WHERE i.id IN (?)', [ids]
  );
  const map = new Map(rows.map(r => [r.id, r]));
  for (const it of itens) {
    const row = map.get(Number(it.insumo_id));
    if (row && row.inteiro && !Number.isInteger(Number(it.quantidade))) {
      return `O insumo "${row.produto}" usa a medida "${row.medida}": a quantidade deve ser um número inteiro positivo.`;
    }
  }
  return null;
}

// Lista receitas com custo calculado na hora (não é gravado em tabela).
router.get('/', async (req, res, next) => {
  try {
    const rows = await db.query(
      'SELECT r.id, r.nome, r.created_at, COUNT(ri.id) AS itens, ' +
      'COALESCE(SUM(ri.quantidade * (i.valor / NULLIF(i.quantidade_compra, 0))), 0) AS custo_calculado ' +
      'FROM tb_receitas r ' +
      'LEFT JOIN tb_receita_itens ri ON ri.receita_id = r.id ' +
      'LEFT JOIN tb_insumos i ON i.id = ri.insumo_id ' +
      'GROUP BY r.id ORDER BY r.created_at DESC, r.id DESC'
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const rec = await db.query('SELECT * FROM tb_receitas WHERE id = ?', [req.params.id]);
    if (!rec.length) return res.status(404).json({ erro: 'Receita não encontrada.' });
    const [recId, custo] = await Promise.all([
      rec[0],
      (async () => {
        const r = await db.query(
          'SELECT COALESCE(SUM(ri.quantidade * (i.valor / NULLIF(i.quantidade_compra, 0))), 0) AS c ' +
          'FROM tb_receita_itens ri JOIN tb_insumos i ON i.id = ri.insumo_id WHERE ri.receita_id = ?',
          [req.params.id]
        );
        return r[0].c;
      })()
    ]);
    const itens = await db.query(
      'SELECT ri.id, ri.insumo_id, ri.quantidade, i.produto, i.valor, i.quantidade_compra, ' +
      'i.medida_id, m.descricao AS medida, m.inteiro AS medida_inteiro, ' +
      '(ri.quantidade * (i.valor / NULLIF(i.quantidade_compra, 0))) AS custo_item ' +
      'FROM tb_receita_itens ri ' +
      'JOIN tb_insumos i ON i.id = ri.insumo_id ' +
      'LEFT JOIN tb_medidas m ON m.id = i.medida_id ' +
      'WHERE ri.receita_id = ? ORDER BY ri.id', [req.params.id]
    );
    res.json({ ...recId, itens, custo_calculado: custo });
  } catch (e) { next(e); }
});

async function salvarItens(id, itens) {
  await db.query('DELETE FROM tb_receita_itens WHERE receita_id = ?', [id]);
  for (const it of itens) {
    await db.query(
      'INSERT INTO tb_receita_itens (receita_id, insumo_id, quantidade) VALUES (?,?,?)',
      [id, it.insumo_id, it.quantidade]
    );
  }
}

router.post('/', async (req, res, next) => {
  try {
    const erro = validar(req.body);
    if (erro) return res.status(400).json({ erro });
    const erroInt = await validarInteiros(req.body.itens);
    if (erroInt) return res.status(400).json({ erro: erroInt });
    const r = await db.query('INSERT INTO tb_receitas (nome) VALUES (?)', [req.body.nome]);
    await salvarItens(r.insertId, req.body.itens);
    res.status(201).json({ id: r.insertId, mensagem: 'Receita cadastrada com sucesso.' });
  } catch (e) { next(e); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const erro = validar(req.body);
    if (erro) return res.status(400).json({ erro });
    const erroInt = await validarInteiros(req.body.itens);
    if (erroInt) return res.status(400).json({ erro: erroInt });
    const r = await db.query('UPDATE tb_receitas SET nome = ? WHERE id = ?', [req.body.nome, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ erro: 'Receita não encontrada.' });
    await salvarItens(req.params.id, req.body.itens);
    res.json({ mensagem: 'Receita atualizada com sucesso.' });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const r = await db.query('DELETE FROM tb_receitas WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ erro: 'Receita não encontrada.' });
    res.json({ mensagem: 'Receita excluída com sucesso.' });
  } catch (e) { next(e); }
});

module.exports = router;