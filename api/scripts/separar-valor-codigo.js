/* Separa preço de código de peça nas ordens de serviço, e aproveita os
   códigos para preencher a ficha do veículo.

   Roda quantas vezes quiser: só grava o que ainda está vazio.
   node scripts/separar-valor-codigo.js [--aplicar]

   Sem --aplicar, só mostra o que faria. */
'use strict';
require('../src/ambiente');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APLICAR = process.argv.includes('--aplicar');

/* prefixos Wega, os mesmos validados no catálogo */
const COD = /\b(WO|WOE|WEO|JFO|WUNI|TFW|FAP|JFA|WR|WAP|FCI|JFC|FCD|FCC|FCE|AKX)[0-9][A-Z0-9/\-.]*/i;

/** "100,00 WOE506" -> { valor: 100, codigo: 'WOE506' } */
function separar(txt) {
  const s = String(txt ?? '').trim();
  if (!s) return { valor: null, codigo: null };

  const mc = s.match(COD);
  const codigo = mc ? mc[0].toUpperCase() : null;

  const resto = codigo ? s.replace(mc[0], ' ') : s;
  const mv = resto.match(/\d{1,6}(?:[.,]\d{1,2})?/);
  let valor = null;
  if (mv) {
    const n = parseFloat(mv[0].replace('.', '').replace(',', '.'));
    // preço de filtro na Farias vai de ~R$20 a ~R$400; fora disso é outra coisa
    if (Number.isFinite(n) && n > 0 && n < 100000) valor = Math.round(n * 100) / 100;
  }
  return { valor, codigo };
}

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'farias',
    multipleStatements: true
  });

  const [[tem]] = await db.query(
    `SELECT COUNT(*) n FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'servicos'
        AND column_name = 'valor_filtro_oleo'`);
  if (!tem.n) {
    console.error('\nAs colunas novas não existem. Aplique primeiro, como root:');
    console.error('  mysql -uroot ' + (process.env.DB_NAME || 'farias') + ' < sql/valores.sql\n');
    process.exit(1);
  }

  const [linhas] = await db.query(
    `SELECT id, veiculo_id, data, bruto_filtro_oleo, bruto_filtro_ar, extras_bruto
       FROM servicos`);

  const upd = [];
  const cont = { valorOleo: 0, valorAr: 0, codOleo: 0, codAr: 0, codCabine: 0, nada: 0 };
  // o código mais recente de cada veículo, para preencher a ficha
  const porVeiculo = new Map();

  for (const s of linhas) {
    const o = separar(s.bruto_filtro_oleo);
    const a = separar(s.bruto_filtro_ar);
    const c = separar(s.extras_bruto);

    if (o.valor != null) cont.valorOleo++;
    if (a.valor != null) cont.valorAr++;
    if (o.codigo) cont.codOleo++;
    if (a.codigo) cont.codAr++;
    if (c.codigo) cont.codCabine++;
    if (o.valor == null && a.valor == null && !o.codigo && !a.codigo && !c.codigo) cont.nada++;

    upd.push([s.id, o.valor, a.valor, o.codigo, a.codigo, c.codigo]);

    if (o.codigo || a.codigo || c.codigo) {
      const ant = porVeiculo.get(s.veiculo_id);
      if (!ant || new Date(s.data) >= new Date(ant.data))
        porVeiculo.set(s.veiculo_id, {
          data: s.data,
          oleo: o.codigo || ant?.oleo || null,
          ar: a.codigo || ant?.ar || null,
          cabine: c.codigo || ant?.cabine || null
        });
    }
  }

  console.log(`ordens lidas: ${linhas.length}`);
  console.log(`  preço do filtro de óleo : ${cont.valorOleo}`);
  console.log(`  preço do filtro de ar   : ${cont.valorAr}`);
  console.log(`  código de óleo recuperado   : ${cont.codOleo}`);
  console.log(`  código de ar recuperado     : ${cont.codAr}`);
  console.log(`  código de cabine recuperado : ${cont.codCabine}`);
  console.log(`  veículos que ganham filtro na ficha: ${porVeiculo.size}`);

  if (!APLICAR) {
    console.log('\n(simulação — rode com --aplicar para gravar)');
    await db.end();
    return;
  }

  let n = 0;
  for (let i = 0; i < upd.length; i += 500) {
    const lote = upd.slice(i, i + 500);
    await Promise.all(lote.map(([id, vo, va, co, ca, cc]) =>
      db.query(
        `UPDATE servicos SET valor_filtro_oleo = ?, valor_filtro_ar = ?,
                cod_filtro_oleo = ?, cod_filtro_ar = ?, cod_filtro_cabine = ?
          WHERE id = ?`, [vo, va, co, ca, cc, id])));
    n += lote.length;
  }
  console.log(`\ngravadas ${n} ordens`);

  // ficha do veículo: só preenche o que está vazio, nunca sobrescreve confirmação
  let fichas = 0;
  for (const [vid, f] of porVeiculo) {
    const [r] = await db.query(
      `UPDATE veiculos SET
         filtro_oleo   = COALESCE(filtro_oleo, ?),
         filtro_ar     = COALESCE(filtro_ar, ?),
         filtro_cabine = COALESCE(filtro_cabine, ?),
         filtros_por   = COALESCE(filtros_por, 'histórico'),
         filtros_em    = COALESCE(filtros_em, ?)
       WHERE id = ? AND (filtro_oleo IS NULL OR filtro_ar IS NULL OR filtro_cabine IS NULL)`,
      [f.oleo, f.ar, f.cabine, f.data, vid]);
    if (r.affectedRows) fichas++;
  }
  console.log(`fichas de veículo preenchidas pelo histórico: ${fichas}`);

  const [[chk]] = await db.query(
    `SELECT SUM(valor_filtro_oleo) so, SUM(valor_filtro_ar) sa,
            SUM(cod_filtro_oleo IS NOT NULL) co FROM servicos`);
  const br = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  console.log(`\nconferência: óleo ${br(chk.so)} · ar ${br(chk.sa)} · ${chk.co} códigos`);

  await db.end();
})().catch(e => { console.error('falhou:', e.message); process.exit(1); });
