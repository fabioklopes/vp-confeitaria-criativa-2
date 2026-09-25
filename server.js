const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');
const config = require('./config');
const wa = require('./lib/whatsapp');

const app = express();

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function unauthorized(res) {
  res.set('WWW-Authenticate', 'Basic realm="Confeitaria ERP", charset="UTF-8"');
  return res.status(401).json({ erro: 'Autenticação necessária.' });
}

function authenticate(req, res, next) {
  if (!config.app.auth.enabled) return next();

  const origin = req.get('origin');
  if (origin && !config.app.corsOrigins.includes(origin)) {
    return res.status(403).json({ erro: 'Origem não permitida.' });
  }

  const header = req.get('authorization') || '';
  if (!header.startsWith('Basic ')) return unauthorized(res);

  let decoded;
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch (error) {
    return unauthorized(res);
  }
  const separator = decoded.indexOf(':');
  if (separator < 0) return unauthorized(res);

  const user = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  if (!safeEqual(user, config.app.auth.user) || !safeEqual(password, config.app.auth.password)) {
    return unauthorized(res);
  }
  return next();
}

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.use(cors({
  origin(origin, callback) {
    if (!origin || config.app.corsOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  }
}));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/uploads', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(authenticate);
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(config.uploadDir));

app.use('/api/clientes', require('./routes/clientes'));
app.use('/api/campanhas', require('./routes/capanhas'));
app.use('/api/medidas', require('./routes/medidas'));
app.use('/api/insumos', require('./routes/insumos'));
app.use('/api/receitas', require('./routes/receitas'));
app.use('/api/precificacao', require('./routes/precificacao'));
app.use('/api/caixa', require('./routes/caixa'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/relatorios', require('./routes/relatorios'));
app.use('/api/whatsapp', require('./routes/whatsapp'));

app.use((req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada.' });
});

app.use((err, req, res, next) => {
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600
    ? err.status
    : 500;
  if (status >= 500) {
    console.error('[erro]', err.code || err.name || 'erro');
    return res.status(status).json({ erro: 'Erro interno do servidor.' });
  }
  return res.status(status).json({ erro: err.message || 'Erro interno do servidor.' });
});

app.listen(config.app.port, config.app.host, () => {
  console.log(`[${config.app.nomeSistema}] no ar em http://${config.app.host}:${config.app.port}`);
  wa.init();
  if (config.whatsapp.enabled) {
    console.log('[whatsapp] inicializando sessão (LocalAuth)...');
  }
});
