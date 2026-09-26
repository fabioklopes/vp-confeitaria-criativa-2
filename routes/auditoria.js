const express = require('express');
const db = require('../db');
const auth = require('../lib/auth');

const router = express.Router();

router.use(auth.exigirLogin, auth.exigirPermissao('auditoria.ver'));

const DATA = /^\d{4}-\d{2}-\d{2}$/;

router.get('/', async (req, res, next) => {
  try {
    const filtros = ['1 = 1'];
    const params = [];

    if (req.query.evento) {
      filtros.push('evento = ?');
      params.push(String(req.query.evento).slice(0, 60));
    }
    if (req.query.usuario_id) {
      filtros.push('usuario_id = ?');
      params.push(Number(req.query.usuario_id));
    }
    if (req.query.sucesso === '0' || req.query.sucesso === '1') {
      filtros.push('sucesso = ?');
      params.push(Number(req.query.sucesso));
    }
    if (DATA.test(req.query.de || '')) {
      filtros.push('DATE(created_at) >= ?');
      params.push(req.query.de);
    }
    if (DATA.test(req.query.ate || '')) {
      filtros.push('DATE(created_at) <= ?');
      params.push(req.query.ate);
    }
    if (req.query.q) {
      filtros.push('(usuario_nome LIKE ? OR descricao LIKE ? OR ip LIKE ?)');
      const like = `%${String(req.query.q).trim()}%`;
      params.push(like, like, like);
    }

    const limite = Math.min(500, Math.max(10, Number(req.query.limite) || 100));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const onde = filtros.join(' AND ');

    const [linhas, total, eventos] = await Promise.all([
      db.query(
        `SELECT id, usuario_id, usuario_nome, evento, descricao, sucesso, ip, created_at
         FROM tb_log_acesso WHERE ${onde} ORDER BY id DESC LIMIT ? OFFSET ?`,
        [...params, limite, offset]
      ),
      db.query(`SELECT COUNT(*) total FROM tb_log_acesso WHERE ${onde}`, params),
      db.query('SELECT DISTINCT evento FROM tb_log_acesso ORDER BY evento')
    ]);

    res.json({
      registros: linhas,
      total: total[0].total,
      limite,
      offset,
      eventos: eventos.map(e => e.evento)
    });
  } catch (e) { next(e); }
});

module.exports = router;
