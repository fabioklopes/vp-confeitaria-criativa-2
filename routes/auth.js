const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const auth = require('../lib/auth');
const senha = require('../lib/senha');
const mailer = require('../lib/mailer');
const foto = require('../lib/foto');

const router = express.Router();

const CREDENCIAIS_INVALIDAS = 'Usuário ou senha inválidos.';
const EMAIL_INVALIDO = 'Informe um e-mail válido.';

/* ---- hash descartável: iguala o tempo de resposta quando o
       login não existe, evitando revelar quais usuários existem ---- */
let hashFalso = null;
function hashInexistente() {
  if (!hashFalso) hashFalso = senha.gerarHash(crypto.randomBytes(16).toString('hex'));
  return hashFalso;
}

/* ---- normalizadores ---- */
function telefoneValido(telefone) {
  if (!telefone) return true;
  return /^\+?[0-9\s()-]{8,30}$/.test(String(telefone).trim());
}

function validar(body) {
  if (!body.usuario || !String(body.usuario).trim()) return 'Informe o usuário.';
  if (!body.senha) return 'Informe a senha.';
  return null;
}

function validarPerfil(body) {
  if (!body.nome || !String(body.nome).trim()) return 'Informe o nome.';
  if (String(body.nome).length > 150) return 'O nome deve ter no máximo 150 caracteres.';
  if (body.email && !mailer.emailValido(body.email)) return EMAIL_INVALIDO;
  if (!telefoneValido(body.telefone)) return 'Informe um telefone de contato válido.';
  if (body.cargo && String(body.cargo).length > 120) return 'O cargo deve ter no máximo 120 caracteres.';
  return null;
}

/* ============================================================
   LOGIN / LOGOUT
   ============================================================ */
router.post('/login', async (req, res, next) => {
  try {
    const erro = validar(req.body);
    if (erro) return res.status(400).json({ erro });

    const identificador = String(req.body.usuario).trim();
    const senhaDigitada = String(req.body.senha);

    const linhas = await db.query(
      'SELECT *, (bloqueio_ate IS NOT NULL AND bloqueio_ate > NOW()) AS bloqueio_ativo, ' +
      'TIMESTAMPDIFF(MINUTE, NOW(), bloqueio_ate) AS bloqueio_restante ' +
      'FROM tb_usuarios WHERE usuario = ? OR email = ? LIMIT 1',
      [identificador, mailer.normalizarEmail(identificador)]
    );

    if (!linhas.length) {
      await senha.conferir(await hashInexistente(), senhaDigitada);
      await auth.registrarLog(req, {
        usuarioId: null,
        usuarioNome: identificador,
        evento: 'login.falha',
        descricao: 'Login inexistente.',
        sucesso: false
      });
      return res.status(401).json({ erro: CREDENCIAIS_INVALIDAS });
    }

    const u = linhas[0];

    // bloqueio temporário por tentativas excedidas
    // (o tempo restante é calculado pelo banco, immune a fuso divergente)
    if (u.bloqueio_ativo) {
      const minutos = Math.max(1, Number(u.bloqueio_restante) || config.auth.bloqueioMinutos);
      await auth.registrarLog(req, {
        usuarioId: u.id,
        evento: 'login.bloqueado_temporario',
        descricao: `Acesso temporariamente bloqueado por ${minutos} min.`,
        sucesso: false
      });
      return res.status(423).json({
        erro: `Muitas tentativas sem sucesso. Aguarde ${minutos} minuto(s) e tente novamente.`
      });
    }

    if (u.situacao !== 'ativo') {
      await auth.registrarLog(req, {
        usuarioId: u.id,
        evento: 'login.bloqueado',
        descricao: u.bloqueado_motivo || 'Conta bloqueada.',
        sucesso: false
      });
      return res.status(403).json({ erro: 'Seu acesso está bloqueado. Fale com o administrador do sistema.' });
    }

    const confere = await senha.conferir(u.senha_hash, senhaDigitada);

    if (!confere) {
      const tentativas = u.tentativas_falhas + 1;
      const esgotou = tentativas >= config.auth.maxTentativas;
      // o bloqueio temporário é calculado pelo banco (NOW()) para não depender
      // do fuso do processo Node na comparação com bloqueio_ate
      await db.query(
        'UPDATE tb_usuarios SET tentativas_falhas = ?, ' +
        'bloqueio_ate = IF(? = 1, DATE_ADD(NOW(), INTERVAL ? MINUTE), NULL) WHERE id = ?',
        [esgotou ? 0 : tentativas, esgotou ? 1 : 0, config.auth.bloqueioMinutos, u.id]
      );
      await auth.registrarLog(req, {
        usuarioId: u.id,
        evento: 'login.falha',
        descricao: esgotou
          ? `Bloqueio temporário de ${config.auth.bloqueioMinutos} min. após ${tentativas} tentativas.`
          : `Tentativa ${tentativas} de ${config.auth.maxTentativas}.`,
        sucesso: false
      });
      if (esgotou) {
        return res.status(423).json({
          erro: `Muitas tentativas sem sucesso. Aguarde ${config.auth.bloqueioMinutos} minuto(s) e tente novamente.`
        });
      }
      const restantes = config.auth.maxTentativas - tentativas;
      return res.status(401).json({
        erro: CREDENCIAIS_INVALIDAS,
        restantes: restantes > 0 ? restantes : 0
      });
    }

    // login válido: limpa bloqueios, registra acesso e abre a sessão
    await db.query(
      'UPDATE tb_usuarios SET tentativas_falhas = 0, bloqueio_ate = NULL, ultimo_acesso = NOW(), ultimo_ip = ? WHERE id = ?',
      [auth.ipRequisicao(req), u.id]
    );

    // rehash transparente quando os parâmetros do Argon2 evoluem
    if (await senha.precisaRehash(u.senha_hash)) {
      const novoHash = await senha.gerarHash(senhaDigitada);
      await db.query('UPDATE tb_usuarios SET senha_hash = ? WHERE id = ?', [novoHash, u.id]).catch(() => {});
    }

    await auth.criarSessao(req, res, u.id);
    await auth.registrarLog(req, { usuarioId: u.id, evento: 'login.sucesso', descricao: 'Acesso permitido.' });

    const acessos = await auth.resolverAcessos(u.id);
    res.json({
      mensagem: `Bem-vindo, ${u.nome}!`,
      usuario: auth.montarSessao(u, acessos)
    });
  } catch (e) { next(e); }
});

router.post('/sair', async (req, res, next) => {
  try {
    await auth.encerrarSessao(req, res);
    if (req.usuario) {
      await auth.registrarLog(req, { evento: 'logout', descricao: 'Sessão encerrada.' });
    }
    res.json({ mensagem: 'Sessão encerrada.' });
  } catch (e) { next(e); }
});

router.get('/me', auth.exigirLogin, async (req, res, next) => {
  try {
    res.json({ usuario: req.usuario });
  } catch (e) { next(e); }
});

/* ============================================================
   MINHA CONTA
   ============================================================ */
router.put('/meu-perfil', auth.exigirLogin, foto.uploadFoto('foto'), async (req, res, next) => {
  try {
    const erro = validarPerfil(req.body);
    if (erro) return res.status(400).json({ erro });

    const atual = await db.query('SELECT * FROM tb_usuarios WHERE id = ?', [req.usuario.id]);
    if (!atual.length) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    const email = mailer.normalizarEmail(req.body.email);
    const trocouEmail = email !== atual[0].email;

    if (trocouEmail) {
      const dup = await db.query('SELECT id FROM tb_usuarios WHERE email = ? AND id <> ?', [email, req.usuario.id]);
      if (dup.length) return res.status(409).json({ erro: 'Este e-mail já está em uso por outro usuário.' });
    }

    let arquivo = atual[0].foto;
    if (req.file) arquivo = foto.salvarFoto(req.usuario.id, req.file, atual[0].foto);

    const r = await db.query(
      'UPDATE tb_usuarios SET nome = ?, email = ?, telefone = ?, cargo = ?, foto = ?, ' +
      'email_verificado = IF(?, 0, email_verificado) WHERE id = ?',
      [
        String(req.body.nome).trim(),
        email,
        req.body.telefone ? String(req.body.telefone).trim() : null,
        req.body.cargo ? String(req.body.cargo).trim() : null,
        arquivo,
        trocouEmail ? 1 : 0,
        req.usuario.id
      ]
    );
    if (!r.affectedRows) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    let verificacao = null;
    if (trocouEmail) {
      verificacao = await enviarVerificacao(req, { id: req.usuario.id, nome: req.body.nome, email });
    }

    await auth.registrarLog(req, {
      evento: 'perfil.alterado',
      descricao: trocouEmail ? `Dados atualizados. Novo e-mail: ${email}` : 'Dados de contato atualizados.'
    });

    res.json({
      mensagem: 'Perfil atualizado com sucesso.',
      foto_url: foto.urlFoto(arquivo),
      email_verificado: !trocouEmail,
      verificacao
    });
  } catch (e) { next(e); }
});

router.post('/meu-perfil/foto', auth.exigirLogin, foto.uploadFoto('foto'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Envie um arquivo de imagem.' });
    const atual = await db.query('SELECT foto FROM tb_usuarios WHERE id = ?', [req.usuario.id]);
    if (!atual.length) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    const arquivo = foto.salvarFoto(req.usuario.id, req.file, atual[0].foto);
    await db.query('UPDATE tb_usuarios SET foto = ? WHERE id = ?', [arquivo, req.usuario.id]);
    await auth.registrarLog(req, { evento: 'perfil.foto_atualizada', descricao: 'Foto de perfil atualizada.' });
    res.json({ mensagem: 'Foto atualizada com sucesso.', foto_url: foto.urlFoto(arquivo) });
  } catch (e) { next(e); }
});

router.delete('/meu-perfil/foto', auth.exigirLogin, async (req, res, next) => {
  try {
    const atual = await db.query('SELECT foto FROM tb_usuarios WHERE id = ?', [req.usuario.id]);
    if (!atual.length) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    foto.apagarFoto(atual[0].foto);
    await db.query('UPDATE tb_usuarios SET foto = NULL WHERE id = ?', [req.usuario.id]);
    await auth.registrarLog(req, { evento: 'perfil.foto_removida', descricao: 'Foto de perfil removida.' });
    res.json({ mensagem: 'Foto removida com sucesso.' });
  } catch (e) { next(e); }
});

router.post('/alterar-senha', auth.exigirLogin, async (req, res, next) => {
  try {
    const { senhaAtual, novaSenha } = req.body;
    if (!senhaAtual) return res.status(400).json({ erro: 'Informe a senha atual.' });
    const erro = senha.validarPolitica(novaSenha);
    if (erro) return res.status(400).json({ erro });
    if (novaSenha === senhaAtual) return res.status(400).json({ erro: 'A nova senha deve ser diferente da atual.' });

    const atual = await db.query('SELECT senha_hash, nome, email FROM tb_usuarios WHERE id = ?', [req.usuario.id]);
    if (!atual.length) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    if (!await senha.conferir(atual[0].senha_hash, senhaAtual)) {
      await auth.registrarLog(req, {
        evento: 'senha.alteracao_negada',
        descricao: 'Senha atual informada incorretamente.',
        sucesso: false
      });
      return res.status(401).json({ erro: 'Senha atual incorreta.' });
    }

    const hash = await senha.gerarHash(novaSenha);
    await db.query(
      'UPDATE tb_usuarios SET senha_hash = ?, senha_alterada_em = NOW(), deve_alterar_senha = 0 WHERE id = ?',
      [hash, req.usuario.id]
    );

    const encerradas = await auth.encerrarSessoesDoUsuario(req.usuario.id, auth.lerCookie(req, config.auth.cookieNome));
    await auth.registrarLog(req, {
      evento: 'senha.alterada',
      descricao: `Senha alterada pelo próprio usuário. ${encerradas} sessão(ões) encerrada(s).`
    });
    await mailer.senhaAlterada({
      nome: atual[0].nome,
      email: atual[0].email,
      origem: 'pelo próprio usuário'
    });

    res.json({ mensagem: 'Senha alterada com sucesso.', sessoes_encerradas: encerradas });
  } catch (e) { next(e); }
});

/* ============================================================
   SESSÕES ATIVAS
   ============================================================ */
router.get('/sessoes', auth.exigirLogin, async (req, res, next) => {
  try {
    const atual = auth.lerCookie(req, config.auth.cookieNome);
    const hashAtual = atual ? auth.hashToken(atual) : null;
    const linhas = await db.query(
      'SELECT id, ip, user_agent, expira_em, ultimo_acesso, created_at, ' +
      '(token_hash = ?) AS atual ' +
      'FROM tb_sessoes WHERE usuario_id = ? AND revogada_em IS NULL AND expira_em > NOW() ' +
      'ORDER BY ultimo_acesso DESC',
      [hashAtual, req.usuario.id]
    );
    res.json({ sessoes: linhas });
  } catch (e) { next(e); }
});

router.delete('/sessoes/:id', auth.exigirLogin, async (req, res, next) => {
  try {
    const r = await db.query(
      'UPDATE tb_sessoes SET revogada_em = NOW() WHERE id = ? AND usuario_id = ? AND revogada_em IS NULL',
      [req.params.id, req.usuario.id]
    );
    if (!r.affectedRows) return res.status(404).json({ erro: 'Sessão não encontrada.' });
    await auth.registrarLog(req, { evento: 'sessao.revogada', descricao: `Sessão ${req.params.id} encerrada.` });
    res.json({ mensagem: 'Sessão encerrada.' });
  } catch (e) { next(e); }
});

/* ============================================================
   RECUPERAÇÃO DE SENHA (público)
   ============================================================ */
router.post('/recuperar-senha', async (req, res, next) => {
  try {
    const email = mailer.normalizarEmail(req.body.email);
    // A resposta é idêntica em todos os casos (e-mail inexistente, não confirmado,
    // conta bloqueada ou envio OK) para não permitir enumerar contas.
    // O campo "envio" só descreve a configuração do servidor, não o resultado por usuário.
    const respostaNeutra = {
      mensagem: 'Se o e-mail estiver cadastrado e válido, você receberá as instruções de redefinição em instantes.',
      envio: { transporte: config.smtp.enabled ? 'smtp' : 'console' }
    };
    if (!mailer.emailValido(email)) return res.status(200).json(respostaNeutra);

    const linhas = await db.query('SELECT id, nome, email, situacao, email_verificado FROM tb_usuarios WHERE email = ?', [email]);
    if (!linhas.length) {
      await auth.registrarLog(req, {
        usuarioNome: email,
        evento: 'senha.recuperacao_solicitada',
        descricao: 'E-mail não cadastrado.',
        sucesso: false
      });
      return res.status(200).json(respostaNeutra);
    }

    const u = linhas[0];

    // só envia para e-mail confirmado e conta ativa
    if (!u.email_verificado || u.situacao !== 'ativo') {
      await auth.registrarLog(req, {
        usuarioId: u.id,
        evento: 'senha.recuperacao_solicitada',
        descricao: !u.email_verificado ? 'E-mail ainda não confirmado.' : 'Conta bloqueada.',
        sucesso: false
      });
      return res.status(200).json(respostaNeutra);
    }

    const token = await auth.gerarTokenAcesso(req, u.id, 'recuperacao');
    const link = `${config.auth.appUrl}/recuperar-senha.html?token=${encodeURIComponent(token)}`;
    const envio = await mailer.recuperacaoSenha({
      nome: u.nome,
      email: u.email,
      link,
      minutos: config.auth.recuperacaoMinutos
    });

    await auth.registrarLog(req, {
      usuarioId: u.id,
      evento: 'senha.recuperacao_solicitada',
      descricao: `Link enviado por e-mail (${envio.transporte}).`
    });

    if (!envio.enviado) {
      console.error(`[auth] falha no envio do e-mail de recuperação: ${envio.erro || 'motivo desconhecido'}`);
    }

    res.json(respostaNeutra);
  } catch (e) { next(e); }
});

router.post('/validar-token', async (req, res, next) => {
  try {
    const dados = await auth.buscarToken(req.body.token, 'recuperacao');
    if (!dados) return res.status(400).json({ erro: 'Link inválido ou expirado. Solicite um novo link.' });
    res.json({
      valido: true,
      nome: dados.nome,
      email: mailer.mascararEmail(dados.email),
      usuario: dados.usuario
    });
  } catch (e) { next(e); }
});

router.post('/redefinir-senha', async (req, res, next) => {
  try {
    const { token } = req.body;
    const erro = senha.validarPolitica(req.body.novaSenha);
    if (erro) return res.status(400).json({ erro });

    const dados = await auth.buscarToken(token, 'recuperacao');
    if (!dados) return res.status(400).json({ erro: 'Link inválido ou expirado. Solicite um novo link.' });

    const hash = await senha.gerarHash(req.body.novaSenha);
    // o link prova a posse da caixa de e-mail: confirma o endereço
    const r = await db.query(
      'UPDATE tb_usuarios SET senha_hash = ?, senha_alterada_em = NOW(), deve_alterar_senha = 0, ' +
      'tentativas_falhas = 0, bloqueio_ate = NULL, email_verificado = 1 WHERE id = ?',
      [hash, dados.usuario_id]
    );
    if (!r.affectedRows) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    await auth.usarToken(dados.id);
    const encerradas = await auth.encerrarSessoesDoUsuario(dados.usuario_id);

    await auth.registrarLog(req, {
      usuarioId: dados.usuario_id,
      usuarioNome: `${dados.nome} (${dados.usuario})`,
      evento: 'senha.redefinida',
      descricao: `Senha redefinida por link de e-mail. ${encerradas} sessão(ões) encerrada(s).`
    });
    await mailer.senhaAlterada({ nome: dados.nome, email: dados.email, origem: 'por link de recuperação' });

    res.json({ mensagem: 'Senha redefinida com sucesso. Já é possível entrar no sistema.' });
  } catch (e) { next(e); }
});

/* ============================================================
   VERIFICAÇÃO DE E-MAIL
   ============================================================ */
async function enviarVerificacao(req, u) {
  const token = await auth.gerarTokenAcesso(req, u.id, 'verificacao_email');
  const link = `${config.auth.appUrl}/api/auth/verificar-email?token=${encodeURIComponent(token)}`;
  const envio = await mailer.verificacaoEmail({
    nome: u.nome,
    email: u.email,
    link,
    minutos: config.auth.recuperacaoMinutos
  });
  return {
    enviado: envio.enviado,
    transporte: envio.transporte,
    mensagem: envio.enviado
      ? 'Enviamos um link de confirmação para o novo e-mail.'
      : 'Não foi possível enviar o e-mail agora. Use o botão "Reenviar confirmação" em instantes.'
  };
}

router.post('/reenviar-verificacao', auth.exigirLogin, async (req, res, next) => {
  try {
    const atual = await db.query('SELECT id, nome, email, email_verificado FROM tb_usuarios WHERE id = ?', [req.usuario.id]);
    if (!atual.length) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    if (atual[0].email_verificado) {
      return res.status(400).json({ erro: 'Este e-mail já está confirmado.' });
    }
    const verificacao = await enviarVerificacao(req, atual[0]);
    await auth.registrarLog(req, {
      evento: 'email.verificacao_enviada',
      descricao: `Confirmação reenviada para ${mailer.mascararEmail(atual[0].email)} (${verificacao.transporte}).`
    });
    res.json({ mensagem: verificacao.mensagem, verificacao });
  } catch (e) { next(e); }
});

router.get('/verificar-email', async (req, res, next) => {
  try {
    const dados = await auth.buscarToken(req.query.token, 'verificacao_email');
    if (!dados) return res.redirect('/login.html?email=invalido');

    await db.query('UPDATE tb_usuarios SET email_verificado = 1 WHERE id = ?', [dados.usuario_id]);
    await auth.usarToken(dados.id);

    await auth.registrarLog(req, {
      usuarioId: dados.usuario_id,
      usuarioNome: `${dados.nome} (${dados.usuario})`,
      evento: 'email.verificado',
      descricao: 'E-mail confirmado por link.'
    });

    res.redirect('/login.html?email=confirmado');
  } catch (e) { next(e); }
});

router.get('/config', (req, res) => {
  res.json({
    nome_sistema: config.app.nomeSistema,
    smtp_habilitado: config.smtp.enabled,
    min_caracteres: config.auth.senhaMinCaracteres
  });
});

module.exports = router;
