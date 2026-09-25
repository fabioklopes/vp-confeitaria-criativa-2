const express = require('express');
const path = require('path');
const cors = require('cors');
const config = require('./config');
const wa = require('./lib/whatsapp');

const app = express();

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'upload')));

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
  const status = err.status || 500;
  console.error('[erro]', err);
  res.status(status).json({ erro: err.message || 'Erro interno do servidor.' });
});

app.listen(config.app.port, () => {
  console.log(`[${config.app.nomeSistema}] no ar em http://localhost:${config.app.port}`);
  wa.init();
  console.log('[whatsapp] inicializando sessão (LocalAuth)...');
});
