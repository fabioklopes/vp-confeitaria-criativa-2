const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool(config.db);

pool.on('error', (err) => {
  console.error('[db] erro no pool:', err.code || err.name || 'erro');
});

async function query(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

module.exports = { pool, query };