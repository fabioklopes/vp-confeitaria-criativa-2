const express = require('express');
const db = require('../db');
const auth = require('../lib/auth');

const router = express.Router();

const LISTAR = auth.exigirPermissao('grupos.ver');
const EDITAR = auth.exigirPermissao('grupos.editar');

router.use(auth.exigirLogin);

const COLS = `g.id, g.nome, g.descricao, g.sistema, g.created_at, g.updated_at,
  (SELECT COUNT(*) FROM tb_usuarios_grupos ug WHERE ug.grupo_id = g.id) AS total_usuarios,
  (SELECT COUNT(*) FROM tb_grupos_perfis gp WHERE gp.grupo_id = g.id) AS total_perfis,
  (EXISTS(
    SELECT 1 FROM tb_grupos_perfis gp2
    JOIN tb_perfis p2 ON p2.id = gp2.perfil_id
    WHERE gp2.grupo_id = g.id AND p2.acesso_total = 1
  )) AS acesso_total`;

function formatar(g) {
  return { ...g, sistema: !!g.sistema, acesso_total: !!g.acesso_total };
}

function validar(body) {
  if (!body.nome || !String(body.nome).trim()) return 'Informe o nome do grupo.';
  if (String(body.nome).length > 80) return 'O nome deve ter no máximo 80 caracteres.';
  if (body.descricao && String(body.descricao).length > 255) {
    return 'A descrição deve ter no máximo 255 caracteres.';
  }
  return null;
}

async function carregar(id) {
  const linhas = await db.query(`SELECT ${COLS} FROM tb_grupos g WHERE g.id = ?`, [id]);
  if (!linhas.length) return null;
  const grupo = formatar(linhas[0]);
  const perfis = await db.query(
    'SELECT p.id, p.nome, p.acesso_total FROM tb_grupos_perfis gp ' +
    'JOIN tb_perfis p ON p.id = gp.perfil_id WHERE gp.grupo_id = ? ORDER BY p.nome',
    [id]
  );
  grupo.perfis = perfis.map(p => ({ ...p, acesso_total: !!p.acesso_total }));
  return grupo;
}

async function nomeEmUso(nome, id = null) {
  const linhas = await db.query(
    id ? 'SELECT id FROM tb_grupos WHERE nome = ? AND id <> ?' : 'SELECT id FROM tb_grupos WHERE nome = ?',
    id ? [nome, id] : [nome]
  );
  return linhas.length > 0;
}

function idsDe(valor) {
  if (valor === undefined || valor === null || valor === '') return [];
  let lista = valor;
  if (typeof lista === 'string') {
    const bruto = lista.trim();
    if (bruto.startsWith('[')) {
      try { lista = JSON.parse(bruto); } catch (e) { lista = bruto.split(','); }
    } else {
      lista = bruto.split(',');
    }
  }
  if (!Array.isArray(lista)) lista = [lista];
  return [...new Set(lista.map(v => Number(v)).filter(v => Number.isInteger(v) && v > 0))];
}

async function substituirPerfis(grupoId, perfilIds) {
  if (!perfilIds.length) {
    await db.query('DELETE FROM tb_grupos_perfis WHERE grupo_id = ?', [grupoId]);
    return;
  }
  const placeholders = perfilIds.map(() => '?').join(',');
  const validos = await db.query(`SELECT id FROM tb_perfis WHERE id IN (${placeholders})`, perfilIds);
  const ids = validos.map(p => p.id);
  if (!ids.length) {
    await db.query('DELETE FROM tb_grupos_perfis WHERE grupo_id = ?', [grupoId]);
    return;
  }
  const ph = ids.map(() => '?').join(',');
  await db.query(
    `DELETE FROM tb_grupos_perfis WHERE grupo_id = ? AND perfil_id NOT IN (${ph})`,
    [grupoId, ...ids]
  );
  for (const id of ids) {
    await db.query('INSERT IGNORE INTO tb_grupos_perfis (grupo_id, perfil_id) VALUES (?,?)', [grupoId, id]);
  }
}

/* ============================================================ */
router.get('/', LISTAR, async (req, res, next) => {
  try {
    const linhas = await db.query(`SELECT ${COLS} FROM tb_grupos g ORDER BY g.nome ASC`);
    res.json(linhas.map(formatar));
  } catch (e) { next(e); }
});

router.get('/:id', LISTAR, async (req, res, next) => {
  try {
    const grupo = await carregar(req.params.id);
    if (!grupo) return res.status(404).json({ erro: 'Grupo não encontrado.' });
    res.json(grupo);
  } catch (e) { next(e); }
});

router.get('/:id/usuarios', LISTAR, async (req, res, next) => {
  try {
    const linhas = await db.query(
      'SELECT u.id, u.nome, u.usuario, u.email, u.foto, u.situacao FROM tb_usuarios_grupos ug ' +
      'JOIN tb_usuarios u ON u.id = ug.usuario_id WHERE ug.grupo_id = ? ORDER BY u.nome',
      [req.params.id]
    );
    res.json(linhas.map(u => ({ ...u, foto_url: u.foto ? `/uploads/${u.foto}` : null })));
  } catch (e) { next(e); }
});

router.post('/', EDITAR, async (req, res, next) => {
  try {
    const erro = validar(req.body);
    if (erro) return res.status(400).json({ erro });
    const nome = String(req.body.nome).trim();
    if (await nomeEmUso(nome)) return res.status(409).json({ erro: 'Já existe um grupo com este nome.' });

    const r = await db.query('INSERT INTO tb_grupos (nome, descricao) VALUES (?,?)',
      [nome, req.body.descricao ? String(req.body.descricao).trim() : null]);

    if (req.body.perfis !== undefined) await substituirPerfis(r.insertId, idsDe(req.body.perfis));

    await auth.registrarLog(req, {
      evento: 'grupo.criado',
      descricao: `Grupo "${nome}" criado.`
    });
    res.status(201).json({ id: r.insertId, mensagem: 'Grupo criado com sucesso.' });
  } catch (e) { next(e); }
});

router.put('/:id', EDITAR, async (req, res, next) => {
  try {
    const atual = await carregar(req.params.id);
    if (!atual) return res.status(404).json({ erro: 'Grupo não encontrado.' });

    const erro = validar(req.body);
    if (erro) return res.status(400).json({ erro });
    const nome = String(req.body.nome).trim();
    if (await nomeEmUso(nome, atual.id)) return res.status(409).json({ erro: 'Já existe um grupo com este nome.' });

    await db.query('UPDATE tb_grupos SET nome = ?, descricao = ? WHERE id = ?',
      [nome, req.body.descricao ? String(req.body.descricao).trim() : null, atual.id]);

    if (req.body.perfis !== undefined) {
      if (atual.sistema) {
        return res.status(400).json({
          erro: `Os perfis do grupo nativo "${atual.nome}" não podem ser alterados.`
        });
      }
      await substituirPerfis(atual.id, idsDe(req.body.perfis));
    }

    await auth.registrarLog(req, { evento: 'grupo.editado', descricao: `Grupo "${nome}" atualizado.` });
    res.json({ mensagem: 'Grupo atualizado com sucesso.' });
  } catch (e) { next(e); }
});

router.put('/:id/perfis', EDITAR, async (req, res, next) => {
  try {
    const atual = await carregar(req.params.id);
    if (!atual) return res.status(404).json({ erro: 'Grupo não encontrado.' });
    if (atual.sistema) {
      return res.status(400).json({ erro: `Os perfis do grupo nativo "${atual.nome}" não podem ser alterados.` });
    }
    await substituirPerfis(atual.id, idsDe(req.body.perfis));
    await auth.registrarLog(req, {
      evento: 'grupo.perfis_alterados',
      descricao: `Perfis do grupo "${atual.nome}" redefinidos.`
    });
    res.json({ mensagem: 'Perfis do grupo atualizados com sucesso.' });
  } catch (e) { next(e); }
});

router.delete('/:id', EDITAR, async (req, res, next) => {
  try {
    const atual = await carregar(req.params.id);
    if (!atual) return res.status(404).json({ erro: 'Grupo não encontrado.' });
    if (atual.sistema) {
      return res.status(400).json({ erro: `O grupo nativo "${atual.nome}" não pode ser excluído.` });
    }

    await db.query('DELETE FROM tb_grupos WHERE id = ?', [atual.id]);
    await auth.registrarLog(req, {
      evento: 'grupo.excluido',
      descricao: `Grupo "${atual.nome}" excluído (${atual.total_usuarios} usuário(s)).`
    });
    res.json({ mensagem: 'Grupo excluído com sucesso.' });
  } catch (e) { next(e); }
});

module.exports = router;
