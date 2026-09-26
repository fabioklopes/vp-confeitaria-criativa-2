/* ============================================================
   E-mail - envio de mensagens do módulo de autenticação
   Usa SMTP quando configurado; caso contrário imprime a mensagem
   no console do servidor (útil em desenvolvimento).
   ============================================================ */
'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');

let transporte = null;

function obterTransporte() {
  if (transporte) return transporte;
  if (!config.smtp.enabled) {
    transporte = { modo: 'console' };
    return transporte;
  }
  transporte = {
    modo: 'smtp',
    smtp: nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.password },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000
    })
  };
  return transporte;
}

function destino(destinatario) {
  const [nome, email] = Array.isArray(destinatario)
    ? destinatario
    : [null, destinatario];
  return email;
}

/* ------------------------------------------------------------
   Validação de endereço de e-mail
   ------------------------------------------------------------ */
const REGEX_EMAIL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

function emailValido(email) {
  if (typeof email !== 'string') return false;
  const v = email.trim();
  if (v.length < 5 || v.length > 190) return false;
  if (/\s/.test(v)) return false;
  return REGEX_EMAIL.test(v);
}

function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function mascararEmail(email) {
  const v = normalizarEmail(email);
  const [user, domain] = v.split('@');
  if (!domain) return v;
  const visivel = user.slice(0, Math.min(2, user.length));
  return `${visivel}${'*'.repeat(Math.max(3, user.length - visivel.length))}@${domain}`;
}

/* ------------------------------------------------------------
   Template HTML
   ------------------------------------------------------------ */
function layout(titulo, corpo) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f4f5f7;font-family:Segoe UI,system-ui,Arial,sans-serif;color:#2c3e50;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e6e8ec;">
    <tr>
      <td style="background:#8e44ad;padding:20px 28px;color:#ffffff;">
        <span style="font-size:20px;font-weight:700;">${config.app.nomeSistema}</span>
      </td>
    </tr>
    <tr><td style="padding:28px;">
        <h1 style="margin:0 0 16px;font-size:19px;line-height:1.3;">${titulo}</h1>
        ${corpo}
      </td></tr>
    <tr>
      <td style="padding:16px 28px;background:#fafbfc;border-top:1px solid #eef0f3;color:#7d8792;font-size:12px;line-height:1.5;">
        Mensagem automática gerada pelo ${config.app.nomeSistema}.<br>
        Se você não solicitou esta ação, ignore esta mensagem.
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function botao(rotulo, link) {
  return `<p style="margin:24px 0;">
      <a href="${link}" style="display:inline-block;background:#8e44ad;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600;">${rotulo}</a>
    </p>
    <p style="margin:0;font-size:12px;color:#7d8792;word-break:break-all;">
      Não funciona o botão? Copie e cole o endereço abaixo no navegador:<br>
      <span style="color:#2c3e50;">${link}</span>
    </p>`;
}

/* ------------------------------------------------------------
   Envio
   Retorna { enviado, transporte }.
   Nunca lança: falhas de e-mail não derrubam a requisição.
   ------------------------------------------------------------ */
async function enviar({ para, assunto, texto, html }) {
  const email = destino(para);
  const t = obterTransporte();

  if (t.modo === 'console') {
    console.log('\n' + '='.repeat(64));
    console.log(`[e-mail: console] ${assunto}`);
    console.log(`para: ${email}`);
    console.log('-'.repeat(64));
    console.log(texto);
    console.log('='.repeat(64) + '\n');
    return { enviado: true, transporte: 'console' };
  }

  try {
    await t.smtp.sendMail({
      from: config.smtp.from,
      to: email,
      subject: assunto,
      text: texto,
      html
    });
    return { enviado: true, transporte: 'smtp' };
  } catch (e) {
    console.error('[e-mail] falha no envio:', e.code || e.message);
    return { enviado: false, transporte: 'smtp', erro: e.message };
  }
}

/* ------------------------------------------------------------
   Mensagens do módulo de autenticação
   ------------------------------------------------------------ */
async function recuperacaoSenha({ nome, email, link, minutos }) {
  return enviar({
    para: email,
    assunto: `Recuperação de senha - ${config.app.nomeSistema}`,
    texto: [
      `Olá, ${nome}!`,
      '',
      'Recebemos um pedido para redefinir a senha da sua conta.',
      `Abra o endereço abaixo para cadastrar uma nova senha (válido por ${minutos} minutos):`,
      '',
      link,
      '',
      'Se você não solicitou a alteração, entre em contato com o administrador do sistema.',
      'Sua senha atual continua válida enquanto o pedido não for concluído.'
    ].join('\n'),
    html: layout('Recuperação de senha', `
      <p style="margin:0 0 12px;line-height:1.6;">Olá, <strong>${nome}</strong>!</p>
      <p style="margin:0 0 12px;line-height:1.6;">Recebemos um pedido para redefinir a senha da sua conta.
      O link abaixo é válido por <strong>${minutos} minutos</strong> e só pode ser usado uma vez.</p>
      ${botao('Cadastrar nova senha', link)}
      <p style="margin:20px 0 0;line-height:1.6;">Se você não solicitou a alteração, ignore esta mensagem:
      sua senha atual continua válida.</p>`)
  });
}

async function verificacaoEmail({ nome, email, link, minutos }) {
  return enviar({
    para: email,
    assunto: `Confirme seu e-mail - ${config.app.nomeSistema}`,
    texto: [
      `Olá, ${nome}!`,
      '',
      'Confirme este endereço de e-mail para permitir a recuperação de senha e o recebimento de avisos do sistema.',
      `Abra o endereço abaixo para confirmar (válido por ${minutos} minutos):`,
      '',
      link,
      '',
      'Se você não criou esta conta, entre em contato com o administrador do sistema.'
    ].join('\n'),
    html: layout('Confirme seu e-mail', `
      <p style="margin:0 0 12px;line-height:1.6;">Olá, <strong>${nome}</strong>!</p>
      <p style="margin:0 0 12px;line-height:1.6;">Confirme este endereço para permitir a recuperação de senha
      e o recebimento de avisos do sistema. O link é válido por <strong>${minutos} minutos</strong>.</p>
      ${botao('Confirmar e-mail', link)}`)
  });
}

async function senhaAlterada({ nome, email, origem }) {
  return enviar({
    para: email,
    assunto: `Senha alterada - ${config.app.nomeSistema}`,
    texto: [
      `Olá, ${nome}!`,
      '',
      `A senha da sua conta foi alterada (${origem}).`,
      'Se não foi você, avise o administrador do sistema imediatamente.'
    ].join('\n'),
    html: layout('Senha alterada', `
      <p style="margin:0 0 12px;line-height:1.6;">Olá, <strong>${nome}</strong>!</p>
      <p style="margin:0;line-height:1.6;">A senha da sua conta foi alterada <strong>(${origem})</strong>
      e as sessões abertas em outros dispositivos foram encerradas.</p>
      <p style="margin:16px 0 0;line-height:1.6;">Se não foi você, avise o administrador do sistema imediatamente.</p>`)
  });
}

async function acessoAlterado({ nome, email, situacao, motivo, feitoPor }) {
  const titulo = situacao === 'bloqueado' ? 'Acesso bloqueado' : 'Acesso liberado';
  return enviar({
    para: email,
    assunto: `${titulo} - ${config.app.nomeSistema}`,
    texto: [
      `Olá, ${nome}!`,
      '',
      situacao === 'bloqueado'
        ? `O seu acesso ao sistema foi bloqueado por ${feitoPor}.`
        : `O seu acesso ao sistema foi liberado por ${feitoPor}.`,
      motivo ? `Motivo: ${motivo}` : '',
      '',
      'Em caso de dúvida, fale com o administrador do sistema.'
    ].filter(Boolean).join('\n'),
    html: layout(titulo, `
      <p style="margin:0 0 12px;line-height:1.6;">Olá, <strong>${nome}</strong>!</p>
      <p style="margin:0 0 12px;line-height:1.6;">${situacao === 'bloqueado'
        ? 'O seu acesso ao sistema foi <strong>bloqueado</strong>.'
        : 'O seu acesso ao sistema foi <strong>liberado</strong>.Você já consegue entrar normalmente.'}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:13px;color:#7d8792;margin:16px 0;">
        <tr><td style="padding:2px 12px 2px 0;">Responsável:</td><td>${feitoPor}</td></tr>
        ${motivo ? `<tr><td style="padding:2px 12px 2px 0;">Motivo:</td><td>${motivo}</td></tr>` : ''}
      </table>
      <p style="margin:0;line-height:1.6;">Em caso de dúvida, fale com o administrador do sistema.</p>`)
  });
}

module.exports = {
  enviar,
  recuperacaoSenha,
  verificacaoEmail,
  senhaAlterada,
  acessoAlterado,
  emailValido,
  normalizarEmail,
  mascararEmail
};
