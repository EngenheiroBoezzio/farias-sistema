/* Quanto da fila de filtros o catálogo Wega resolve sozinho.
   Usa o MESMO casador da API, não uma query aproximada.
   node scripts/cobertura-wega.js */
'use strict';
require('../src/ambiente');
const { q, pool } = require('../src/db');
const { sugerirFiltros } = require('../src/meio/wega');

(async () => {
  const fila = await q(
    `SELECT id, placa, marca, modelo, ano FROM veiculos
      WHERE filtro_oleo IS NULL AND situacao IN ('em_dia','vencido')`);
  console.log(`fila: ${fila.length} carros ativos sem filtro cadastrado\n`);

  const conta = { sugerido: 0, ambiguo: 0, precisa_confirmar: 0,
                  sem_catalogo: 0, sem_modelo: 0 };
  const semAno = { com: 0, sem: 0 };
  const exemplos = [];

  for (const v of fila) {
    const s = await sugerirFiltros({ marca: v.marca, modelo: v.modelo, ano: v.ano });
    conta[s.status] = (conta[s.status] || 0) + 1;
    if (s.status === 'sugerido' || s.status === 'ambiguo') {
      (v.ano ? semAno.com++ : semAno.sem++);
      if (exemplos.length < 5)
        exemplos.push(`${v.modelo} ${v.ano || 's/ano'} -> ` +
          s.itens.map(i => `${i.tipo}:${i.codigo}`).join(' · ') + ` (${s.confianca}%)`);
    }
  }

  const bom = conta.sugerido + conta.ambiguo;
  const pc = n => Math.round(100 * n / fila.length) + '%';
  console.log(`  pronto para preencher : ${conta.sugerido} (${pc(conta.sugerido)})`);
  console.log(`  mais de uma opção     : ${conta.ambiguo} (${pc(conta.ambiguo)})`);
  console.log(`  confiança baixa       : ${conta.precisa_confirmar} (${pc(conta.precisa_confirmar)})`);
  console.log(`  sem par no catálogo   : ${conta.sem_catalogo} (${pc(conta.sem_catalogo)})`);
  console.log(`  sem modelo na ficha   : ${conta.sem_modelo} (${pc(conta.sem_modelo)})`);
  console.log(`\n  aproveitável de imediato: ${bom} de ${fila.length} (${pc(bom)})`);
  console.log(`  desses, ${semAno.sem} não têm ano na ficha (casamento menos seguro)`);
  console.log('\n  exemplos:');
  for (const e of exemplos) console.log('   ', e);

  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
