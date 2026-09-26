/* ============================================================
   Autenticação e controle de acesso
   Sessões em cookie httpOnly + token Armonizado (SHA-256 no banco)
   ============================================================ */
'use strict';

const crypto = require('crypto');
const db = require('../db');
const config = require('../config');

/* ------------------------------------------------------------
   Tokens
   ------------------------------------------------------------ */
function gerarToken() {
  return crypto.randomBytes(48).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function ipRequisicao(req) {
  const bruto = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '');
  return bruto.split(',')[0].trim().slice(0, 45) || null;
}

function agenteRequisicao(req) {
  return String(req.headers['user-agent'] || '').slice(0, 255) || null;
}

/* ------------------------------------------------------------
   Cookie
   ------------------------------------------------------------ */
function lerCookie(req, nome) {
  const bruto = req.headers.cookie;
  if (!bruto) return null;
  for (const parte of bruto.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    if (parte.slice(0, i).trim() === nome) {
      return decodeURIComponent(parte.slice(i + 1).trim());
    }
  }
  return null;
}

function opcoesCookie() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    secure: config.app.isProduction
  };
}

function gravarCookie(res, nome, valor, maxAgeMs) {
  res.cookie(nome, valor, { ...opcoesCookie(), maxAge: maxAgeMs });
}

function limparCookie(res) {
  res.clearCookie(config.auth.cookieNome, opcoesCookie());
}

/* ------------------------------------------------------------
   Auditoria
   Nunca lança: falha de log não pode derrubar a requisição.
   ------------------------------------------------------------ */
async function registrarLog(req, dados = {}) {
  try {
    const u = req.usuario;
    await db.query(
      'INSERT INTO tb_log_acesso (usuario_id, usuario_nome, evento, descricao, sucesso, ip) VALUES (?,?,?,?,?,?)',
      [
        dados.usuarioId !== undefined ? dados.usuarioId : (u ? u.id : null),
        dados.usuarioNome !== undefined
          ? dados.usuarioNome
          : (u ? `${u.nome} (${u.usuario})` : null),
        dados.evento,
        dados.descricao ? String(dados.descricao).slice(0, 500) : null,
        dados.sucesso === false ? 0 : 1,
        ipRequisicao(req)
      ]
    );
  } catch (e) {
    console.error('[auditoria] falha ao registrar evento:', e.code || e.message);
  }
}

/* ------------------------------------------------------------
   Permissões efetivas
   Usuário = união das permissões de todos os perfis de seus grupos.
   ------------------------------------------------------------ */
async function resolverAcessos(usuarioId) {
  const [vínculos, permissões] = await Promise.all([
    db.query(
      'SELECT g.id AS grupo_id, g.nome AS grupo, ' +
      '       p.id AS perfil_id, p.nome AS perfil, p.acesso_total ' +
      'FROM tb_usuarios_grupos ug ' +
      'JOIN tb_grupos g ON g.id = ug.grupo_id ' +
      'LEFT JOIN tb_grupos_perfis gp ON gp.grupo_id = g.id ' +
      'LEFT JOIN tb_perfis p ON p.id = gp.perfil_id ' +
      'WHERE ug.usuario_id = ?',
      [usuarioId]
    ),
    db.query(
      'SELECT DISTINCT pe.chave ' +
      'FROM tb_usuarios_grupos ug ' +
      'JOIN tb_grupos_perfis gp ON gp.grupo_id = ug.grupo_id ' +
      'JOIN tb_perfis_permissoes pp ON pp.perfil_id = gp.perfil_id ' +
      'JOIN tb_permissoes pe ON pe.id = pp.permissao_id ' +
      'WHERE ug.usuario_id = ?',
      [usuarioId]
    )
  ]);

  const grupos = [];
  const perfis = [];
  const vistosGrupos = new Set();
  const vistosPerfis = new Set();
  let acessoTotal = false;

  for (const v of vínculos) {
    if (!vistosGrupos.has(v.grupo_id)) {
      vistosGrupos.add(v.grupo_id);
      grupos.push({ id: v.grupo_id, nome: v.grupo });
    }
    if (v.perfil_id && !vistosPerfis.has(v.perfil_id)) {
      vistosPerfis.add(v.perfil_id);
      perfis.push({ id: v.perfil_id, nome: v.perfil, acesso_total: !!v.acesso_total });
    }
    if (v.acesso_total) acessoTotal = true;
  }

  return {
    grupos,
    perfis,
    acesso_total: acessoTotal,
    permissoes: new Set(permissões.map(p => p.chave))
  };
}

// Objeto devolvido ao frontend em /api/auth/me
function montarSessao(usuario, acessos) {
  return {
    id: usuario.id,
    nome: usuario.nome,
    usuario: usuario.usuario,
    email: usuario.email,
    telefone: usuario.telefone,
    cargo: usuario.cargo,
    foto: usuario.foto,
    foto_url: usuario.foto ? `/uploads/${usuario.foto}` : null,
    situacao: usuario.situacao,
    email_verificado: !!usuario.email_verificado,
    deve_alterar_senha: !!usuario.deve_alterar_senha,
    ultimo_acesso: usuario.ultimo_acesso,
    grupos: acessos.grupos,
    perfis: acessos.perfis,
    acesso_total: acessos.acesso_total,
    permissoes: acessos.acesso_total ? null : Array.from(acessos.permissoes).sort()
  };
}

/* Evita gravar ultimo_acesso a cada requisição (no máximo 1 por minuto/sessão) */
const ultimoAcessoGravado = new Map();

function deveGravarAcesso(sessaoId) {
  const agora = Date.now();
  const anterior = ultimoAcessoGravado.get(sessaoId) || 0;
  if (agora - anterior < 60000) return false;
  ultimoAcessoGravado.set(sessaoId, agora);
  return true;
}

/* ------------------------------------------------------------
   Sessões
   ------------------------------------------------------------ */
async function criarSessao(req, res, usuarioId) {
  const token = gerarToken();
  // a expiração é calculada pelo próprio banco (NOW()) para não depender do
  // fuso do processo Node: comparar DATETIME com NOW() exige a mesma base
  await db.query(
    'INSERT INTO tb_sessoes (token_hash, usuario_id, ip, user_agent, expira_em, ultimo_acesso) ' +
    'VALUES (?,?,?,?,DATE_ADD(NOW(), INTERVAL ? HOUR),NOW())',
    [hashToken(token), usuarioId, ipRequisicao(req), agenteRequisicao(req), config.auth.sessaoHoras]
  );
  gravarCookie(res, config.auth.cookieNome, token, config.auth.sessaoHoras * 3600 * 1000);
  return token;
}

async function encerrarSessao(req, res) {
  const token = lerCookie(req, config.auth.cookieNome);
  if (token) {
    await db.query(
      'UPDATE tb_sessoes SET revogada_em = NOW() WHERE token_hash = ? AND revogada_em IS NULL',
      [hashToken(token)]
    ).catch(() => {});
  }
  limparCookie(res);
}

// Encerra todas as sessões do usuário; `excetoToken` preserva a atual.
async function encerrarSessoesDoUsuario(usuarioId, excetoToken = null) {
  const excetoHash = excetoToken ? hashToken(excetoToken) : null;
  const r = await db.query(
    'UPDATE tb_sessoes SET revogada_em = NOW() ' +
    'WHERE usuario_id = ? AND revogada_em IS NULL AND token_hash <> COALESCE(?, "")',
    [usuarioId, excetoHash]
  );
  return r.affectedRows;
}

async function limparSessoesExpiradas() {
  const r = await db.query(
    'DELETE FROM tb_sessoes WHERE expira_em < NOW() OR revogada_em < NOW() - INTERVAL 30 DAY'
  );
  await db.query('DELETE FROM tb_tokens_acesso WHERE expira_em < NOW() - INTERVAL 1 DAY');
  if (r.affectedRows) console.log(`[auth] ${r.affectedRows} sessão(ões) expirada(s) removida(s).`);
}

/* ------------------------------------------------------------
   Tokens enviados por e-mail (recuperação de senha / confirmação)
   ------------------------------------------------------------ */
const TIPOS_TOKEN = ['recuperacao', 'verificacao_email'];

async function gerarTokenAcesso(req, usuarioId, tipo) {
  if (!TIPOS_TOKEN.includes(tipo)) throw new Error('Tipo de token inválido.');
  // invalida os tokens anteriores ainda não usados do mesmo tipo
  await db.query(
    'UPDATE tb_tokens_acesso SET usado_em = NOW() WHERE usuario_id = ? AND tipo = ? AND usado_em IS NULL',
    [usuarioId, tipo]
  );
  const token = gerarToken();
  await db.query(
    'INSERT INTO tb_tokens_acesso (token_hash, usuario_id, tipo, expira_em, criado_ip) ' +
    'VALUES (?,?,?,DATE_ADD(NOW(), INTERVAL ? MINUTE),?)',
    [hashToken(token), usuarioId, tipo, config.auth.recuperacaoMinutos, ipRequisicao(req)]
  );
  return token;
}

async function buscarToken(token, tipo) {
  if (!token || typeof token !== 'string') return null;
  const linhas = await db.query(
    'SELECT t.id, t.usuario_id, u.nome, u.email, u.usuario ' +
    'FROM tb_tokens_acesso t JOIN tb_usuarios u ON u.id = t.usuario_id ' +
    'WHERE t.token_hash = ? AND t.tipo = ? AND t.usado_em IS NULL AND t.expira_em > NOW()',
    [hashToken(token), tipo]
  );
  return linhas.length ? linhas[0] : null;
}

async function usarToken(id) {
  await db.query('UPDATE tb_tokens_acesso SET usado_em = NOW() WHERE id = ?', [id]);
}


/* ------------------------------------------------------------
   Middleware: resolução da sessão
   ------------------------------------------------------------ */
function naoAutenticado(res, extra = {}) {
  return res.status(401).json({ erro: 'Sessão expirada. Entre novamente.', ...extra });
}

async function carregarSessao(req, res, next) {
  req.usuario = null;
  req.motivoDesconexao = null;

  if (!config.auth.enabled) {
    req.authIgnorada = true;
    return next();
  }

  const token = lerCookie(req, config.auth.cookieNome);
  if (!token) return next();

  try {
    // a comparação de tempo é feita no banco: misturar DATETIME do MySQL com
    // Date do Node depende do fuso do processo e invalida a checagem
    const linhas = await db.query(
      'SELECT s.id AS sessao_id, s.token_hash, s.expira_em, s.ultimo_acesso AS sessao_ultimo, ' +
      '       (s.ultimo_acesso IS NULL OR s.ultimo_acesso > DATE_SUB(NOW(), INTERVAL ? MINUTE)) ' +
      '         AS dentro_da_inatividade, ' +
      '       u.id, u.nome, u.usuario, u.email, u.telefone, u.cargo, u.foto, u.situacao, ' +
      '       u.email_verificado, u.deve_alterar_senha, u.ultimo_acesso ' +
      'FROM tb_sessoes s ' +
      'JOIN tb_usuarios u ON u.id = s.usuario_id ' +
      'WHERE s.token_hash = ? AND s.revogada_em IS NULL AND s.expira_em > NOW()',
      [config.auth.inatividadeMinutos, hashToken(token)]
    );

    if (!linhas.length) {
      limparCookie(res);
      return next();
    }

    const u = linhas[0];

    if (u.situacao !== 'ativo') {
      await encerrarSessao(req, res);
      req.motivoDesconexao = 'bloqueado';
      return next();
    }

    // inatividade máxima
    if (!u.dentro_da_inatividade) {
      await encerrarSessao(req, res);
      req.motivoDesconexao = 'inatividade';
      return next();
    }

    // grava o acesso com no máximo 1 atualização por minuto
    if (deveGravarAcesso(u.sessao_id)) {
      db.query('UPDATE tb_sessoes SET ultimo_acesso = NOW() WHERE id = ?', [u.sessao_id])
        .catch(() => {});
    }

    const acessos = await resolverAcessos(u.id);
    req.usuario = montarSessao(u, acessos);
    return next();
  } catch (e) {
    return next(e);
  }
}

/* ------------------------------------------------------------
   Middleware: exigência de autenticação
   ------------------------------------------------------------ */
function exigirLogin(req, res, next) {
  if (req.authIgnorada) return next();
  if (!req.usuario) {
    return naoAutenticado(res, req.motivoDesconexao ? { motivo: req.motivoDesconexao } : {});
  }
  return next();
}

function exigirPermissao(chave) {
  return (req, res, next) => {
    if (req.authIgnorada) return next();
    if (!req.usuario) return naoAutenticado(res);
    if (req.usuario.acesso_total || req.usuario.permissoes === null || req.usuario.permissoes.includes(chave)) {
      return next();
    }
    return res.status(403).json({ erro: 'Você não tem permissão para esta ação.' });
  };
}

module.exports = {
  gerarToken,
  hashToken,
  gerarTokenAcesso,
  buscarToken,
  usarToken,
  ipRequisicao,
  agenteRequisicao,
  lerCookie,
  opcoesCookie,
  gravarCookie,
  limparCookie,
  registrarLog,
  resolverAcessos,
  montarSessao,
  criarSessao,
  encerrarSessao,
  encerrarSessoesDoUsuario,
  limparSessoesExpiradas,
  carregarSessao,
  exigirLogin,
  exigirPermissao
};
