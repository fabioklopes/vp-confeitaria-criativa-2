const express = require('express');
const db = require('../db');
const auth = require('../lib/auth');

const router = express.Router();

router.use(auth.exigirLogin, auth.exigirPermissao('dashboard.ver'));

const LIMIT = 5;

router.get('/', async (req, res, next) => {
  try {
    const queries = {
      clientes: db.query(
        'SELECT id, nome AS titulo, "clientes" AS secao, created_at FROM tb_clientes ORDER BY created_at DESC, id DESC LIMIT ?',
        [LIMIT]
      ),
      campanhas: db.query(
        'SELECT id, nome AS titulo, "campanhas" AS secao, created_at FROM tb_capanhas ORDER BY created_at DESC, id DESC LIMIT ?',
        [LIMIT]
      ),
      insumos: db.query(
        'SELECT id, produto AS titulo, "insumos" AS secao, created_at FROM tb_insumos ORDER BY created_at DESC, id DESC LIMIT ?',
        [LIMIT]
      ),
      receitas: db.query(
        'SELECT id, nome AS titulo, "receitas" AS secao, created_at FROM tb_receitas ORDER BY created_at DESC, id DESC LIMIT ?',
        [LIMIT]
      ),
      precificacao: db.query(
        'SELECT id, nome AS titulo, "precificacao" AS secao, created_at FROM tb_precificacao ORDER BY created_at DESC, id DESC LIMIT ?',
        [LIMIT]
      )
    };
    const contagens = {
      clientes: db.query('SELECT COUNT(*) c FROM tb_clientes'),
      campanhas: db.query('SELECT COUNT(*) c FROM tb_capanhas'),
      insumos: db.query('SELECT COUNT(*) c FROM tb_insumos'),
      receitas: db.query('SELECT COUNT(*) c FROM tb_receitas'),
      precificacao: db.query('SELECT COUNT(*) c FROM tb_precificacao'),
      caixa: db.query(
        `SELECT
          COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END), 0) AS saldo
         FROM tb_caixa`
      )
    };

    const [clientes, campanhas, insumos, receitas, precificacao] = await Promise.all([
      queries.clientes, queries.campanhas, queries.insumos, queries.receitas, queries.precificacao
    ]);
    const [cClientes, cCampanhas, cInsumos, cReceitas, cPrecificacao, caixa] = await Promise.all([
      contagens.clientes, contagens.campanhas, contagens.insumos,
      contagens.receitas, contagens.precificacao, contagens.caixa
    ]);

    res.json({
      recentes: { clientes, campanhas, insumos, receitas, precificacao },
      totais: {
        clientes: cClientes[0].c,
        campanhas: cCampanhas[0].c,
        insumos: cInsumos[0].c,
        receitas: cReceitas[0].c,
        precificacao: cPrecificacao[0].c,
        saldo_caixa: caixa[0].saldo
      }
    });
  } catch (e) { next(e); }
});

module.exports = router;