/* ============================================================
   Garantia do schema de autenticação
   Aplica a migration 20260926_auth_tb_usuarios.sql de forma
   idempotente e cria o usuário administrador inicial.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config');
const auth = require('./auth');
const senha = require('./senha');
const mailer = require('./mailer');

const MIGRATION = '20260926_auth_tb_usuarios.sql';

function lerMigration() {
  const arquivo = path.join(__dirname, '..', 'migrations', MIGRATION);
  const bruto = fs.readFileSync(arquivo, 'utf8');
  return bruto
    .split('\n')
    .map(linha => linha.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map(parte => parte.trim())
    .filter(Boolean);
}

async function aplicarSchema() {
  for (const comando of lerMigration()) {
    await db.query(comando);
  }
  console.log('[auth] schema de autenticação verificado.');
}

/* ------------------------------------------------------------
   Usuário administrador inicial
   ------------------------------------------------------------ */
async function garantirAdministrador() {
  const cfg = config.auth.administrador;
  const email = mailer.normalizarEmail(cfg.email) || `${cfg.usuario}@confeitaria.local`;

  const existentes = await db.query('SELECT id, situacao FROM tb_usuarios WHERE usuario = ?', [cfg.usuario]);

  if (existentes.length) {
    const admin = existentes[0];
    await db.query('INSERT IGNORE INTO tb_usuarios_grupos (usuario_id, grupo_id) SELECT ?, id FROM tb_grupos WHERE nome = ?',
      [admin.id, 'Administradores']);
    return { criado: false, id: admin.id };
  }

  const hash = await senha.gerarHash(cfg.senha);
  const r = await db.query(
    'INSERT INTO tb_usuarios (nome, usuario, email, cargo, senha_hash, senha_alterada_em, deve_alterar_senha) ' +
    'VALUES (?,?,?,?,?,NOW(),?)',
    [cfg.nome, cfg.usuario, email, 'Administrador do sistema', hash, cfg.forcarTrocaSenha ? 1 : 0]
  );

  await db.query(
    'INSERT IGNORE INTO tb_usuarios_grupos (usuario_id, grupo_id) SELECT ?, id FROM tb_grupos WHERE nome = ?',
    [r.insertId, 'Administradores']
  );

  console.log('[auth] usuário administrador criado.');
  console.log(`[auth]   login: ${cfg.usuario}`);
  if (cfg.forcarTrocaSenha) {
    console.log('[auth]   a troca da senha será exigida no primeiro acesso.');
  }
  if (!cfg.email) {
    console.log('[auth]   ATENÇÃO: defina ADMIN_EMAIL no .env ou atualize o e-mail em "Meu Perfil",');
    console.log('[auth]   caso contrário a recuperação de senha não poderá ser usada.');
  }

  return { criado: true, id: r.insertId };
}

async function iniciar() {
  await aplicarSchema();
  const admin = await garantirAdministrador();
  await auth.limparSessoesExpiradas();
  return admin;
}

module.exports = { iniciar, aplicarSchema, garantirAdministrador };
