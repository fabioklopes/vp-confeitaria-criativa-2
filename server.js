const express = require('express');
const path = require('path');
const cors = require('cors');
const config = require('./config');
const wa = require('./lib/whatsapp');
const auth = require('./lib/auth');
const garantirSchema = require('./lib/garantir-schema');

const app = express();

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
  },
  credentials: true
}));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/uploads', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(express.json());

// resolve a sessão enviada no cookie em todas as requisições
app.use(auth.carregarSessao);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(config.uploadDir));

// autenticação (login, logout, recuperação de senha, perfil próprio)
app.use('/api/auth', require('./routes/auth'));

// administração de acessos
app.use('/api/usuarios', require('./routes/usuarios'));
app.use('/api/grupos', require('./routes/grupos'));
app.use('/api/perfis', require('./routes/perfis'));
app.use('/api/auditoria', require('./routes/auditoria'));

// módulos do ERP
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

async function iniciar() {
  try {
    await garantirSchema.iniciar();
  } catch (e) {
    console.error('[auth] falha ao preparar o banco de dados:', e.code || e.message);
    process.exit(1);
  }

  app.listen(config.app.port, config.app.host, () => {
    console.log(`[${config.app.nomeSistema}] no ar em http://${config.app.host}:${config.app.port}`);
    wa.init();
    if (config.whatsapp.enabled) {
      console.log('[whatsapp] inicializando sessão (LocalAuth)...');
    }
  });
}

iniciar();
