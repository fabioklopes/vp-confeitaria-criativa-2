const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const sequelize = require('../config/database');

const User = sequelize.define('tb_usuarios', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  nomeCompleto: { type: DataTypes.STRING(150), allowNull: false },
  usuario: { type: DataTypes.STRING(80), allowNull: false, unique: true },
  senha: { type: DataTypes.STRING(255), allowNull: false },
}, {
  tableName: 'tb_usuarios',
});

const Cliente = sequelize.define('tb_clientes', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  nomeCompleto: { type: DataTypes.STRING(150), allowNull: false },
  endereco: { type: DataTypes.STRING(200), allowNull: false },
  bairro: { type: DataTypes.STRING(120), allowNull: false },
  cep: { type: DataTypes.STRING(20), allowNull: false },
  celular: { type: DataTypes.STRING(30), allowNull: false },
}, {
  tableName: 'tb_clientes',
});

const Insumo = sequelize.define('tb_insumos', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  produto: { type: DataTypes.STRING(150), allowNull: false },
  unidadeMedida: { type: DataTypes.ENUM('Litro', 'Quilo', 'Unidade'), allowNull: false },
  quantidadeCompra: { type: DataTypes.DECIMAL(10, 3), allowNull: false, defaultValue: 0 },
  valor: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
}, {
  tableName: 'tb_insumos',
});

const Precificacao = sequelize.define('tb_precificacao', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  insumoId: { type: DataTypes.INTEGER, allowNull: false },
  quantidadeUtilizada: { type: DataTypes.DECIMAL(10, 3), allowNull: false, defaultValue: 0 },
  custo: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
}, {
  tableName: 'tb_precificacao',
});

const ReceitaPronta = sequelize.define('tb_receitas_prontas', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  insumoId: { type: DataTypes.INTEGER, allowNull: false },
  quantidadeUtilizada: { type: DataTypes.DECIMAL(10, 3), allowNull: false, defaultValue: 0 },
  custo: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
}, {
  tableName: 'tb_receitas_prontas',
});

const Campanha = sequelize.define('tb_campanhas', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  nome: { type: DataTypes.STRING(150), allowNull: false },
  descricao: { type: DataTypes.TEXT, allowNull: true },
  desconto: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  ativa: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, {
  tableName: 'tb_campanhas',
});

const Financeiro = sequelize.define('tb_financeiro', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  tipo: { type: DataTypes.ENUM('entrada', 'saida'), allowNull: false },
  descricao: { type: DataTypes.STRING(200), allowNull: false },
  categoria: { type: DataTypes.STRING(80), allowNull: false },
  valor: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  dataLancamento: { type: DataTypes.DATEONLY, allowNull: false, defaultValue: DataTypes.NOW },
  status: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'confirmado' },
}, {
  tableName: 'tb_financeiro',
});

Insumo.hasMany(Precificacao, { foreignKey: 'insumoId', as: 'precificacoes' });
Precificacao.belongsTo(Insumo, { foreignKey: 'insumoId', as: 'insumo' });

Insumo.hasMany(ReceitaPronta, { foreignKey: 'insumoId', as: 'receitasProntas' });
ReceitaPronta.belongsTo(Insumo, { foreignKey: 'insumoId', as: 'insumo' });

async function recalcularCustosRelacionados(insumoId, valorUnitario) {
  const precos = await Precificacao.findAll({ where: { insumoId } });
  for (const item of precos) {
    const custo = calcularCusto(item.quantidadeUtilizada, valorUnitario);
    await item.update({ custo });
  }

  const receitas = await ReceitaPronta.findAll({ where: { insumoId } });
  for (const item of receitas) {
    const custo = calcularCusto(item.quantidadeUtilizada, valorUnitario);
    await item.update({ custo });
  }
}

function calcularCusto(quantidadeUtilizada, valorUnitario) {
  const qtd = Number(quantidadeUtilizada || 0);
  const valor = Number(valorUnitario || 0);
  return Number((qtd * valor).toFixed(2));
}

async function atualizarCustoRelacionado(model, instance) {
  if (!instance || !instance.insumoId) return instance;

  const insumo = await Insumo.findByPk(instance.insumoId);
  if (!insumo) return instance;

  const custo = calcularCusto(instance.quantidadeUtilizada, insumo.valor);
  instance.custo = custo;
  return instance;
}

User.beforeCreate(async (user) => {
  if (user.senha) {
    user.senha = await bcrypt.hash(user.senha, 10);
  }
});

User.beforeUpdate(async (user) => {
  if (user.changed('senha')) {
    user.senha = await bcrypt.hash(user.senha, 10);
  }
});

Precificacao.beforeValidate(async (instance) => {
  if (instance.insumoId && instance.quantidadeUtilizada) {
    const insumo = await Insumo.findByPk(instance.insumoId);
    if (insumo) {
      instance.custo = calcularCusto(instance.quantidadeUtilizada, insumo.valor);
    }
  }
});

ReceitaPronta.beforeValidate(async (instance) => {
  if (instance.insumoId && instance.quantidadeUtilizada) {
    const insumo = await Insumo.findByPk(instance.insumoId);
    if (insumo) {
      instance.custo = calcularCusto(instance.quantidadeUtilizada, insumo.valor);
    }
  }
});

Insumo.afterUpdate(async (insumo) => {
  if (insumo.changed('valor')) {
    await recalcularCustosRelacionados(insumo.id, insumo.valor);
  }
});

module.exports = {
  sequelize,
  User,
  Cliente,
  Insumo,
  Precificacao,
  ReceitaPronta,
  Campanha,
  Financeiro,
  calcularCusto,
  atualizarCustoRelacionado,
};
