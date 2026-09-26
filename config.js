const path = require('path');
const dotenv = require('dotenv');

const result = dotenv.config({ path: path.resolve(__dirname, '.env'), quiet: true });
if (result.error && result.error.code !== 'ENOENT') {
  throw new Error('Não foi possível carregar o arquivo de configuração .env.');
}

function env(name, fallback) {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? fallback : raw;
}

function required(name) {
  const raw = env(name);
  if (raw === undefined || raw.trim() === '') {
    throw new Error(`Variável obrigatória ausente: ${name}`);
  }
  return raw;
}

function integer(name, fallback, min, max) {
  const raw = env(name, fallback);
  if (raw === undefined || !/^-?\d+$/.test(String(raw).trim())) {
    throw new Error(`Variável inválida: ${name}`);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || (min !== undefined && value < min) || (max !== undefined && value > max)) {
    throw new Error(`Variável fora do intervalo permitido: ${name}`);
  }
  return value;
}

function boolean(name, fallback) {
  const raw = env(name, String(fallback)).toLowerCase();
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new Error(`Variável inválida: ${name}`);
}

function list(name) {
  return env(name, '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

const whatsappEnabled = boolean('WHATSAPP_ENABLED', false);
const chromePath = env('WHATSAPP_CHROME');
if (whatsappEnabled && !chromePath) {
  throw new Error('Variável obrigatória ausente: WHATSAPP_CHROME');
}

const delayMinMs = integer('WA_DELAY_MIN', 7000, 0);
const delayMaxMs = integer('WA_DELAY_MAX', 15000, 0);
const pauseMinMs = integer('WA_PAUSE_MIN', 60000, 0);
const pauseMaxMs = integer('WA_PAUSE_MAX', 120000, 0);
if (delayMaxMs < delayMinMs) {
  throw new Error('WA_DELAY_MAX deve ser maior ou igual a WA_DELAY_MIN.');
}
if (pauseMaxMs < pauseMinMs) {
  throw new Error('WA_PAUSE_MAX deve ser maior ou igual a WA_PAUSE_MIN.');
}

const nodeEnv = env('NODE_ENV', 'development').toLowerCase();
if (!['development', 'test', 'staging', 'production'].includes(nodeEnv)) {
  throw new Error('Variável inválida: NODE_ENV');
}

const isProduction = nodeEnv === 'production';

const host = env('HOST', '127.0.0.1');
const port = integer('PORT', 3000, 1, 65535);

/* ---- Autenticação (tb_usuarios) ---- */
const authEnabled = boolean('AUTH_ENABLED', true);
if (isProduction && !authEnabled) {
  throw new Error('AUTH_ENABLED não pode ser desativado em produção.');
}

const argon2Parallelism = integer('ARGON2_PARALLELISM', 1, 1, 16);
const argon2MemoryCost = integer('ARGON2_MEMORY_COST_KB', 19456, 8, 1048576);
const argon2TimeCost = integer('ARGON2_TIME_COST', 2, 1, 32);

const appUrl = env('APP_URL', `http://${host}:${port}`).replace(/\/+$/, '');

const uploadDir = path.resolve(__dirname, env('UPLOAD_DIR', 'upload'));

/* ---- E-mail (recuperação de senha e verificação de endereço) ---- */
const smtpHost = env('SMTP_HOST');
const smtpUser = env('SMTP_USER');
const smtpSenha = (env('SMTP_PASSWORD') || '').replace(/\s+/g, '');
const smtpHabilitado = boolean('SMTP_ENABLED', Boolean(smtpHost && smtpUser && smtpSenha));
if (smtpHabilitado && !(smtpHost && smtpUser && smtpSenha)) {
  throw new Error('SMTP_HOST, SMTP_USER e SMTP_PASSWORD são obrigatórios quando SMTP_ENABLED estiver ativo.');
}

const config = {
  db: {
    host: required('DB_HOST'),
    port: integer('DB_PORT', 3306, 1, 65535),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    database: required('DB_NAME'),
    connectionLimit: integer('DB_CONNECTION_LIMIT', 10, 1)
  },
  app: {
    host,
    port,
    nodeEnv,
    isProduction,
    nomeSistema: env('NOME_SISTEMA', 'Confeitaria ERP'),
    corsOrigins: list('CORS_ORIGINS')
  },
  auth: {
    enabled: authEnabled,
    appUrl,
    cookieNome: env('AUTH_COOKIE', 'erp_sid'),
    sessaoHoras: integer('SESSAO_HORAS', 8, 1, 720),
    inatividadeMinutos: integer('SESSAO_MINUTOS_INATIVIDADE', 30, 1, 10080),
    argon2: {
      memoryCost: argon2MemoryCost,
      timeCost: argon2TimeCost,
      parallelism: argon2Parallelism
    },
    senhaMinCaracteres: integer('SENHA_MIN_CARACTERES', 8, 6, 64),
    maxTentativas: integer('LOGIN_MAX_TENTATIVAS', 5, 1, 100),
    bloqueioMinutos: integer('LOGIN_BLOQUEIO_MINUTOS', 15, 1, 10080),
    recuperacaoMinutos: integer('RECUPERACAO_MINUTOS', 30, 5, 10080),
    fotoMaxBytes: integer('FOTO_MAX_BYTES', 2097152, 1024, 10485760),
    administrador: {
      usuario: env('ADMIN_USUARIO', 'administrador'),
      senha: env('ADMIN_SENHA', 'admin@1234'),
      nome: env('ADMIN_NOME', 'Administrador'),
      email: env('ADMIN_EMAIL', ''),
      forcarTrocaSenha: boolean('FORCAR_TROCA_SENHA_ADMIN', isProduction)
    }
  },
  smtp: {
    enabled: smtpHabilitado,
    host: smtpHost,
    port: integer('SMTP_PORT', 587, 1, 65535),
    secure: boolean('SMTP_SECURE', false),
    user: smtpUser,
    password: smtpSenha,
    from: env('SMTP_FROM', smtpUser || 'nao-responda@localhost')
  },
  uploadDir,
  fotoDir: path.join(uploadDir, 'usuarios'),
  whatsapp: {
    enabled: whatsappEnabled,
    chromePath,
    dataPath: path.resolve(__dirname, env('WHATSAPP_DATA_DIR', '.wwebjs_auth')),
    chromeArgs: [
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ],
    delayMinMs,
    delayMaxMs,
    batchSize: integer('WA_BATCH', 10, 1),
    pauseMinMs,
    pauseMaxMs,
    diarioMax: integer('WA_DIARIO_MAX', 300, 0)
  }
};

module.exports = config;
