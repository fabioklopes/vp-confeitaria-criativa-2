const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const {
  sequelize,
  User,
  Cliente,
  Insumo,
  Precificacao,
  ReceitaPronta,
  Campanha,
  Financeiro,
  calcularCusto,
} = require('./models');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'confeitaria-criativa-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 1000,
  },
}));
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Não autenticado. Faça login.' });
  }
  return next();
}

const pickFields = (source, fields) => {
  const result = {};
  fields.forEach((field) => {
    if (source && Object.prototype.hasOwnProperty.call(source, field)) {
      result[field] = source[field];
    }
  });
  return result;
};

function registerCrudRoutes(baseRoute, model, fields, options = {}) {
  const { beforeCreate, beforeUpdate, include = [], order = [['id', 'DESC']] } = options;

  app.get(`/api/${baseRoute}`, async (_req, res) => {
    try {
      const items = await model.findAll({ include, order });
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: 'Erro ao listar registros.', error: error.message });
    }
  });

  app.get(`/api/${baseRoute}/:id`, async (req, res) => {
    try {
      const item = await model.findByPk(req.params.id, { include });
      if (!item) {
        return res.status(404).json({ message: 'Registro não encontrado.' });
      }
      res.json(item);
    } catch (error) {
      res.status(500).json({ message: 'Erro ao buscar registro.', error: error.message });
    }
  });

  app.post(`/api/${baseRoute}`, async (req, res) => {
    try {
      const payload = pickFields(req.body, fields);
      if (beforeCreate) beforeCreate(payload, req.body);
      const item = await model.create(payload);
      res.status(201).json(item);
    } catch (error) {
      res.status(400).json({ message: 'Erro ao criar registro.', error: error.message });
    }
  });

  app.put(`/api/${baseRoute}/:id`, async (req, res) => {
    try {
      const item = await model.findByPk(req.params.id);
      if (!item) {
        return res.status(404).json({ message: 'Registro não encontrado.' });
      }

      const payload = pickFields(req.body, fields);
      if (beforeUpdate) beforeUpdate(payload, req.body);
      await item.update(payload);
      res.json(item);
    } catch (error) {
      res.status(400).json({ message: 'Erro ao atualizar registro.', error: error.message });
    }
  });

  app.delete(`/api/${baseRoute}/:id`, async (req, res) => {
    try {
      const item = await model.findByPk(req.params.id);
      if (!item) {
        return res.status(404).json({ message: 'Registro não encontrado.' });
      }
      await item.destroy();
      res.json({ message: 'Registro removido com sucesso.' });
    } catch (error) {
      res.status(500).json({ message: 'Erro ao remover registro.', error: error.message });
    }
  });
}

app.get('/login', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/dashboard', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Não autenticado. Faça login.' });
  }
  try {
    const [usuarios, clientes, insumos, precificacao, receitas, campanhas, financeiro] = await Promise.all([
      User.count(),
      Cliente.count(),
      Insumo.count(),
      Precificacao.sum('custo'),
      ReceitaPronta.sum('custo'),
      Campanha.count(),
      Financeiro.sum('valor'),
    ]);

    const totalCusto = Number(precificacao || 0) + Number(receitas || 0);
    const totalFinanceiro = Number(financeiro || 0);
    const margem = totalFinanceiro - totalCusto;

    res.json({
      cards: [
        { label: 'Usuários', value: usuarios, icon: 'fa-users', color: 'primary' },
        { label: 'Clientes', value: clientes, icon: 'fa-user-tie', color: 'success' },
        { label: 'Insumos', value: insumos, icon: 'fa-box', color: 'warning' },
        { label: 'Custo Total', value: totalCusto, icon: 'fa-sack-dollar', color: 'danger' },
        { label: 'Campanhas', value: campanhas, icon: 'fa-bullhorn', color: 'info' },
        { label: 'Financeiro', value: totalFinanceiro, icon: 'fa-wallet', color: 'secondary' },
      ],
      resumo: {
        custoTotal: totalCusto,
        financeiroTotal: totalFinanceiro,
        margem: margem,
        usuarioAtivo: req.session.user ? req.session.user.usuario : null,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao gerar painel.', error: error.message });
  }
});

app.get('/api/session', (req, res) => {
  if (!req.session.user) {
    return res.json({ loggedIn: false, user: null });
  }

  res.json({ loggedIn: true, user: req.session.user });
});

app.post('/api/login', async (req, res) => {
  const { usuario, senha } = req.body || {};

  if (!usuario || !senha) {
    return res.status(400).json({ message: 'Usuário e senha são obrigatórios.' });
  }

  try {
    const user = await User.findOne({ where: { usuario } });
    if (!user) {
      return res.status(401).json({ message: 'Credenciais inválidas.' });
    }

    const valid = await bcrypt.compare(senha, user.senha);
    if (!valid) {
      return res.status(401).json({ message: 'Credenciais inválidas.' });
    }

    const sessionUser = {
      id: user.id,
      nomeCompleto: user.nomeCompleto,
      usuario: user.usuario,
    };

    req.session.user = sessionUser;
    res.json({
      ok: true,
      user: sessionUser,
    });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao autenticar usuário.', error: error.message });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true, message: 'Sessão encerrada com sucesso.' });
  });
});

app.use('/api', requireAuth);

registerCrudRoutes('usuarios', User, ['nomeCompleto', 'usuario', 'senha']);
registerCrudRoutes('clientes', Cliente, ['nomeCompleto', 'endereco', 'bairro', 'cep', 'celular']);
registerCrudRoutes('insumos', Insumo, ['produto', 'unidadeMedida', 'quantidadeCompra', 'valor']);
registerCrudRoutes('campanhas', Campanha, ['nome', 'descricao', 'desconto', 'ativa']);
registerCrudRoutes('financeiro', Financeiro, ['tipo', 'descricao', 'categoria', 'valor', 'dataLancamento', 'status']);

app.get('/api/precificacoes', async (_req, res) => {
  try {
    const registros = await Precificacao.findAll({
      include: [{ model: Insumo, as: 'insumo', attributes: ['id', 'produto', 'unidadeMedida', 'valor'] }],
      order: [['id', 'DESC']],
    });
    res.json(registros);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao listar precificação.', error: error.message });
  }
});

app.post('/api/precificacoes', async (req, res) => {
  try {
    const { insumoId, quantidadeUtilizada } = req.body || {};
    const insumo = await Insumo.findByPk(insumoId);
    if (!insumo) {
      return res.status(404).json({ message: 'Insumo não encontrado.' });
    }

    const custo = calcularCusto(quantidadeUtilizada, insumo.valor);
    const item = await Precificacao.create({ insumoId, quantidadeUtilizada, custo });
    res.status(201).json(item);
  } catch (error) {
    res.status(400).json({ message: 'Erro ao registrar precificação.', error: error.message });
  }
});

app.put('/api/precificacoes/:id', async (req, res) => {
  try {
    const item = await Precificacao.findByPk(req.params.id);
    if (!item) {
      return res.status(404).json({ message: 'Precificação não encontrada.' });
    }

    const { insumoId, quantidadeUtilizada } = req.body || {};
    const insumo = await Insumo.findByPk(insumoId || item.insumoId);
    const custo = calcularCusto(quantidadeUtilizada ?? item.quantidadeUtilizada, insumo ? insumo.valor : 0);

    await item.update({ insumoId: insumoId || item.insumoId, quantidadeUtilizada: quantidadeUtilizada ?? item.quantidadeUtilizada, custo });
    res.json(item);
  } catch (error) {
    res.status(400).json({ message: 'Erro ao atualizar precificação.', error: error.message });
  }
});

app.delete('/api/precificacoes/:id', async (req, res) => {
  try {
    const item = await Precificacao.findByPk(req.params.id);
    if (!item) {
      return res.status(404).json({ message: 'Precificação não encontrada.' });
    }
    await item.destroy();
    res.json({ message: 'Precificação removida com sucesso.' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao remover precificação.', error: error.message });
  }
});

app.get('/api/receitas-prontas', async (_req, res) => {
  try {
    const registros = await ReceitaPronta.findAll({
      include: [{ model: Insumo, as: 'insumo', attributes: ['id', 'produto', 'unidadeMedida', 'valor'] }],
      order: [['id', 'DESC']],
    });
    res.json(registros);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao listar receitas prontas.', error: error.message });
  }
});

app.post('/api/receitas-prontas', async (req, res) => {
  try {
    const { insumoId, quantidadeUtilizada } = req.body || {};
    const insumo = await Insumo.findByPk(insumoId);
    if (!insumo) {
      return res.status(404).json({ message: 'Insumo não encontrado.' });
    }

    const custo = calcularCusto(quantidadeUtilizada, insumo.valor);
    const item = await ReceitaPronta.create({ insumoId, quantidadeUtilizada, custo });
    res.status(201).json(item);
  } catch (error) {
    res.status(400).json({ message: 'Erro ao cadastrar receita pronta.', error: error.message });
  }
});

app.put('/api/receitas-prontas/:id', async (req, res) => {
  try {
    const item = await ReceitaPronta.findByPk(req.params.id);
    if (!item) {
      return res.status(404).json({ message: 'Receita pronta não encontrada.' });
    }

    const { insumoId, quantidadeUtilizada } = req.body || {};
    const insumo = await Insumo.findByPk(insumoId || item.insumoId);
    const custo = calcularCusto(quantidadeUtilizada ?? item.quantidadeUtilizada, insumo ? insumo.valor : 0);

    await item.update({ insumoId: insumoId || item.insumoId, quantidadeUtilizada: quantidadeUtilizada ?? item.quantidadeUtilizada, custo });
    res.json(item);
  } catch (error) {
    res.status(400).json({ message: 'Erro ao atualizar receita pronta.', error: error.message });
  }
});

app.delete('/api/receitas-prontas/:id', async (req, res) => {
  try {
    const item = await ReceitaPronta.findByPk(req.params.id);
    if (!item) {
      return res.status(404).json({ message: 'Receita pronta não encontrada.' });
    }
    await item.destroy();
    res.json({ message: 'Receita pronta removida com sucesso.' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao remover receita pronta.', error: error.message });
  }
});

module.exports = app;
