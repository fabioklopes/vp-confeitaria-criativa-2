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
const authEnabled = boolean('AUTH_ENABLED', true);
const authUser = env('AUTH_USER');
const authPassword = env('AUTH_PASSWORD');
if (authEnabled && (!authUser || !authPassword)) {
  throw new Error('AUTH_USER e AUTH_PASSWORD são obrigatórios quando AUTH_ENABLED estiver ativo.');
}
if (nodeEnv === 'production' && !authEnabled) {
  throw new Error('AUTH_ENABLED não pode ser desativado em produção.');
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
    host: env('HOST', '127.0.0.1'),
    port: integer('PORT', 3000, 1, 65535),
    nodeEnv,
    nomeSistema: env('NOME_SISTEMA', 'Confeitaria ERP'),
    corsOrigins: list('CORS_ORIGINS'),
    auth: {
      enabled: authEnabled,
      user: authUser,
      password: authPassword
    }
  },
  uploadDir: path.resolve(__dirname, env('UPLOAD_DIR', 'upload')),
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
