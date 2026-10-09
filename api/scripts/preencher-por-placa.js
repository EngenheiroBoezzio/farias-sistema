/* Preenche motorização, versão e ano dos veículos que estão sem, consultando
   a placa uma vez por carro.
 *
 * Cada consulta custa. Por isso este script:
 *   - só consulta quem realmente precisa (sem cilindrada);
 *   - respeita o cache: placa já consultada não gasta de novo;
 *   - tem teto de consultas por rodada, que você define;
 *   - simula por padrão, e só gasta com --aplicar;
 *   - para na hora se o serviço começar a recusar.
 *
 *   node scripts/preencher-por-placa.js              (simula, não gasta nada)
 *   node scripts/preencher-por-placa.js --aplicar --max=100
 */
'use strict';
require('../src/ambiente');
const { q, pool } = require('../src/db');

const APLICAR = process.argv.includes('--aplicar');
const MAX = (() => {
  const a = process.argv.find(x => x.startsWith('--max='));
  return a ? Math.max(1, parseInt(a.split('=')[1], 10) || 50) : 50;
})();
const PAUSA = +(process.env.PLACA_PAUSA_MS || 350);

const API_URL = process.env.PLACA_API_URL || '';
const API_TOKEN = process.env.PLACA_API_TOKEN || '';
const TIMEOUT = +(process.env.PLACA_TIMEOUT_MS || 8000);

const cilindrada = v => {
  if (v == null) return null;
  const s = String(v).replace(',', '.');
  const d = s.match(/\b([0-9])\.([0-9])\b/);
  if (d) return `${d[1]}.${d[2]}`;
  const cc = parseInt(s.replace(/\D/g, ''), 10);
  if (!cc || cc < 600 || cc > 8000) return null;
  return (Math.round(cc / 100) / 10).toFixed(1);
};

const normComb = v => {
  const t = String(v || '').toLowerCase();
  if (/[áa]lcool|etanol/.test(t) && /gasolina/.test(t)) return 'flex';
  if (/flex/.test(t)) return 'flex';
  if (/diesel/.test(t)) return 'diesel';
  if (/gasolina/.test(t)) return 'gasolina';
  if (/[áa]lcool|etanol/.test(t)) return 'alcool';
  return null;
};

function melhorFipe(j, ano) {
  const l = j?.fipe?.dados;
  if (!Array.isArray(l) || !l.length) return null;
  return l.slice().sort((a, b) => {
    const s = (+b.score || 0) - (+a.score || 0);
    if (s) return s;
    return Math.abs((+a.ano_modelo || 0) - (ano || 0)) -
           Math.abs((+b.ano_modelo || 0) - (ano || 0));
  })[0];
}

async function consultar(placa) {
  const url = API_URL.replace('{placa}', encodeURIComponent(placa))
                     .replace('{token}', encodeURIComponent(API_TOKEN));
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
  const j = await r.json();
  if (j?.mensagemRetorno && !/sem erros/i.test(j.mensagemRetorno) && !j.MODELO && !j.modelo)
    return { vazio: String(j.mensagemRetorno).slice(0, 80) };
  const e = j.extra || {};
  const ano = parseInt(j.anoModelo || e.ano_modelo || j.ano, 10) || null;
  const f = melhorFipe(j, ano);
  return {
    marca: j.MARCA || j.marca || null,
    modelo: j.MODELO || j.modelo || null,
    versao: f?.texto_modelo || j.VERSAO || null,
    cilindrada: cilindrada(e.cilindradas),
    ano,
    combustivel: normComb(e.combustivel || f?.combustivel),
    fipe_codigo: f?.codigo_fipe || null,
    bruto: j
  };
}

(async () => {
  if (!API_URL || !API_TOKEN) {
    console.error('\nPLACA_API_URL e PLACA_API_TOKEN não estão no .env.');
    console.error('Sem eles não há o que consultar. Veja a seção "Consulta de placa"');
    console.error('do INSTALACAO.md.\n');
    process.exit(1);
  }

  /* quem precisa: sem motorização, e ativo (carro frio não vale a consulta) */
  const alvos = await q(
    `SELECT v.id, v.placa, v.modelo, v.ano
       FROM veiculos v
      WHERE v.cilindrada IS NULL
        AND v.situacao IN ('em_dia','vencido')
        AND NOT EXISTS (SELECT 1 FROM cache_placa c WHERE c.placa = v.placa)
      ORDER BY v.visitas DESC, v.ultima_troca DESC
      LIMIT ?`, [MAX]);

  const [[pend]] = [await q(
    `SELECT COUNT(*) n FROM veiculos v
      WHERE v.cilindrada IS NULL AND v.situacao IN ('em_dia','vencido')
        AND NOT EXISTS (SELECT 1 FROM cache_placa c WHERE c.placa = v.placa)`)];

  console.log(`\ncarros ativos sem motorização, ainda não consultados: ${pend.n}`);
  console.log(`esta rodada vai pegar os ${alvos.length} de mais visitas`);
  console.log(`custo estimado: ${alvos.length} consultas\n`);

  if (!APLICAR) {
    for (const v of alvos.slice(0, 10))
      console.log(`  ${v.placa}  ${v.modelo || '—'}  ${v.ano || 's/ano'}`);
    if (alvos.length > 10) console.log(`  ... e mais ${alvos.length - 10}`);
    console.log('\n(simulação — rode com --aplicar para consultar de verdade)\n');
    await pool.end();
    return;
  }

  let ok = 0, vazios = 0, erros = 0;
  for (const v of alvos) {
    try {
      const d = await consultar(v.placa);
      if (d.vazio) {
        vazios++;
        console.log(`  — ${v.placa}: ${d.vazio}`);
      } else {
        await q(
          `INSERT INTO cache_placa
             (placa, marca, modelo, versao, cilindrada, ano, combustivel, fipe_codigo, bruto)
           VALUES (?,?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE marca=VALUES(marca), modelo=VALUES(modelo),
             versao=VALUES(versao), cilindrada=VALUES(cilindrada), ano=VALUES(ano),
             combustivel=VALUES(combustivel), fipe_codigo=VALUES(fipe_codigo),
             bruto=VALUES(bruto)`,
          [v.placa, d.marca, d.modelo, d.versao, d.cilindrada, d.ano,
           d.combustivel, d.fipe_codigo, JSON.stringify(d.bruto)]);

        /* COALESCE: nunca sobrescreve o que a loja já preencheu à mão */
        await q(
          `UPDATE veiculos SET
             marca       = COALESCE(marca, ?),
             cilindrada  = COALESCE(cilindrada, ?),
             ano         = COALESCE(ano, ?),
             versao      = COALESCE(versao, ?),
             combustivel = COALESCE(combustivel, ?),
             fipe_codigo = COALESCE(fipe_codigo, ?)
           WHERE id = ?`,
          [d.marca, d.cilindrada, d.ano, d.versao, d.combustivel, d.fipe_codigo, v.id]);

        ok++;
        console.log(`  ok ${v.placa}  ${d.marca || ''} ${d.versao || d.modelo || ''} ` +
                    `${d.cilindrada || ''} ${d.ano || ''}`.replace(/\s+/g, ' '));
      }
    } catch (e) {
      erros++;
      console.log(`  ERRO ${v.placa}: ${e.message}`);
      /* 401/403 é token inválido ou crédito acabado: insistir só gasta tempo
         e, se o serviço cobrar por tentativa, gasta dinheiro à toa. */
      if (e.status === 401 || e.status === 402 || e.status === 403) {
        console.log('\n  O serviço recusou a credencial. Parando aqui.');
        break;
      }
      if (erros >= 5 && ok === 0) {
        console.log('\n  Cinco erros seguidos e nenhum acerto. Parando para não gastar à toa.');
        break;
      }
    }
    await new Promise(r => setTimeout(r, PAUSA));
  }

  const [[dep]] = [await q(
    `SELECT SUM(cilindrada IS NOT NULL) com, COUNT(*) t FROM veiculos
      WHERE situacao IN ('em_dia','vencido')`)];

  console.log(`\npreenchidos: ${ok} · sem retorno: ${vazios} · erros: ${erros}`);
  console.log(`carros ativos com motorização agora: ${dep.com} de ${dep.t}`);
  console.log(`ainda faltam consultar: ${Math.max(0, pend.n - ok - vazios)}\n`);

  await pool.end();
})().catch(e => { console.error('falhou:', e.message); process.exit(1); });
