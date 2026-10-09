/* Carrega o catálogo de filtros Wega (extraído do PDF) no banco.
   node scripts/carregar-wega.js [catalogo_wega.json] */
'use strict';
require('../src/ambiente');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

/* Formatos de ano que o PDF usa:
     "1996 -->"   começa em 1996, sem fim
     "95 -- 98"   de 1995 a 1998
     "até 1993"   até 1993, sem início
     "--" ou ""   sem informação
   Dois dígitos: até 30 é 20xx, acima é 19xx. */
const invertidos = [];

function ano(txt) {
  const s = String(txt || '').replace(/\s+/g, ' ').trim();
  if (!s) return [null, null];

  const quatro = n => (n >= 1900 && n <= 2100 ? n : null);
  const dois = n => (n <= 30 ? 2000 + n : 1900 + n);
  const num = t => {
    const d = String(t).replace(/\D/g, '');
    if (d.length === 4) return quatro(+d);
    if (d.length === 2) return dois(+d);
    return null;
  };

  if (/^at[ée]\b/i.test(s)) return [null, num(s.replace(/^at[ée]\s*/i, ''))];

  const emDiante = /-->|=>|➔/.test(s);
  const partes = s.split(/-->|--|—|–|\bà\b|\ba\b/i)
    .map(p => p.trim()).filter(p => /\d/.test(p));

  if (!partes.length) return [null, null];
  if (emDiante || partes.length === 1) return [num(partes[0]), emDiante ? null : num(partes[0])];

  let ini = num(partes[0]), fim = num(partes[1]);
  // O próprio PDF traz uma faixa invertida (Renault R 25: "84 -- 82").
  // Invertida não casa com ano nenhum, então desinverte.
  if (ini && fim && fim < ini) { const t = ini; ini = fim; fim = t; invertidos.push(s); }
  return [ini, fim];
}

const combustivelDe = versao => {
  const v = String(versao || '').toLowerCase();
  if (/\bflex\b|total flex/.test(v)) return 'flex';
  if (/\bdiesel\b/.test(v)) return 'diesel';
  if (/\bgasolina\b/.test(v)) return 'gasolina';
  if (/\b[áa]lcool\b|\betanol\b/.test(v)) return 'alcool';
  return null;
};

const corta = (v, n) => {
  const s = String(v || '').trim();
  return s ? s.slice(0, n) : null;
};

(async () => {
  const arq = process.argv[2] ||
    path.join(__dirname, '..', 'dados', 'catalogo_wega.json');
  const cat = JSON.parse(fs.readFileSync(arq, 'utf8'));
  console.log(`lendo ${cat.length} linhas de ${path.basename(arq)}`);

  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'farias'
  });

  const [[existe]] = await db.query(
    `SELECT COUNT(*) n FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'catalogo_filtro'`);
  if (!existe.n) {
    console.error('\nA tabela catalogo_filtro nao existe.');
    console.error('Aplique primeiro, com um usuario que tenha DDL:');
    console.error('  mysql -uroot ' + (process.env.DB_NAME || 'farias') + ' < sql/wega.sql\n');
    process.exit(1);
  }

  const [antes] = await db.query('DELETE FROM catalogo_filtro');
  if (antes.affectedRows) console.log(`  limpou ${antes.affectedRows} linhas antigas`);

  // só entra linha que tenha ao menos um código de filtro
  const util = r => r.ar || r.oleo || r.oleo_opc || r.combustivel ||
                    r.combustivel_opc || r.cabine || r.cabine_carvao;

  const linhas = cat.filter(util).map(r => {
    const [ini, fim] = ano(r.ano);
    return ['wega',
      corta(r.marca, 40), corta(r.modelo, 80), corta(r.versao, 200),
      combustivelDe(r.versao), ini, fim,
      corta(r.ar, 30), corta(r.oleo, 30), corta(r.oleo_opc, 30),
      corta(r.combustivel, 30), corta(r.combustivel_opc, 30),
      corta(r.cabine, 30), corta(r.cabine_carvao, 30),
      corta(r.posicao, 20), r.pagina || null, corta(r.linha_bruta, 400)];
  });

  const COLS = `(fonte, marca, modelo, versao, combustivel_txt, ano_ini, ano_fim,
     f_ar, f_oleo, f_oleo_opc, f_combustivel, f_combustivel_opc,
     f_cabine, f_cabine_carvao, posicao, pagina, linha_bruta)`;

  for (let i = 0; i < linhas.length; i += 500) {
    const lote = linhas.slice(i, i + 500);
    await db.query(`INSERT INTO catalogo_filtro ${COLS} VALUES ?`, [lote]);
  }

  const [[r]] = await db.query(
    `SELECT COUNT(*) total,
            COUNT(DISTINCT marca) marcas,
            SUM(f_oleo IS NOT NULL) com_oleo,
            SUM(f_ar IS NOT NULL) com_ar,
            SUM(f_cabine IS NOT NULL) com_cabine,
            SUM(f_combustivel IS NOT NULL) com_combustivel,
            SUM(ano_ini IS NOT NULL) com_ano
       FROM catalogo_filtro`);
  console.log(`\ncarregado: ${r.total} linhas · ${r.marcas} marcas`);
  console.log(`  óleo ${r.com_oleo} · ar ${r.com_ar} · cabine ${r.com_cabine} · combustível ${r.com_combustivel}`);
  console.log(`  com ano reconhecido: ${r.com_ano}`);
  if (invertidos.length)
    console.log(`  faixas invertidas no PDF, corrigidas: ${invertidos.length} (${invertidos.join(', ')})`);

  await db.end();
})().catch(e => { console.error('falhou:', e.message); process.exit(1); });
