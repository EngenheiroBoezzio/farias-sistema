/* Pool de conexões. Uma só instância para todo o processo. */
'use strict';
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: +(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'farias',
  waitForConnections: true,
  connectionLimit: +(process.env.DB_POOL || 10),
  queueLimit: 0,
  // o driver nunca monta SQL por concatenação; tudo vai por placeholder
  namedPlaceholders: false,
  dateStrings: ['DATE'],          // DATE vem como 'AAAA-MM-DD', sem fuso no meio
  timezone: 'Z',
  charset: 'utf8mb4_unicode_ci'
});

/** Consulta com prazo: banco travado não segura a requisição para sempre. */
async function q(sql, params = [], timeoutMs = 4000) {
  const conn = await pool.getConnection();
  try {
    const [linhas] = await conn.query({ sql, timeout: timeoutMs }, params);
    return linhas;
  } finally {
    conn.release();
  }
}

const um = async (sql, params, t) => (await q(sql, params, t))[0] || null;

module.exports = { pool, q, um };
