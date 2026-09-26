/* ============================================================
   Cria ou promove um usuário administrador

   Uso:
     npm run criar-admin
     npm run criar-admin -- --usuario.root --senha "NovaSenha@1" --email root@empresa.com
     npm run criar-admin -- --usuario novo.admin --promover
   ============================================================ */
'use strict';

const db = require('../db');
const config = require('../config');
const senhaLib = require('../lib/senha');
const mailer = require('../lib/mailer');
const garantirSchema = require('../lib/garantir-schema');

function args(argv) {
  const lidos = {};
  for (let i = 0; i < argv.length; i++) {
    const atual = argv[i];
    if (!atual.startsWith('--')) continue;
    const chave = atual.slice(2);
    const proximo = argv[i + 1];
    if (proximo && !proximo.startsWith('--')) {
      lidos[chave] = proximo;
      i++;
    } else {
      lidos[chave] = true;
    }
  }
  return lidos;
}

const opcoes = args(process.argv.slice(2));
const ajuda = opcoes.ajuda || opcoes.help;

function uso() {
  console.log(`
Cria ou promove um usuário administrador do ERP.

  --usuario <login>     nome de acesso (padrão: ADMIN_USUARIO do .env)
  --senha <senha>       senha inicial (padrão: senha temporária automática)
  --email <e-mail>      e-mail do administrador
  --nome "Nome Completo"
  --cargo <cargo>
  --promover            mantém a conta existente e a liga ao grupo Administradores
  --forcar-troca        exige troca da senha no primeiro acesso
  --listar              lista os administradores existentes
  --ajuda               mostra esta ajuda
`);
}

async function listar() {
  const linhas = await db.query(
    'SELECT u.id, u.nome, u.usuario, u.email, u.situacao, u.ultimo_acesso, ' +
    'EXISTS(SELECT 1 FROM tb_usuarios_grupos ug WHERE ug.usuario_id = u.id AND ug.grupo_id = ' +
    '  (SELECT id FROM tb_grupos WHERE nome = "Administradores")) no_grupo ' +
    'FROM tb_usuarios u ' +
    'WHERE EXISTS(SELECT 1 FROM tb_usuarios_grupos ug JOIN tb_grupos g ON g.id = ug.grupo_id ' +
    '  WHERE ug.usuario_id = u.id AND g.nome = "Administradores") ' +
    'ORDER BY u.nome'
  );
  if (!linhas.length) {
    console.log('Nenhum usuário no grupo Administradores.');
    return;
  }
  console.table(linhas);
}

async function executar() {
  await garantirSchema.aplicarSchema();

  if (opcoes.listar) {
    await listar();
    return;
  }

  const usuario = String(opcoes.usuario || config.auth.administrador.usuario).trim();
  if (!/^[A-Za-z0-9._-]{3,60}$/.test(usuario)) {
    throw new Error('Nome de acesso inválido: use de 3 a 60 caracteres (letras, números, ponto, hífen ou sublinhado).');
  }

  const email = mailer.normalizarEmail(opcoes.email || config.auth.administrador.email);
  if (opcoes.email && !email) {
    throw new Error('E-mail inválido.');
  }
  if (!email) {
    console.log('! Nenhum e-mail informado: a recuperação de senha não funcionará para esta conta.');
  }

  const existentes = await db.query(
    'SELECT id, nome, email, situacao FROM tb_usuarios WHERE usuario = ?', [usuario]
  );

  if (existentes.length && !opcoes.promover) {
    throw new Error(
      `O usuário "${usuario}" já existe (id ${existentes[0].id}). Use --promover para promovê-lo a administrador.`
    );
  }

  let id;
  let senhaInicial = null;
  let provisoria = false;

  if (existentes.length) {
    id = existentes[0].id;
    const erros = [];
    if (opcoes.email) {
      const dup = await db.query('SELECT id FROM tb_usuarios WHERE email = ? AND id <> ?', [email, id]);
      if (dup.length) erros.push('Este e-mail já pertence a outro usuário.');
    }
    if (erros.length) throw new Error(erros.join(' '));

    if (opcoes.senha) {
      const erro = senhaLib.validarPolitica(String(opcoes.senha));
      if (erro) throw new Error(erro);
      senhaInicial = String(opcoes.senha);
    } else if (opcoes['forcar-troca'] || opcoes['redefinir-senha']) {
      senhaInicial = senhaLib.senhaTemporaria();
      provisoria = true;
    }

    const campos = [];
    const valores = [];
    if (opcoes.nome) { campos.push('nome = ?'); valores.push(String(opcoes.nome).trim()); }
    if (opcoes.email) { campos.push('email = ?', 'email_verificado = 0'); valores.push(email); }
    if (opcoes.cargo) { campos.push('cargo = ?'); valores.push(String(opcoes.cargo).trim()); }
    if (senhaInicial) {
      campos.push('senha_hash = ?', 'senha_alterada_em = NOW()', 'tentativas_falhas = 0',
        'bloqueio_ate = NULL', 'deve_alterar_senha = 1');
      valores.push(await senhaLib.gerarHash(senhaInicial));
    }
    if (campos.length) {
      valores.push(id);
      await db.query(`UPDATE tb_usuarios SET ${campos.join(', ')} WHERE id = ?`, valores);
    }
  } else {
    if (opcoes.email) {
      const dup = await db.query('SELECT id FROM tb_usuarios WHERE email = ?', [email]);
      if (dup.length) throw new Error('Este e-mail já pertence a outro usuário.');
    }

    const senhaInformada = opcoes.senha ? String(opcoes.senha) : senhaLib.senhaTemporaria();
    const erro = senhaLib.validarPolitica(senhaInformada);
    if (erro) throw new Error(erro);
    senhaInicial = senhaInformada;
    provisoria = !opcoes.senha;

    const r = await db.query(
      'INSERT INTO tb_usuarios (nome, usuario, email, cargo, senha_hash, senha_alterada_em, ' +
      'deve_alterar_senha, situacao) VALUES (?,?,?,?,?,NOW(),?,?)',
      [
        String(opcoes.nome || 'Administrador').trim(),
        usuario,
        email || `${usuario}@confeitaria.local`,
        String(opcoes.cargo || 'Administrador do sistema').trim(),
        await senhaLib.gerarHash(senhaInicial),
        opcoes['forcar-troca'] ? 1 : 0,
        'ativo'
      ]
    );
    id = r.insertId;
  }

  // garante o vínculo com o grupo Administradores
  await db.query(
    'INSERT IGNORE INTO tb_usuarios_grupos (usuario_id, grupo_id) ' +
    'SELECT ?, id FROM tb_grupos WHERE nome = ?',
    [id, 'Administradores']
  );
  // e com o perfil Acesso Total, caso o grupo não o tenha
  await db.query(
    'INSERT IGNORE INTO tb_grupos_perfis (grupo_id, perfil_id) ' +
    'SELECT g.id, p.id FROM tb_grupos g JOIN tb_perfis p ON p.acesso_total = 1 WHERE g.nome = ?',
    ['Administradores']
  );

  await db.query(
    'INSERT INTO tb_log_acesso (usuario_id, usuario_nome, evento, descricao, ip, sucesso) ' +
    'VALUES (?,?,?,?,?,1)',
    [id, `sistema (${usuario})`, 'usuario.criado',
      `Administrador ${existentes.length ? 'promovido' : 'criado'} pelo script criar-administrador.`,
      'localhost']
  );

  const [conta] = await db.query(
    'SELECT id, nome, usuario, email, cargo, situacao, deve_alterar_senha FROM tb_usuarios WHERE id = ?',
    [id]
  );

  console.log(`\n${existentes.length ? 'Administrador promovido' : 'Administrador criado'} com sucesso:\n`);
  console.table([conta]);

  if (senhaInicial) {
    console.log(`Senha inicial: ${senhaInicial}${provisoria ? ' (temporária)' : ''}`);
    if (provisoria || opcoes['forcar-troca']) {
      console.log('O usuário será obrigado a trocá-la no primeiro acesso.');
    }
  } else {
    console.log('A senha não foi alterada.');
  }
  if (!conta.email_verificado && conta.email) {
    console.log('Confirme o e-mail no primeiro acesso para habilitar a recuperação de senha.');
  }
}

(async () => {
  if (ajuda) {
    uso();
    process.exit(0);
  }
  try {
    await executar();
    process.exit(0);
  } catch (e) {
    console.error(`\nErro: ${e.message}`);
    process.exit(1);
  } finally {
    await db.pool.end().catch(() => {});
  }
})();
