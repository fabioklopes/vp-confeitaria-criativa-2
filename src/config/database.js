const path = require('path');
const { Sequelize } = require('sequelize');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const configuredDialect = (process.env.DB_DIALECT || 'mysql').toLowerCase();
const config = {
  dialect: configuredDialect,
  logging: false,
  define: {
    timestamps: true,
    underscored: true,
    freezeTableName: true,
  },
};

if (configuredDialect === 'sqlite') {
  config.storage = path.resolve(__dirname, '../../db_confeitaria_v2.sqlite');
} else {
  config.host = process.env.DB_HOST || '127.0.0.1';
  config.port = Number(process.env.DB_PORT || 3306);
  config.database = process.env.DB_NAME || 'db_confeitaria_v2';
  config.username = process.env.DB_USER || 'root';
  config.password = process.env.DB_PASSWORD || '';
}

const sequelize = new Sequelize(
  config.database || 'db_confeitaria_v2',
  config.username || 'root',
  config.password || '',
  config,
);

module.exports = sequelize;
