/* Carrega o catálogo de óleo (extraído dos PDFs dos fabricantes) no banco.
   node scripts/carregar-catalogo.js [arquivo.json] */
'use strict';
require('../src/ambiente');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const arq = process.argv[2] || path.join(__dirname, '..', 'dados', 'catalogo_oleo.json');
  const cat = JSON.parse(fs.readFileSync(arq, 'utf8'));
  console.log(`lendo ${cat.length} entradas de ${path.basename(arq)}`);

  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'farias'
  });

  const [r0] = await db.query('DELETE FROM catalogo_oleo');
  if (r0.affectedRows) console.log(`  limpou ${r0.affectedRows} entradas antigas`);

  const linhas = cat
    .filter(c => c.modelo && Array.isArray(c.oleo) && c.oleo.length)
    .map(c => [
      c.fonte || 'desconhecida',
      c.marca || null,
      String(c.modelo).toUpperCase().slice(0, 80),
      (c.motor || '').slice(0, 80) || null,
      c.cil || null,
      /^\d{4}$/.test(String(c.ano_ini)) ? +c.ano_ini : null,
      /^\d{4}$/.test(String(c.ano_fim)) ? +c.ano_fim : null,
      (() => {                                  // "4,25" · "5.25" · lixo -> null
        const n = parseFloat(String(c.litros ?? '').replace(',', '.'));
        return Number.isFinite(n) && n > 0 && n < 100 ? Math.round(n * 100) / 100 : null;
      })(),
      c.oleo.join(',').slice(0, 80)
    ]);

  for (let i = 0; i < linhas.length; i += 500) {
    await db.query(
      `INSERT INTO catalogo_oleo
       (fonte, marca, modelo, motor, cilindrada, ano_ini, ano_fim, litros, viscosidades)
       VALUES ?`, [linhas.slice(i, i + 500)]);
  }

  const [[r]] = await db.query(
    `SELECT COUNT(*) total,
            SUM(ano_ini IS NOT NULL) com_ano,
            SUM(cilindrada IS NOT NULL) com_motor,
            COUNT(DISTINCT modelo) modelos
     FROM catalogo_oleo`);
  console.log(`\nno banco: ${r.total} entradas · ${r.modelos} modelos`);
  console.log(`  ${r.com_ano} com faixa de ano · ${r.com_motor} com cilindrada`);

  const [amostra] = await db.query(
    `SELECT modelo, cilindrada, ano_ini, ano_fim, viscosidades
     FROM catalogo_oleo WHERE cilindrada IS NOT NULL AND ano_ini IS NOT NULL LIMIT 5`);
  console.log('\namostra:');
  for (const a of amostra)
    console.log(`  ${a.modelo.padEnd(18)} ${String(a.cilindrada).padEnd(5)} ` +
                `${a.ano_ini}-${a.ano_fim}  ${a.viscosidades}`);
  await db.end();
})().catch(e => { console.error(e.message); process.exit(1); });
