/* Cria os usuários iniciais com bcrypt (12 rounds).
   node scripts/seed.js                       -> usa senhas geradas e imprime uma vez
   node scripts/seed.js raissa MinhaSenha123  -> define manualmente
*/
'use strict';
require('../src/ambiente');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const senhaForte = () => crypto.randomBytes(9).toString('base64url');

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'farias'
  });

  const [, , userArg, senhaArg] = process.argv;
  const contas = userArg
    ? [{ username: userArg, senha: senhaArg || senhaForte(), nome: userArg, papel: 'admin' }]
    : [
        { username: 'raissa', senha: senhaArg || senhaForte(), nome: 'Raíssa Farias', papel: 'admin' },
        { username: 'balcao', senha: senhaForte(), nome: 'Balcão', papel: 'atendente' }
      ];

  console.log('\nGUARDE ESTAS SENHAS — elas não são exibidas de novo:\n');
  for (const c of contas) {
    const hash = await bcrypt.hash(c.senha, 12);
    await db.query(
      `INSERT INTO usuarios (username, senha_hash, nome, papel)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE senha_hash = VALUES(senha_hash), nome = VALUES(nome),
                               papel = VALUES(papel), token_version = token_version + 1`,
      [c.username, hash, c.nome, c.papel]);
    console.log(`  ${c.username.padEnd(10)} ${c.senha.padEnd(16)} (${c.papel})`);
  }
  console.log('\nTrocar a senha de alguém derruba as sessões abertas dessa conta.\n');
  await db.end();
})().catch(e => { console.error(e.message); process.exit(1); });
