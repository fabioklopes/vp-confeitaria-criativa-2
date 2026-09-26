const express = require('express');
const db = require('../db');
const auth = require('../lib/auth');
const catalogo = require('../lib/permissoes');

const router = express.Router();

const LISTAR = auth.exigirPermissao('perfis.ver');
const EDITAR = auth.exigirPermissao('perfis.editar');

router.use(auth.exigirLogin);

const COLS = `p.id, p.nome, p.descricao, p.acesso_total, p.sistema, p.created_at, p.updated_at,
  (SELECT COUNT(*) FROM tb_perfis_permissoes pp WHERE pp.perfil_id = p.id) AS total_permissoes,
  (SELECT COUNT(*) FROM tb_grupos_perfis gp WHERE gp.perfil_id = p.id) AS total_grupos`;

function formatar(p) {
  return { ...p, sistema: !!p.sistema, acesso_total: !!p.acesso_total };
}

function validar(body) {
  if (!body.nome || !String(body.nome).trim()) return 'Informe o nome do perfil.';
  if (String(body.nome).length > 80) return 'O nome deve ter no máximo 80 caracteres.';
  if (body.descricao && String(body.descricao).length > 255) {
    return 'A descrição deve ter no máximo 255 caracteres.';
  }
  return null;
}

function chavesDe(valor) {
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
  return [...new Set(lista.map(String).map(v => v.trim()).filter(Boolean))];
}

async function carregar(id) {
  const linhas = await db.query(`SELECT ${COLS} FROM tb_perfis p WHERE p.id = ?`, [id]);
  if (!linhas.length) return null;
  const perfil = formatar(linhas[0]);
  const permissoes = await db.query(
    'SELECT pe.chave, pe.rotulo, pe.modulo FROM tb_perfis_permissoes pp ' +
    'JOIN tb_permissoes pe ON pe.id = pp.permissao_id WHERE pp.perfil_id = ? ORDER BY pe.modulo, pe.rotulo',
    [id]
  );
  perfil.permissoes = permissoes;
  return perfil;
}

async function nomeEmUso(nome, id = null) {
  const linhas = await db.query(
    id ? 'SELECT id FROM tb_perfis WHERE nome = ? AND id <> ?' : 'SELECT id FROM tb_perfis WHERE nome = ?',
    id ? [nome, id] : [nome]
  );
  return linhas.length > 0;
}

async function aplicarPermissoes(perfilId, chaves) {
  await db.query('DELETE FROM tb_perfis_permissoes WHERE perfil_id = ?', [perfilId]);
  if (!chaves.length) return 0;
  const placeholders = chaves.map(() => '?').join(',');
  const linhas = await db.query(`SELECT id, chave FROM tb_permissoes WHERE chave IN (${placeholders})`, chaves);
  for (const p of linhas) {
    await db.query('INSERT IGNORE INTO tb_perfis_permissoes (perfil_id, permissao_id) VALUES (?,?)', [perfilId, p.id]);
  }
  return linhas.length;
}

/* ============================================================ */
router.get('/', LISTAR, async (req, res, next) => {
  try {
    const linhas = await db.query(`SELECT ${COLS} FROM tb_perfis p ORDER BY p.acesso_total DESC, p.nome ASC`);
    res.json(linhas.map(formatar));
  } catch (e) { next(e); }
});

// catálogo de permissões disponíveis (usado ao montar o formulário)
router.get('/catalogo', LISTAR, (req, res) => {
  res.json({ modulos: catalogo.agrupadas() });
});

router.get('/:id', LISTAR, async (req, res, next) => {
  try {
    const perfil = await carregar(req.params.id);
    if (!perfil) return res.status(404).json({ erro: 'Perfil não encontrado.' });
    res.json(perfil);
  } catch (e) { next(e); }
});

router.post('/', EDITAR, async (req, res, next) => {
  try {
    const erro = validar(req.body);
    if (erro) return res.status(400).json({ erro });
    const nome = String(req.body.nome).trim();
    if (await nomeEmUso(nome)) return res.status(409).json({ erro: 'Já existe um perfil com este nome.' });

    const chaves = chavesDe(req.body.permissoes);
    const invalidas = chaves.filter(c => !catalogo.chaveValida(c));
    if (invalidas.length) return res.status(400).json({ erro: `Permissão desconhecida: ${invalidas[0]}.` });

    const acessoTotal = req.body.acesso_total === true || req.body.acesso_total === 1 || req.body.acesso_total === '1';
    const r = await db.query(
      'INSERT INTO tb_perfis (nome, descricao, acesso_total) VALUES (?,?,?)',
      [nome, req.body.descricao ? String(req.body.descricao).trim() : null, acessoTotal ? 1 : 0]
    );
    const aplicadas = await aplicarPermissoes(r.insertId, acessoTotal ? [] : chaves);

    await auth.registrarLog(req, {
      evento: 'perfil.criado',
      descricao: `Perfil "${nome}" criado com ${aplicadas} permissão(ões).`
    });
    res.status(201).json({ id: r.insertId, mensagem: 'Perfil criado com sucesso.' });
  } catch (e) { next(e); }
});

router.put('/:id', EDITAR, async (req, res, next) => {
  try {
    const atual = await carregar(req.params.id);
    if (!atual) return res.status(404).json({ erro: 'Perfil não encontrado.' });

    const erro = validar(req.body);
    if (erro) return res.status(400).json({ erro });
    const nome = String(req.body.nome).trim();
    if (await nomeEmUso(nome, atual.id)) return res.status(409).json({ erro: 'Já existe um perfil com este nome.' });

    if (atual.sistema && (req.body.permissoes !== undefined || req.body.acesso_total !== undefined)) {
      return res.status(400).json({
        erro: `As permissões do perfil nativo "${atual.nome}" não podem ser alteradas.`
      });
    }

    const chaves = chavesDe(req.body.permissoes);
    const invalidas = chaves.filter(c => !catalogo.chaveValida(c));
    if (invalidas.length) return res.status(400).json({ erro: `Permissão desconhecida: ${invalidas[0]}.` });

    const acessoTotal = req.body.acesso_total === true || req.body.acesso_total === 1 || req.body.acesso_total === '1';
    await db.query('UPDATE tb_perfis SET nome = ?, descricao = ?, acesso_total = ? WHERE id = ?',
      [nome, req.body.descricao ? String(req.body.descricao).trim() : null, acessoTotal ? 1 : 0, atual.id]);

    if (req.body.permissoes !== undefined) {
      await aplicarPermissoes(atual.id, acessoTotal ? [] : chaves);
    }

    await auth.registrarLog(req, { evento: 'perfil.editado', descricao: `Perfil "${nome}" atualizado.` });
    res.json({ mensagem: 'Perfil atualizado com sucesso.' });
  } catch (e) { next(e); }
});

router.delete('/:id', EDITAR, async (req, res, next) => {
  try {
    const linhas = await db.query('SELECT id, nome, sistema FROM tb_perfis WHERE id = ?', [req.params.id]);
    if (!linhas.length) return res.status(404).json({ erro: 'Perfil não encontrado.' });
    if (linhas[0].sistema) {
      return res.status(400).json({ erro: `O perfil nativo "${linhas[0].nome}" não pode ser excluído.` });
    }
    await db.query('DELETE FROM tb_perfis WHERE id = ?', [req.params.id]);
    await auth.registrarLog(req, { evento: 'perfil.excluido', descricao: `Perfil "${linhas[0].nome}" excluído.` });
    res.json({ mensagem: 'Perfil excluído com sucesso.' });
  } catch (e) { next(e); }
});

module.exports = router;
