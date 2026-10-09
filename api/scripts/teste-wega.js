/* Confere o catálogo Wega: integridade dos dados e a sugestão na ponta.
   node scripts/teste-wega.js [http://localhost:3001] */
'use strict';
require('../src/ambiente');
const mysql = require('mysql2/promise');

const BASE = process.argv[2] || 'http://localhost:3001';
const USUARIO = process.env.TESTE_USUARIO || 'raissa';
const SENHA = process.env.TESTE_SENHA || 'farias2026';

let passou = 0, falhou = 0; const linhas = [];
const ok = (nome, cond, det = '') => {
  cond ? passou++ : falhou++;
  linhas.push(`  ${cond ? 'ok  ' : 'FALHA'} ${nome}${det ? ' · ' + det : ''}`);
  return cond;
};

/* Prefixo esperado por coluna. É a checagem que pega troca de coluna:
   se um FCI (combustível) aparecer na coluna do óleo, a extração errou. */
const PREFIXO = {
  f_ar:              /^(FAP|JFA|WR|WAP)/,
  f_oleo:            /^(WO|WOE|WEO|JFO|WUNI)/,
  f_oleo_opc:        /^(WUNI|TFW|WO|WOE|JFO)/,
  f_combustivel:     /^(FCI|JFC|FCD|FCC|FCE|JFCH|JFCK|JFCS|JFCL|WFC)/,
  f_combustivel_opc: /^(FCI|JFC|FCD|FCC|FCE|JFCH|JFCK|JFCS|JFCL|WFC)/,
  f_cabine:          /^AKX/,
  f_cabine_carvao:   /^AKX/
};

(async () => {
  console.log(`\n=== catálogo Wega ===\n`);
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'farias'
  });

  /* --- 1. o catálogo entrou --- */
  const [[t]] = await db.query('SELECT COUNT(*) n, COUNT(DISTINCT marca) m FROM catalogo_filtro');
  ok('catálogo carregado', t.n > 2000, `${t.n} linhas, ${t.m} marcas`);
  ok('cobre o alfabeto todo', t.m >= 30, `${t.m} montadoras`);

  /* --- 2. nenhum código caiu na coluna errada --- */
  for (const [col, re] of Object.entries(PREFIXO)) {
    const [fora] = await db.query(
      `SELECT ${col} v, marca, modelo, pagina FROM catalogo_filtro
        WHERE ${col} IS NOT NULL AND ${col} NOT REGEXP ? LIMIT 3`,
      [re.source.replace(/^\^/, '^')]);
    ok(`${col}: todo código tem prefixo do tipo certo`, fora.length === 0,
       fora.length ? `ex.: ${fora[0].v} em ${fora[0].marca} ${fora[0].modelo} (p.${fora[0].pagina})` : '');
  }

  /* --- 3. nada de lixo de layout --- */
  const [[lixo]] = await db.query(
    `SELECT COUNT(*) n FROM catalogo_filtro
      WHERE f_ar REGEXP '^[A-Z]$' OR f_oleo REGEXP '^[A-Z]$'
         OR f_combustivel REGEXP '^[A-Z]$' OR f_cabine REGEXP '^[A-Z]$'
         OR f_combustivel_opc REGEXP '^[A-Z]$'`);
  ok('nenhuma letra solta virou código', Number(lixo.n) === 0, `${lixo.n} encontradas`);

  /* --- 4. anos coerentes --- */
  const [[anos]] = await db.query(
    `SELECT SUM(ano_ini IS NOT NULL) com,
            SUM(ano_fim IS NOT NULL AND ano_ini IS NOT NULL AND ano_fim < ano_ini) invertidos,
            SUM(ano_ini < 1950 OR ano_ini > YEAR(CURDATE())+1) fora
       FROM catalogo_filtro`);
  ok('a maioria das linhas tem ano', Number(anos.com) > t.n * 0.8, `${anos.com} de ${t.n}`);
  ok('nenhuma faixa de ano invertida', Number(anos.invertidos) === 0, `${anos.invertidos}`);
  ok('nenhum ano fora do razoável', Number(anos.fora) === 0, `${anos.fora}`);

  /* --- 5. toda linha serve para alguma coisa --- */
  const [[vazias]] = await db.query(
    `SELECT COUNT(*) n FROM catalogo_filtro
      WHERE f_ar IS NULL AND f_oleo IS NULL AND f_oleo_opc IS NULL
        AND f_combustivel IS NULL AND f_cabine IS NULL`);
  ok('nenhuma linha sem filtro nenhum', Number(vazias.n) === 0, `${vazias.n}`);

  /* --- 6. a sugestão funciona na API --- */
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usuario: USUARIO, senha: SENHA })
  }).then(r => r.json()).catch(() => ({}));
  if (!ok('login na API', !!login.token)) return fim(db);
  const h = { authorization: 'Bearer ' + login.token };

  /* Daqui para baixo é preciso ter carro na base. Numa instalação nova ela
     está vazia de propósito (a planilha entra depois), e antes isto estourava
     com "Cannot read properties of undefined" — erro opaco, no exato cenário
     em que o instalador roda a conferência. */
  const [[alvo]] = await db.query(
    `SELECT placa, modelo, ano FROM veiculos
      WHERE filtro_oleo IS NULL AND modelo IS NOT NULL AND ano IS NOT NULL
      ORDER BY visitas DESC LIMIT 1`);

  if (!alvo) {
    linhas.push('');
    linhas.push('  (base sem veículos: as checagens que dependem de carro');
    linhas.push('   ficaram de fora. O catálogo em si está conferido acima.)');
    return fim(db);
  }

  const r = await fetch(`${BASE}/api/placa/${alvo.placa}`, { headers: h })
    .then(x => x.json());
  ok('consulta de placa responde', !!r.filtros,
     `${alvo.modelo} ${alvo.ano} -> ${r.filtros?.status}`);

  if (r.filtros?.itens?.length) {
    const tipos = r.filtros.itens.map(i => i.tipo);
    ok('a sugestão vem rotulada por tipo',
       r.filtros.itens.every(i => i.tipo && i.rotulo && i.codigo),
       tipos.join(', '));
    ok('a sugestão diz de onde saiu', !!r.filtros.origem, r.filtros.origem);
    ok('dá para auditar no PDF', !!r.filtros.pagina_pdf, `página ${r.filtros.pagina_pdf}`);
    for (const i of r.filtros.itens)
      linhas.push(`        ${i.rotulo}: ${i.codigo}` +
                  (i.alternativo ? ` (alt. ${i.alternativo})` : ''));
  } else {
    linhas.push(`        (sem sugestão para ${alvo.modelo} ${alvo.ano}: ${r.filtros?.status})`);
  }

  /* --- 7. o que a loja confirmou continua mandando --- */
  const [[conf]] = await db.query(
    `SELECT id, placa FROM veiculos WHERE filtro_oleo IS NOT NULL LIMIT 1`);
  if (conf) {
    const rc = await fetch(`${BASE}/api/placa/${conf.placa}`, { headers: h }).then(x => x.json());
    ok('filtro confirmado pela loja tem prioridade sobre o catálogo',
       rc.filtros?.status === 'cadastrado', rc.filtros?.status);
  }

  /* --- 7b. a fila já vem com a sugestão ao lado --- */
  const fila = await fetch(`${BASE}/api/veiculos/pendencias/sem-filtro?limite=5`,
    { headers: h }).then(x => x.json());
  const comSug = (fila.veiculos || []).filter(v => v.sugestao?.itens?.length);
  ok('a fila de filtros vem com sugestão pronta', comSug.length > 0,
     `${comSug.length} de ${(fila.veiculos || []).length} na primeira página`);

  /* --- 7c. aceitar a sugestão grava e registra a origem --- */
  const alvo2 = comSug.find(v => v.sugestao.status !== 'precisa_confirmar');
  if (alvo2) {
    const ac = await fetch(`${BASE}/api/veiculos/${alvo2.id}/filtros/aceitar`,
      { method: 'POST', headers: h }).then(x => x.json());
    ok('aceitar a sugestão grava os filtros',
       !!ac.veiculo?.filtro_oleo, ac.veiculo?.filtro_oleo || JSON.stringify(ac).slice(0,80));
    ok('fica registrado que veio do catálogo e quem aceitou',
       /cat[aá]logo/i.test(ac.veiculo?.filtros_por || ''), ac.veiculo?.filtros_por);
    // desfaz, para a bancada não sujar a base
    await db.query(
      `UPDATE veiculos SET filtro_oleo=NULL, filtro_ar=NULL, filtro_cabine=NULL,
              filtro_combustivel=NULL, filtros_por=NULL, filtros_em=NULL
        WHERE id = ?`, [alvo2.id]);
  }

  /* --- 7d. recarregar o catálogo sem reiniciar --- */
  const rec = await fetch(`${BASE}/api/notificacoes/recarregar-catalogo`,
    { method: 'POST', headers: h }).then(x => x.json());
  ok('dá para recarregar o catálogo sem reiniciar a API',
     rec.ok === true && rec.linhas > 2000, `${rec.linhas} linhas em ${rec.ms}ms`);

  /* --- 7e. a sugestão é a mesma que a varredura completa daria ---
     Guarda contra otimização que "acelera" perdendo resposta: já aconteceu
     aqui um índice que fazia "Spin 2016" deixar de ser marcado como ambíguo. */
  const wega = require('../src/meio/wega');
  const [catTodo] = await db.query(
    `SELECT id, marca, modelo, versao, combustivel_txt, ano_ini, ano_fim,
            f_ar, f_oleo, f_oleo_opc, f_combustivel, f_combustivel_opc,
            f_cabine, f_cabine_carvao, pagina, linha_bruta FROM catalogo_filtro`);
  const [amostra] = await db.query(
    'SELECT marca, modelo, ano FROM veiculos WHERE modelo IS NOT NULL LIMIT 400');
  if (!amostra.length) {
    linhas.push('  (sem veículos para comparar índice x varredura)');
  } else {
  let difer = 0, primeira = null;
  for (const v of amostra) {
    const a = await wega.sugerirFiltros({ marca: v.marca, modelo: v.modelo, ano: v.ano });
    const b = await wega._forcaBruta({ marca: v.marca, modelo: v.modelo, ano: v.ano }, catTodo);
    const ja = JSON.stringify({ s: a.status, c: a.confianca, i: a.itens });
    const jb = JSON.stringify({ s: b.status, c: b.confianca, i: b.itens });
    if (ja !== jb) {
      difer++;
      if (!primeira) primeira = `${v.modelo} ${v.ano}: ${a.status}/${a.confianca} x ${b.status}/${b.confianca}`;
    }
  }
  ok('a sugestão bate com a varredura completa', difer === 0,
     difer ? `${difer} de ${amostra.length} diferentes — ex.: ${primeira}`
           : `${amostra.length} veículos conferidos`);
  }

  /* --- 8. quanto da fila o catálogo resolve --- */
  const [[cob]] = await db.query(
    `SELECT COUNT(*) total,
            SUM(EXISTS (SELECT 1 FROM catalogo_filtro cf
                         WHERE v.modelo LIKE CONCAT('%', SUBSTRING_INDEX(cf.modelo,' ',1), '%'))) casam
       FROM veiculos v
      WHERE v.filtro_oleo IS NULL AND v.situacao IN ('em_dia','vencido')`);
  linhas.push(`\n  cobertura: ${cob.casam} de ${cob.total} carros da fila casam com algum modelo do catálogo`);

  fim(db);
})().catch(e => { console.error('erro:', e.message); process.exit(1); });

async function fim(db) {
  await db.end().catch(() => {});
  console.log(linhas.join('\n'));
  console.log(`\n${passou} passaram · ${falhou} falharam\n`);
  process.exit(falhou ? 1 : 0);
}
