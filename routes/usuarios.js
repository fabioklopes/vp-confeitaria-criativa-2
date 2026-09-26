const express = require('express');
const db = require('../db');
const config = require('../config');
const auth = require('../lib/auth');
const senha = require('../lib/senha');
const mailer = require('../lib/mailer');
const foto = require('../lib/foto');

const router = express.Router();

const LISTAR = auth.exigirPermissao('usuarios.ver');
const EDITAR = auth.exigirPermissao('usuarios.editar');

router.use(auth.exigirLogin);

/* ------------------------------------------------------------
   Utilitários
   ------------------------------------------------------------ */
function flag(value) {
  return value === true || value === 1 || value === '1' ? 1 : 0;
}

// FormData entrega tudo como texto: aceita array, JSON ou "1,2"
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

function telefoneValido(telefone) {
  if (!telefone) return true;
  return /^\+?[0-9\s()-]{8,30}$/.test(String(telefone).trim());
}

function validar(body, { novo = false } = {}) {
  if (novo || body.nome !== undefined) {
    if (!body.nome || !String(body.nome).trim()) return 'Informe o nome do usuário.';
    if (String(body.nome).length > 150) return 'O nome deve ter no máximo 150 caracteres.';
  }
  if (novo || body.usuario !== undefined) {
    if (!body.usuario || !String(body.usuario).trim()) return 'Informe o nome de acesso.';
    if (!/^[A-Za-z0-9._-]{3,60}$/.test(String(body.usuario).trim())) {
      return 'O nome de acesso deve ter de 3 a 60 caracteres, usando letras, números, ponto, hífen ou sublinhado.';
    }
  }
  if (novo || body.email !== undefined) {
    if (!mailer.emailValido(body.email)) return 'Informe um e-mail válido.';
  }
  if (!telefoneValido(body.telefone)) return 'Informe um telefone de contato válido.';
  if (body.cargo && String(body.cargo).length > 120) return 'O cargo deve ter no máximo 120 caracteres.';
  if (body.senha) {
    const erro = senha.validarPolitica(body.senha);
    if (erro) return erro;
  }
  return null;
}

const COLS = `u.id, u.nome, u.usuario, u.email, u.telefone, u.cargo, u.foto, u.situacao,
  u.email_verificado, u.deve_alterar_senha, u.tentativas_falhas, u.bloqueio_ate,
  u.bloqueado_em, u.bloqueado_motivo, u.ultimo_acesso, u.ultimo_ip, u.created_at,
  (u.bloqueio_ate IS NOT NULL AND u.bloqueio_ate > NOW()) AS bloqueio_ativo,
  GROUP_CONCAT(g.id ORDER BY g.nome) grupo_ids,
  GROUP_CONCAT(g.nome ORDER BY g.nome SEPARATOR ' || ') grupo_nomes,
  EXISTS(
    SELECT 1 FROM tb_usuarios_grupos ug2
    JOIN tb_grupos_perfis gp2 ON gp2.grupo_id = ug2.grupo_id
    JOIN tb_perfis p2 ON p2.id = gp2.perfil_id
    WHERE ug2.usuario_id = u.id AND p2.acesso_total = 1
  ) acesso_total`;

function formatar(u) {
  return {
    ...u,
    foto_url: foto.urlFoto(u.foto),
    situacao: u.situacao,
    email_verificado: !!u.email_verificado,
    deve_alterar_senha: !!u.deve_alterar_senha,
    acesso_total: !!u.acesso_total,
    bloqueado: u.situacao === 'bloqueado' || !!u.bloqueio_ativo,
    grupos: u.grupo_ids
      ? u.grupo_ids.split(',').map((id, i) => ({
          id: Number(id),
          nome: String(u.grupo_nomes).split(' || ')[i]
        }))
      : []
  };
}

async function carregar(id) {
  const linhas = await db.query(
    `SELECT ${COLS} FROM tb_usuarios u
     LEFT JOIN tb_usuarios_grupos ug ON ug.usuario_id = u.id
     LEFT JOIN tb_grupos g ON g.id = ug.grupo_id
     WHERE u.id = ? GROUP BY u.id`,
    [id]
  );
  return linhas.length ? formatar(linhas[0]) : null;
}

async function substituirGrupos(usuarioId, grupos) {
  if (!grupos.length) return;
  const placeholders = grupos.map(() => '?').join(',');
  const validos = await db.query(`SELECT id FROM tb_grupos WHERE id IN (${placeholders})`, grupos);
  for (const g of validos) {
    await db.query('INSERT IGNORE INTO tb_usuarios_grupos (usuario_id, grupo_id) VALUES (?,?)', [usuarioId, g.id]);
  }
  const placeholdersIds = validos.map(() => '?').join(',');
  if (!validos.length) {
    await db.query('DELETE FROM tb_usuarios_grupos WHERE usuario_id = ?', [usuarioId]);
  } else {
    await db.query(
      `DELETE FROM tb_usuarios_grupos WHERE usuario_id = ? AND grupo_id NOT IN (${placeholdersIds})`,
      [usuarioId, ...validos.map(g => g.id)]
    );
  }
}

async function definirSituacao(req, usuario, situacao, motivo) {
  if (usuario.id === req.usuario.id) {
    return { erro: 'Você não pode alterar o acesso da sua própria conta.', status: 400 };
  }
  if (situacao === 'bloqueado' && usuario.acesso_total) {
    const substitutos = await db.query(
      'SELECT COUNT(*) total FROM tb_usuarios u WHERE u.situacao = "ativo" AND u.id <> ? AND EXISTS (' +
      'SELECT 1 FROM tb_usuarios_grupos ug JOIN tb_grupos_perfis gp ON gp.grupo_id = ug.grupo_id ' +
      'JOIN tb_perfis p ON p.id = gp.perfil_id WHERE ug.usuario_id = u.id AND p.acesso_total = 1)',
      [usuario.id]
    );
    if (!substitutos[0].total) {
      return {
        erro: 'Este é o único usuário com acesso total ativo. Promova outro usuário antes de bloqueá-lo.',
        status: 409
      };
    }
  }

  if (situacao === 'bloqueado') {
    await db.query(
      'UPDATE tb_usuarios SET situacao = "bloqueado", bloqueado_em = NOW(), bloqueado_motivo = ?, ' +
      'tentativas_falhas = 0, bloqueio_ate = NULL WHERE id = ?',
      [motivo ? String(motivo).slice(0, 255) : null, usuario.id]
    );
  } else {
    await db.query(
      'UPDATE tb_usuarios SET situacao = "ativo", bloqueado_em = NULL, bloqueado_motivo = NULL, ' +
      'tentativas_falhas = 0, bloqueio_ate = NULL WHERE id = ?',
      [usuario.id]
    );
  }

  const encerradas = await auth.encerrarSessoesDoUsuario(usuario.id);
  await auth.registrarLog(req, {
    usuarioId: usuario.id,
    usuarioNome: `${usuario.nome} (${usuario.usuario})`,
    evento: situacao === 'bloqueado' ? 'usuario.bloqueado' : 'usuario.liberado',
    descricao: `${motivo ? `Motivo: ${motivo}. ` : ''}${encerradas} sessão(ões) encerrada(s).`
  });
  await mailer.acessoAlterado({
    nome: usuario.nome,
    email: usuario.email,
    situacao,
    motivo,
    feitoPor: req.usuario.nome
  });
  return { encerradas };
}

/* ============================================================
   LISTAGEM / CONSULTA
   ============================================================ */
router.get('/', LISTAR, async (req, res, next) => {
  try {
    const filtros = ['1 = 1'];
    const params = [];
    if (req.query.q) {
      filtros.push('(u.nome LIKE ? OR u.usuario LIKE ? OR u.email LIKE ? OR u.telefone LIKE ?)');
      const like = `%${String(req.query.q).trim()}%`;
      params.push(like, like, like, like);
    }
    if (req.query.situacao === 'ativo' || req.query.situacao === 'bloqueado') {
      filtros.push('u.situacao = ?');
      params.push(req.query.situacao);
    }
    if (req.query.grupo_id) {
      filtros.push('EXISTS (SELECT 1 FROM tb_usuarios_grupos ug WHERE ug.usuario_id = u.id AND ug.grupo_id = ?)');
      params.push(Number(req.query.grupo_id));
    }

    const linhas = await db.query(
      `SELECT ${COLS} FROM tb_usuarios u
       LEFT JOIN tb_usuarios_grupos ug ON ug.usuario_id = u.id
       LEFT JOIN tb_grupos g ON g.id = ug.grupo_id
       WHERE ${filtros.join(' AND ')}
       GROUP BY u.id
       ORDER BY u.nome ASC`,
      params
    );
    res.json(linhas.map(formatar));
  } catch (e) { next(e); }
});

router.get('/:id', LISTAR, async (req, res, next) => {
  try {
    const usuario = await carregar(req.params.id);
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    res.json(usuario);
  } catch (e) { next(e); }
});

/* ============================================================
   CRIAÇÃO / EDIÇÃO
   ============================================================ */
router.post('/', EDITAR, async (req, res, next) => {
  try {
    const erro = validar(req.body, { novo: true });
    if (erro) return res.status(400).json({ erro });

    const b = req.body;
    const login = String(b.usuario).trim();
    const email = mailer.normalizarEmail(b.email);

    const dupLogin = await db.query('SELECT id FROM tb_usuarios WHERE usuario = ?', [login]);
    if (dupLogin.length) return res.status(409).json({ erro: 'Este nome de acesso já está em uso.' });
    const dupEmail = await db.query('SELECT id FROM tb_usuarios WHERE email = ?', [email]);
    if (dupEmail.length) return res.status(409).json({ erro: 'Este e-mail já está em uso por outro usuário.' });

    const senhaInicial = b.senha ? String(b.senha) : senha.senhaTemporaria();
    const hash = await senha.gerarHash(senhaInicial);
    const situacao = b.situacao === 'bloqueado' ? 'bloqueado' : 'ativo';

    const r = await db.query(
      'INSERT INTO tb_usuarios (nome, usuario, email, telefone, cargo, senha_hash, senha_alterada_em, ' +
      'deve_alterar_senha, situacao, bloqueado_motivo) VALUES (?,?,?,?,?,?,NOW(),1,?,?)',
      [
        String(b.nome).trim(), login, email,
        b.telefone ? String(b.telefone).trim() : null,
        b.cargo ? String(b.cargo).trim() : null,
        hash, situacao,
        situacao === 'bloqueado' ? (b.motivo_bloqueio || 'Bloqueado no cadastro.') : null
      ]
    );

    await substituirGrupos(r.insertId, idsDe(b.grupos));
    if (req.file) {
      const arquivo = foto.salvarFoto(r.insertId, req.file, null);
      await db.query('UPDATE tb_usuarios SET foto = ? WHERE id = ?', [arquivo, r.insertId]);
    }

    const novo = await carregar(r.insertId);
    await auth.registrarLog(req, {
      usuarioId: r.insertId,
      usuarioNome: `${novo.nome} (${novo.usuario})`,
      evento: 'usuario.criado',
      descricao: `Conta criada com situação ${situacao}.`
    });

    // confirma o endereço de e-mail cadastrado
    let emailEnviado = null;
    if (config.smtp.enabled) {
      const token = await auth.gerarTokenAcesso(req, r.insertId, 'verificacao_email');
      const envio = await mailer.verificacaoEmail({
        nome: novo.nome,
        email: novo.email,
        link: `${config.auth.appUrl}/api/auth/verificar-email?token=${encodeURIComponent(token)}`,
        minutos: config.auth.recuperacaoMinutos
      });
      emailEnviado = envio.enviado;
    }

    res.status(201).json({
      id: r.insertId,
      mensagem: 'Usuário cadastrado com sucesso.',
      senha_inicial: senhaInicial,
      senha_provisoria: !b.senha,
      confirmacao_email: emailEnviado
    });
  } catch (e) { next(e); }
});

router.put('/:id', EDITAR, foto.uploadFoto('foto'), async (req, res, next) => {
  try {
    const atual = await carregar(req.params.id);
    if (!atual) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    const erro = validar(req.body);
    if (erro) return res.status(400).json({ erro });

    const b = req.body;
    const email = b.email !== undefined ? mailer.normalizarEmail(b.email) : atual.email;
    const login = b.usuario !== undefined ? String(b.usuario).trim() : atual.usuario;
    const trocouEmail = email !== atual.email;

    if (b.usuario !== undefined && login !== atual.usuario) {
      const dup = await db.query('SELECT id FROM tb_usuarios WHERE usuario = ? AND id <> ?', [login, atual.id]);
      if (dup.length) return res.status(409).json({ erro: 'Este nome de acesso já está em uso.' });
    }
    if (trocouEmail) {
      const dup = await db.query('SELECT id FROM tb_usuarios WHERE email = ? AND id <> ?', [email, atual.id]);
      if (dup.length) return res.status(409).json({ erro: 'Este e-mail já está em uso por outro usuário.' });
    }

    let arquivo = atual.foto;
    if (req.file) arquivo = foto.salvarFoto(atual.id, req.file, atual.foto);

    const r = await db.query(
      'UPDATE tb_usuarios SET nome = ?, usuario = ?, email = ?, telefone = ?, cargo = ?, foto = ?, ' +
      'email_verificado = IF(?, 0, email_verificado) WHERE id = ?',
      [
        b.nome !== undefined ? String(b.nome).trim() : atual.nome,
        login,
        email,
        b.telefone !== undefined ? (b.telefone ? String(b.telefone).trim() : null) : atual.telefone,
        b.cargo !== undefined ? (b.cargo ? String(b.cargo).trim() : null) : atual.cargo,
        arquivo,
        trocouEmail ? 1 : 0,
        atual.id
      ]
    );
    if (!r.affectedRows) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    if (b.grupos !== undefined) await substituirGrupos(atual.id, idsDe(b.grupos));

    await auth.registrarLog(req, {
      usuarioId: atual.id,
      usuarioNome: `${atual.nome} (${atual.usuario})`,
      evento: 'usuario.editado',
      descricao: `Cadastro atualizado.${trocouEmail ? ' E-mail alterado: aguardando confirmação.' : ''}`
    });

    res.json({
      mensagem: 'Usuário atualizado com sucesso.',
      email_verificado: !trocouEmail,
      foto_url: foto.urlFoto(arquivo)
    });
  } catch (e) { next(e); }
});

router.put('/:id/grupos', EDITAR, async (req, res, next) => {
  try {
    const atual = await carregar(req.params.id);
    if (!atual) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    await substituirGrupos(atual.id, idsDe(req.body.grupos));
    await auth.registrarLog(req, {
      usuarioId: atual.id,
      usuarioNome: `${atual.nome} (${atual.usuario})`,
      evento: 'usuario.grupos_alterados',
      descricao: 'Grupos de acesso redefinidos.'
    });
    res.json({ mensagem: 'Grupos atualizados com sucesso.' });
  } catch (e) { next(e); }
});

/* ============================================================
   FOTO
   ============================================================ */
router.post('/:id/foto', EDITAR, foto.uploadFoto('foto'), async (req, res, next) => {
  try {
    const atual = await carregar(req.params.id);
    if (!atual) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    if (!req.file) return res.status(400).json({ erro: 'Envie um arquivo de imagem.' });

    const arquivo = foto.salvarFoto(atual.id, req.file, atual.foto);
    await db.query('UPDATE tb_usuarios SET foto = ? WHERE id = ?', [arquivo, atual.id]);
    await auth.registrarLog(req, {
      usuarioId: atual.id,
      usuarioNome: `${atual.nome} (${atual.usuario})`,
      evento: 'usuario.foto_atualizada',
      descricao: 'Foto de perfil atualizada.'
    });
    res.json({ mensagem: 'Foto atualizada com sucesso.', foto_url: foto.urlFoto(arquivo) });
  } catch (e) { next(e); }
});

router.delete('/:id/foto', EDITAR, async (req, res, next) => {
  try {
    const atual = await carregar(req.params.id);
    if (!atual) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    foto.apagarFoto(atual.foto);
    await db.query('UPDATE tb_usuarios SET foto = NULL WHERE id = ?', [atual.id]);
    res.json({ mensagem: 'Foto removida com sucesso.' });
  } catch (e) { next(e); }
});

/* ============================================================
   CONFIRMAÇÃO DE E-MAIL
   ============================================================ */
router.post('/:id/reenviar-verificacao', EDITAR, async (req, res, next) => {
  try {
    const usuario = await carregar(req.params.id);
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    if (usuario.email_verificado) {
      return res.status(400).json({ erro: 'O e-mail deste usuário já está confirmado.' });
    }
    if (!config.smtp.enabled) {
      return res.status(503).json({ erro: 'O envio de e-mail está desativado (SMTP não configurado).' });
    }

    const token = await auth.gerarTokenAcesso(req, usuario.id, 'verificacao_email');
    const envio = await mailer.verificacaoEmail({
      nome: usuario.nome,
      email: usuario.email,
      link: `${config.auth.appUrl}/api/auth/verificar-email?token=${encodeURIComponent(token)}`,
      minutos: config.auth.recuperacaoMinutos
    });

    await auth.registrarLog(req, {
      usuarioId: usuario.id,
      usuarioNome: `${usuario.nome} (${usuario.usuario})`,
      evento: 'email.verificacao_enviada',
      descricao: `Confirmação reenviada para ${mailer.mascararEmail(usuario.email)} (${envio.transporte}).`,
      sucesso: envio.enviado
    });

    res.json({
      mensagem: envio.enviado
        ? `Confirmação enviada para ${mailer.mascararEmail(usuario.email)}.`
        : 'Não foi possível enviar o e-mail. Verifique a configuração de SMTP.',
      transporte: envio.transporte
    });
  } catch (e) { next(e); }
});

/* ============================================================
   BLOQUEIO / LIBERAÇÃO
   ============================================================ */
router.post('/:id/bloquear', EDITAR, async (req, res, next) => {
  try {
    const usuario = await carregar(req.params.id);
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    if (usuario.situacao === 'bloqueado') {
      return res.status(400).json({ erro: 'Este usuário já está bloqueado.' });
    }
    const r = await definirSituacao(req, usuario, 'bloqueado', req.body.motivo);
    if (r.erro) return res.status(r.status).json({ erro: r.erro });
    res.json({ mensagem: 'Acesso bloqueado com sucesso.', sessoes_encerradas: r.encerradas });
  } catch (e) { next(e); }
});

router.post('/:id/liberar', EDITAR, async (req, res, next) => {
  try {
    const usuario = await carregar(req.params.id);
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    if (usuario.situacao === 'ativo' && !usuario.bloqueio_ativo) {
      return res.status(400).json({ erro: 'Este usuário já está com o acesso liberado.' });
    }
    const r = await definirSituacao(req, usuario, 'ativo', null);
    if (r.erro) return res.status(r.status).json({ erro: r.erro });
    res.json({ mensagem: 'Acesso liberado com sucesso.', sessoes_encerradas: r.encerradas });
  } catch (e) { next(e); }
});

/* ============================================================
   RESET DE SENHA
   ============================================================ */
router.post('/:id/redefinir-senha', EDITAR, async (req, res, next) => {
  try {
    const usuario = await carregar(req.params.id);
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    const modo = req.body.modo === 'temporaria' ? 'temporaria' : 'email';

    if (modo === 'email') {
      if (!usuario.email_verificado) {
        return res.status(409).json({
          erro: 'O e-mail deste usuário ainda não foi confirmado. Envie a confirmação antes de redefinir a senha.'
        });
      }
      const token = await auth.gerarTokenAcesso(req, usuario.id, 'recuperacao');
      const link = `${config.auth.appUrl}/recuperar-senha.html?token=${encodeURIComponent(token)}`;
      const envio = await mailer.recuperacaoSenha({
        nome: usuario.nome,
        email: usuario.email,
        link,
        minutos: config.auth.recuperacaoMinutos
      });
      await auth.registrarLog(req, {
        usuarioId: usuario.id,
        usuarioNome: `${usuario.nome} (${usuario.usuario})`,
        evento: 'senha.reset_solicitado',
        descricao: `Link de redefinição enviado por e-mail (${envio.transporte}).`,
        sucesso: envio.enviado
      });
      return res.json({
        mensagem: envio.enviado
          ? 'Link de redefinição enviado para o e-mail do usuário.'
          : 'Não foi possível enviar o e-mail. Verifique a configuração de SMTP.',
        transporte: envio.transporte,
        // sem SMTP o link é devolvido ao administrador para entrega manual
        link: !config.smtp.enabled ? link : undefined
      });
    }

    const novaSenha = req.body.senha ? String(req.body.senha) : senha.senhaTemporaria();
    const erro = senha.validarPolitica(novaSenha);
    if (erro) return res.status(400).json({ erro });

    await db.query(
      'UPDATE tb_usuarios SET senha_hash = ?, senha_alterada_em = NOW(), deve_alterar_senha = 1, ' +
      'tentativas_falhas = 0, bloqueio_ate = NULL WHERE id = ?',
      [await senha.gerarHash(novaSenha), usuario.id]
    );
    const encerradas = await auth.encerrarSessoesDoUsuario(usuario.id);

    await auth.registrarLog(req, {
      usuarioId: usuario.id,
      usuarioNome: `${usuario.nome} (${usuario.usuario})`,
      evento: 'senha.resetada',
      descricao: `Senha redefinida pelo administrador. ${encerradas} sessão(ões) encerrada(s).`
    });
    await mailer.senhaAlterada({
      nome: usuario.nome,
      email: usuario.email,
      origem: 'pelo administrador do sistema'
    });

    res.json({
      mensagem: 'Senha redefinida com sucesso. Informe a senha ao usuário: ele será obrigado a alterá-la no próximo acesso.',
      senha_inicial: novaSenha,
      sessoes_encerradas: encerradas
    });
  } catch (e) { next(e); }
});

/* ============================================================
   EXCLUSÃO
   ============================================================ */
router.delete('/:id', EDITAR, async (req, res, next) => {
  try {
    const usuario = await carregar(req.params.id);
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    if (usuario.id === req.usuario.id) {
      return res.status(400).json({ erro: 'Você não pode excluir a sua própria conta.' });
    }
    if (usuario.acesso_total) {
      const outros = await db.query(
        'SELECT COUNT(*) total FROM tb_usuarios u WHERE u.id <> ? AND u.situacao = "ativo" AND EXISTS (' +
        'SELECT 1 FROM tb_usuarios_grupos ug JOIN tb_grupos_perfis gp ON gp.grupo_id = ug.grupo_id ' +
        'JOIN tb_perfis p ON p.id = gp.perfil_id WHERE ug.usuario_id = u.id AND p.acesso_total = 1)',
        [usuario.id]
      );
      if (!outros[0].total) {
        return res.status(409).json({
          erro: 'Este é o único usuário com acesso total ativo. Promova outro usuário antes de excluí-lo.'
        });
      }
    }

    await db.query('DELETE FROM tb_usuarios WHERE id = ?', [usuario.id]);
    foto.apagarFoto(usuario.foto);
    await auth.registrarLog(req, {
      usuarioId: usuario.id,
      usuarioNome: `${usuario.nome} (${usuario.usuario})`,
      evento: 'usuario.excluido',
      descricao: 'Conta excluída.'
    });
    res.json({ mensagem: 'Usuário excluído com sucesso.' });
  } catch (e) { next(e); }
});

module.exports = router;
