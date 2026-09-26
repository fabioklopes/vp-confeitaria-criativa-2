const express = require('express');
const db = require('../db');
const auth = require('../lib/auth');

const router = express.Router();

router.use(auth.exigirLogin, auth.exigirPermissao('precificacao.ver'));
const EXIGIR_EDITAR = auth.exigirPermissao('precificacao.editar');

function validar(body) {
  if (!body.nome) return 'Informe o nome do produto/precificação.';
  if (!Array.isArray(body.itens) || !body.itens.length) return 'Adicione pelo menos um item (insumo ou receita pronta).';
  for (const it of body.itens) {
    const tipo = it.tipo;
    if (tipo !== 'insumo' && tipo !== 'receita') return 'Item inválido: informe tipo insumo ou receita.';
    if (tipo === 'insumo' && !it.insumo_id) return 'Item do tipo insumo deve indicar o insumo.';
    if (tipo === 'receita' && !it.receita_id) return 'Item do tipo receita deve indicar a receita pronta.';
    if (it.quantidade == null || Number(it.quantidade) <= 0) return 'Todo item deve ter quantidade maior que zero.';
  }
  return null;
}

async function validarInteiros(itens) {
  const ids = [...new Set(itens
    .filter(it => it.tipo === 'insumo' && it.insumo_id)
    .map(it => it.insumo_id))];
  if (!ids.length) return null;
  const rows = await db.query(
    'SELECT i.id, i.produto, m.descricao AS medida, m.inteiro FROM tb_insumos i ' +
    'LEFT JOIN tb_medidas m ON m.id = i.medida_id WHERE i.id IN (?)', [ids]
  );
  const map = new Map(rows.map(r => [r.id, r]));
  for (const it of itens) {
    if (it.tipo !== 'insumo') continue;
    const row = map.get(Number(it.insumo_id));
    if (row && row.inteiro && !Number.isInteger(Number(it.quantidade))) {
      return `O insumo "${row.produto}" usa a medida "${row.medida}": a quantidade deve ser um número inteiro positivo.`;
    }
  }
  return null;
}

// Lista precificações com o valor calculado na hora (nunca gravado).
router.get('/', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT p.id, p.nome, p.descricao, p.created_at, COUNT(pi.id) AS itens,
        COALESCE(SUM(
          CASE WHEN pi.tipo = 'insumo'
            THEN pi.quantidade * (i.valor / NULLIF(i.quantidade_compra, 0))
            ELSE pi.quantidade * (
              SELECT COALESCE(SUM(ri.quantidade * (j.valor / NULLIF(j.quantidade_compra, 0))), 0)
              FROM tb_receita_itens ri JOIN tb_insumos j ON j.id = ri.insumo_id
              WHERE ri.receita_id = pi.receita_id
            )
          END
        ), 0) AS valor_calculado
       FROM tb_precificacao p
       LEFT JOIN tb_precificacao_itens pi ON pi.precificacao_id = p.id
       LEFT JOIN tb_insumos i ON i.id = pi.insumo_id
       GROUP BY p.id ORDER BY p.created_at DESC, p.id DESC`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const prec = await db.query('SELECT * FROM tb_precificacao WHERE id = ?', [req.params.id]);
    if (!prec.length) return res.status(404).json({ erro: 'Precificação não encontrada.' });
    const itens = await db.query(
      `SELECT pi.id, pi.tipo, pi.insumo_id, pi.receita_id, pi.quantidade,
        i.produto, i.valor, i.quantidade_compra, m.descricao AS medida, m.inteiro AS medida_inteiro,
        r.nome AS receita_nome,
        CASE WHEN pi.tipo = 'insumo'
          THEN pi.quantidade * (i.valor / NULLIF(i.quantidade_compra, 0))
          ELSE pi.quantidade * (
            SELECT COALESCE(SUM(ri.quantidade * (j.valor / NULLIF(j.quantidade_compra, 0))), 0)
            FROM tb_receita_itens ri JOIN tb_insumos j ON j.id = ri.insumo_id
            WHERE ri.receita_id = pi.receita_id
          )
        END AS valor_item
       FROM tb_precificacao_itens pi
       LEFT JOIN tb_insumos i ON i.id = pi.insumo_id
       LEFT JOIN tb_medidas m ON m.id = i.medida_id
       LEFT JOIN tb_receitas r ON r.id = pi.receita_id
       WHERE pi.precificacao_id = ? ORDER BY pi.id`, [req.params.id]
    );
    const total = itens.reduce((acc, it) => acc + Number(it.valor_item || 0), 0);
    res.json({ ...prec[0], itens, valor_calculado: total });
  } catch (e) { next(e); }
});

async function salvarItens(id, itens) {
  await db.query('DELETE FROM tb_precificacao_itens WHERE precificacao_id = ?', [id]);
  for (const it of itens) {
    const insumoId = it.tipo === 'insumo' ? it.insumo_id : null;
    const receitaId = it.tipo === 'receita' ? it.receita_id : null;
    await db.query(
      'INSERT INTO tb_precificacao_itens (precificacao_id, tipo, insumo_id, receita_id, quantidade) VALUES (?,?,?,?,?)',
      [id, it.tipo, insumoId, receitaId, it.quantidade]
    );
  }
}

router.post('/', EXIGIR_EDITAR, async (req, res, next) => {
  try {
    const erro = validar(req.body);
    if (erro) return res.status(400).json({ erro });
    const erroInt = await validarInteiros(req.body.itens);
    if (erroInt) return res.status(400).json({ erro: erroInt });
    const r = await db.query('INSERT INTO tb_precificacao (nome, descricao) VALUES (?,?)', [req.body.nome, req.body.descricao || null]);
    await salvarItens(r.insertId, req.body.itens);
    res.status(201).json({ id: r.insertId, mensagem: 'Precificação cadastrada com sucesso.' });
  } catch (e) { next(e); }
});

router.put('/:id', EXIGIR_EDITAR, async (req, res, next) => {
  try {
    const erro = validar(req.body);
    if (erro) return res.status(400).json({ erro });
    const erroInt = await validarInteiros(req.body.itens);
    if (erroInt) return res.status(400).json({ erro: erroInt });
    const r = await db.query('UPDATE tb_precificacao SET nome=?, descricao=? WHERE id=?', [req.body.nome, req.body.descricao || null, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ erro: 'Precificação não encontrada.' });
    await salvarItens(req.params.id, req.body.itens);
    res.json({ mensagem: 'Precificação atualizada com sucesso.' });
  } catch (e) { next(e); }
});

router.delete('/:id', EXIGIR_EDITAR, async (req, res, next) => {
  try {
    const r = await db.query('DELETE FROM tb_precificacao WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ erro: 'Precificação não encontrada.' });
    res.json({ mensagem: 'Precificação excluída com sucesso.' });
  } catch (e) { next(e); }
});

module.exports = router;