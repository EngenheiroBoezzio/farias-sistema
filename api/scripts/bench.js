/* Mede a latência de cada rota e mostra o plano das consultas críticas.
   node scripts/bench.js [http://localhost:3001]

   Antes de otimizar qualquer coisa, medir. (Playbook, Velocidade, regra zero.)
*/
'use strict';
require('../src/ambiente');
const mysql = require('mysql2/promise');

const BASE = process.argv[2] || 'http://localhost:3001';
const USUARIO = process.env.TESTE_USUARIO || 'raissa';
const SENHA = process.env.TESTE_SENHA || 'farias2026';
const RODADAS = 30;

const pct = (arr, p) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length * p)];

async function medir(caminho, headers, rodadas = RODADAS) {
  const tempos = [];
  const status = new Set();
  await fetch(BASE + caminho, { headers });                   // aquece
  for (let i = 0; i < rodadas; i++) {
    const t = process.hrtime.bigint();
    const r = await fetch(BASE + caminho, { headers });
    await r.arrayBuffer();
    tempos.push(Number(process.hrtime.bigint() - t) / 1e6);
    status.add(r.status);
  }
  // 429 e 401 respondem em fração de milissegundo: sem conferir o status,
  // o benchmark cronometra a recusa e mostra um número ótimo que é mentira.
  const ruins = [...status].filter(s => s !== 200);
  return {
    rota: caminho,
    mediana: +pct(tempos, 0.5).toFixed(1),
    p95: +pct(tempos, 0.95).toFixed(1),
    pior: +Math.max(...tempos).toFixed(1),
    ruins
  };
}

(async () => {
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usuario: USUARIO, senha: SENHA })
  }).then(r => r.json());
  if (!login.token) { console.error('login falhou:', login); process.exit(1); }
  const h = { authorization: 'Bearer ' + login.token };

  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'farias'
  });
  const [[v]] = await db.query('SELECT placa FROM veiculos LIMIT 1');

  const rotas = [
    '/health',
    '/api/painel',
    '/api/painel/vencidos?limite=50',
    '/api/painel/aniversariantes',
    '/api/veiculos?limite=50',
    '/api/veiculos?busca=gol&limite=50',
    '/api/veiculos?situacao=vencido&limite=50',
    `/api/veiculos/placa/${v.placa}`,
    '/api/servicos?limite=50',
    '/api/clientes?limite=50',
    '/api/clientes?busca=silva&limite=50',
    '/api/veiculos/pendencias/sem-filtro?limite=50',
    '/api/avisos/fila?limite=50',
    '/api/avisos/fila?tipo=aniversario&limite=50',
    '/api/avisos/resultado?dias=90',
    // consulta de placa: só 10 rodadas, o limitador corta em 15/min de propósito
    [`/api/placa/${v.placa}`, 10],
    /* Estas duas ficam fora do limitador caro e entram no bench inteiras: a
       de modelos dispara a CADA TECLA do balcão, então é a rota em que
       milissegundo vira sensação de travamento. */
    '/api/placa/modelos?busca=corol',
    '/api/placa/modelos?busca=gol',
    '/api/placa/por-modelo?modelo=Gol&ano=2015'
  ];

  console.log(`\n${RODADAS} chamadas por rota (a consulta de placa faz 10: limitador de 15/min)\n`);
  console.log('  rota'.padEnd(46) + 'mediana'.padStart(9) + 'p95'.padStart(9) + 'pior'.padStart(9));
  console.log('  ' + '-'.repeat(70));
  let invalidas = 0;
  for (const item of rotas) {
    const [r, rodadas] = Array.isArray(item) ? item : [item, RODADAS];
    const m = await medir(r, r === '/health' ? {} : h, rodadas);
    if (m.ruins.length) invalidas++;
    const alerta = m.ruins.length
      ? `  <-- MEDIDA INVÁLIDA: status ${m.ruins.join('/')}`
      : (m.p95 > 100 ? '  <-- acima de 100ms' : '');
    console.log('  ' + m.rota.padEnd(44) +
      String(m.mediana).padStart(9) + String(m.p95).padStart(9) +
      String(m.pior).padStart(9) + alerta);
  }

  if (invalidas)
    console.log(`\n  ATENÇÃO: ${invalidas} rota(s) não responderam 200 — esses tempos não valem.` +
                `\n  Reinicie a API (o limitador é de 2.000 req/15min) e rode de novo.`);

  console.log('\n--- plano das consultas críticas ---');
  const planos = [
    ['busca por placa', 'SELECT * FROM veiculos WHERE placa = ?', [v.placa]],
    ['fila de vencidos', "SELECT * FROM veiculos WHERE situacao='vencido' ORDER BY ultima_troca LIMIT 50", []],
    ['histórico do carro', 'SELECT * FROM servicos WHERE veiculo_id = 1 ORDER BY data DESC LIMIT 20', []],
    ['fechamento do mês', "SELECT COUNT(*) FROM servicos WHERE data >= '2026-09-01'", []]
  ];
  for (const [nome, sql, p] of planos) {
    const [linhas] = await db.query('EXPLAIN ' + sql, p);
    const e = linhas[0];
    const varre = e.type === 'ALL';
    console.log(`  ${nome.padEnd(20)} tipo=${String(e.type).padEnd(8)} ` +
                `chave=${String(e.key || '(nenhuma)').padEnd(20)} linhas=${String(e.rows).padStart(6)}` +
                (varre ? '   <-- VARRE A TABELA INTEIRA' : ''));
  }
  console.log();
  await db.end();
})().catch(e => { console.error(e); process.exit(1); });
