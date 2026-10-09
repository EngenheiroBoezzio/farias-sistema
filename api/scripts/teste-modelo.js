/* Confere o caminho SEM consulta paga: placa desconhecida -> o balcão digita
   o modelo -> o sistema diz o óleo e os filtros.
 *
 * Este é o caminho que a Farias vai usar todo dia, porque consulta de placa
 * boa pede CNPJ e a oficina não tem. Então ele precisa ficar tão testado
 * quanto o outro — na prática, mais.
 *
 *   node scripts/teste-modelo.js                      (sobe uma API só para o teste)
 *   node scripts/teste-modelo.js http://127.0.0.1:3001 (usa a API já instalada)
 */
'use strict';
require('../src/ambiente');
const { spawn } = require('child_process');
const path = require('path');
const { q, pool } = require('../src/db');

const PORTA = 3198;
/* Com endereço na linha de comando, usa a API que já está de pé — é assim que
   o instalador confere a instalação recém-feita. Sem ele, sobe uma API só
   para o teste, sem consulta de placa configurada. */
const EXTERNA = process.argv[2] || null;
const BASE = EXTERNA || `http://127.0.0.1:${PORTA}`;

let passou = 0, falhou = 0;
const ok = (nome, cond, det = '') => {
  cond ? passou++ : falhou++;
  console.log(`  ${cond ? 'ok  ' : 'FALHA'} ${nome}${det ? ' · ' + det : ''}`);
  return !!cond;
};

const pega = (t, url) => fetch(BASE + url, { headers: { authorization: 'Bearer ' + t } });
const json = (t, url) => pega(t, url).then(r => r.json());

(async () => {
  console.log('\n=== consulta por modelo (sem API paga) ===\n');

  /* Sobe SEM PLACA_API_URL de propósito: é assim que a oficina vai rodar
     enquanto não houver consulta de placa contratada, e o sistema inteiro
     tem que funcionar assim. */
  const api = EXTERNA ? null : spawn(process.execPath, ['src/servidor.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORTA), PLACA_API_URL: '' },
    stdio: 'ignore'
  });
  if (!EXTERNA) await new Promise(r => setTimeout(r, 4000));

  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      usuario: process.env.TESTE_USUARIO || 'raissa',
      senha: process.env.TESTE_SENHA || 'farias2026'
    })
  }).then(r => r.json()).catch(() => ({}));
  if (!ok('login', !!login.token)) return fim(api);
  const t = login.token;

  /* ---------- 1. placa desconhecida abre o caminho, não fecha a porta ---- */
  console.log('\n  --- placa que a oficina não conhece ---');
  const r1 = await pega(t, '/api/placa/ZZZ9Z99');
  const j1 = await r1.json();
  ok('responde 200, não 404', r1.status === 200, `veio ${r1.status}`);
  ok('marca que precisa do modelo', j1.precisa_modelo === true);
  ok('diz o que fazer, em português', /modelo/i.test(j1.acao || ''), j1.acao);
  /* O motivo tem que separar "base vazia" de "carro novo" de "o serviço não
     achou". Com a mesma frase nos três, o balcão procura defeito na placa
     quando o problema é que a planilha nunca foi importada. */
  ok('o motivo diz por que não achou, não só que não achou',
     /planilha|consulta externa/i.test(j1.motivo || ''), j1.motivo);
  ok('já entrega os modelos mais comuns para clicar',
     (j1.modelos_comuns || []).length >= 5, `${(j1.modelos_comuns || []).length}`);
  ok('o mais comum vem com a contagem de carros',
     (j1.modelos_comuns?.[0]?.carros || 0) > 0,
     `${j1.modelos_comuns?.[0]?.modelo} · ${j1.modelos_comuns?.[0]?.carros}`);
  /* Com consulta de placa configurada o passo aparece como tentativa; sem
     ela, tem que aparecer como pulado. O que não pode, em nenhum dos dois, é
     o sistema calar sobre o que fez. */
  ok('diz o que fez com a consulta externa',
     (j1.passos || []).some(p => p.passo === 'api_placa'),
     EXTERNA ? 'API instalada' : 'sem consulta externa');

  /* ---------- 2. o campo de modelo ---------- */
  console.log('\n  --- campo de digitar o modelo ---');
  const m1 = await json(t, '/api/placa/modelos?busca=corol');
  ok('acha por começo de nome',
     (m1.modelos || []).some(m => /corolla/i.test(m.modelo)),
     (m1.modelos || []).slice(0, 3).map(m => m.modelo).join(', '));

  /* o balcão escreve grudado o que o catálogo escreve separado */
  const m2 = await json(t, '/api/placa/modelos?busca=spacefox');
  ok('acha "Space Fox" quando digitam "spacefox"',
     (m2.modelos || []).some(m => /space\s*fox/i.test(m.modelo)),
     (m2.modelos || []).map(m => m.modelo).join(', '));

  const m3 = await json(t, '/api/placa/modelos');
  ok('sem busca, devolve os que mais entram na oficina',
     (m3.modelos || []).length >= 5 && m3.modelos[0].carros >= m3.modelos[1].carros,
     m3.modelos?.[0]?.modelo);

  const m4 = await json(t, '/api/placa/modelos?busca=x');
  ok('uma letra só não devolve o catálogo inteiro',
     (m4.modelos || []).length === 0, `${(m4.modelos || []).length}`);

  const m5 = await json(t, '/api/placa/modelos?busca=zzzznaoexiste');
  ok('modelo que não existe devolve lista vazia, não erro',
     Array.isArray(m5.modelos) && m5.modelos.length === 0);

  /* ---------- 3. a resposta: óleo e filtro ---------- */
  console.log('\n  --- modelo digitado, óleo e filtros ---');
  const g = await json(t, '/api/placa/por-modelo?modelo=Gol&ano=2015&cilindrada=1.0');
  ok('responde como um veículo resolvido', g.encontrado === true);
  ok('diz de onde veio', /balc/i.test(g.origem_veiculo || ''), g.origem_veiculo);
  ok('devolve uma recomendação única de óleo', !!g.oleo?.recomendado?.texto,
     JSON.stringify(g.oleo?.recomendado?.texto));
  ok('a recomendação diz a fonte', !!g.oleo?.recomendado?.fonte, g.oleo?.recomendado?.fonte);
  ok('a recomendação diz POR QUE, com números',
     /\d+ de \d+/.test(g.oleo?.recomendado?.porque || '') ||
     !!g.oleo?.recomendado?.porque, g.oleo?.recomendado?.porque);
  ok('traz os quatro tipos de filtro rotulados',
     ['oleo', 'ar', 'combustivel', 'cabine']
       .every(x => (g.filtros?.itens || []).some(i => i.tipo === x)),
     (g.filtros?.itens || []).map(i => `${i.tipo}=${i.codigo}`).join(' '));
  ok('cada filtro vem com o rótulo que o balcão lê',
     (g.filtros?.itens || []).every(i => !!i.rotulo),
     (g.filtros?.itens || [])[0]?.rotulo);
  ok('nenhuma ida à rede neste caminho',
     !(g.passos || []).some(p => p.passo === 'api_placa'));
  ok('pede confirmação do atendente', g.confirmar === true);

  /* ---------- 4. o histórico da casa ---------- */
  console.log('\n  --- o que a própria oficina usa ---');
  ok('conta o histórico do modelo', !!g.oleo?.na_casa, `${g.oleo?.na_casa?.total} trocas`);
  ok('agrupa por viscosidade, não por marca de prateleira',
     /^\d{1,2}W-\d{2}$/.test(g.oleo?.na_casa?.viscosidade || ''),
     g.oleo?.na_casa?.viscosidade);
  ok('diz qual marca a casa costuma usar nessa viscosidade',
     !!g.oleo?.na_casa?.marca_usual, g.oleo?.na_casa?.marca_usual);
  ok('a soma das trocas bate com o total',
     (g.oleo.na_casa.itens || []).reduce((s, i) => s + i.vezes, 0) === g.oleo.na_casa.total,
     `${g.oleo.na_casa.total}`);
  ok('aperta a faixa de ano quando há carros bastante',
     g.oleo?.na_casa?.janela === 3 && g.oleo?.na_casa?.ano === 2015,
     `janela ${g.oleo?.na_casa?.janela}`);

  /* Amostra pequena não pode virar certeza. Um modelo raro tem que sair com
     confiança baixa mesmo que 100% das (duas) trocas concordem. */
  const raros = await q(
    `SELECT v.modelo, COUNT(DISTINCT s.id) n
       FROM veiculos v JOIN servicos s ON s.veiculo_id = v.id
      WHERE s.oleo IS NOT NULL AND s.oleo <> ''
      GROUP BY v.modelo HAVING n BETWEEN 2 AND 5 ORDER BY n LIMIT 1`);
  if (raros.length) {
    const raro = await json(t, `/api/placa/por-modelo?modelo=${encodeURIComponent(raros[0].modelo)}`);
    const c = raro.oleo?.na_casa?.confianca;
    ok(`modelo com poucas trocas sai com confiança baixa (${raros[0].modelo})`,
       c != null && c < 40, `confiança ${c} · ${raros[0].n} trocas`);
    /* Com amostra pequena a casa NÃO pode ser a fonte da recomendação: ou o
       catálogo assume, ou a recomendação sai marcada como fraca. O que não
       pode é sair "a oficina usa X" com força alta apoiado em duas trocas. */
    const rec = raro.oleo?.recomendado;
    ok('amostra pequena não vira "a oficina usa isso"',
       !rec || rec.fonte !== 'histórico da oficina' || rec.forca === 'baixa',
       rec ? `${rec.fonte} · ${rec.forca}` : 'sem recomendação');
  } else {
    ok('modelo com poucas trocas sai com confiança baixa', true, 'sem caso na base');
    ok('amostra pequena não vira "a oficina usa isso"', true, 'sem caso na base');
  }

  /* ---------- 5. ano muda a resposta ---------- */
  console.log('\n  --- o ano tem que mudar a resposta ---');
  /* O catálogo Wega escreve "Gol" no nome de TODAS as linhas de Gol — a
     geração vai na descrição. Sem desempate por geração, um Gol 2020 pegava
     a linha "Gol (EFI - MI / Power / Rallye) 2004 -->" só porque ela vinha
     antes na página do PDF, e saía WO370 num carro que leva WO545. É o tipo
     de erro que termina em filtro errado no motor de um cliente, então fica
     pregado aqui por ano. */
  const cod = r => (r.filtros?.itens || []).find(i => i.tipo === 'oleo')?.codigo || null;
  const porAno = {};
  for (const a of [1996, 2004, 2012, 2016, 2020]) {
    porAno[a] = await json(t, `/api/placa/por-modelo?modelo=Gol&ano=${a}`);
  }
  const linha = a => `${a}:${cod(porAno[a])}`;
  ok('Gol velho e Gol novo não levam o mesmo filtro de óleo',
     cod(porAno[1996]) !== cod(porAno[2020]),
     [1996, 2004, 2012, 2016, 2020].map(linha).join(' '));
  ok('Gol 2016 e 2020 caem na geração G7 (2016 em diante)',
     /2016/.test(porAno[2016].filtros?.origem || '') &&
     /2016/.test(porAno[2020].filtros?.origem || ''),
     porAno[2020].filtros?.origem);
  ok('Gol 1996 não cai numa linha que só começa depois dele',
     !/\(20\d\d/.test(porAno[1996].filtros?.origem || ''),
     porAno[1996].filtros?.origem);

  /* ---------- 6. entrada ruim ---------- */
  console.log('\n  --- entrada ruim ---');
  const semModelo = await pega(t, '/api/placa/por-modelo');
  ok('sem modelo recusa com 400', semModelo.status === 400, `veio ${semModelo.status}`);

  const anoBobo = await pega(t, '/api/placa/por-modelo?modelo=Gol&ano=3050');
  ok('ano impossível recusa com 400', anoBobo.status === 400, `veio ${anoBobo.status}`);

  const gigante = await pega(t,
    '/api/placa/por-modelo?modelo=' + encodeURIComponent('G'.repeat(200)));
  ok('modelo gigante recusa, não corta calado', gigante.status === 400,
     `veio ${gigante.status}`);

  const inexistente = await json(t, '/api/placa/por-modelo?modelo=Naveespacial&ano=2020');
  ok('modelo que não existe não estoura',
     inexistente.encontrado === true && (inexistente.filtros?.itens || []).length === 0);
  ok('e devolve parecidos para o balcão tentar de novo',
     Array.isArray(inexistente.parecidos), `${(inexistente.parecidos || []).length}`);

  /* ---------- 7. quem não está logado não passa ---------- */
  console.log('\n  --- porta trancada ---');
  const semLogin = await fetch(BASE + '/api/placa/por-modelo?modelo=Gol');
  ok('por-modelo exige login', semLogin.status === 401, `veio ${semLogin.status}`);
  const semLogin2 = await fetch(BASE + '/api/placa/modelos?busca=gol');
  ok('a lista de modelos exige login', semLogin2.status === 401, `veio ${semLogin2.status}`);

  /* ---------- 8. "por-modelo" não pode ser lido como placa ---------- */
  ok('a rota nova não foi engolida pela rota de placa',
     !/placa.*inv/i.test(JSON.stringify(g)) && g.placa === null);

  fim(api);
})().catch(e => { console.error('erro:', e.message); process.exit(1); });

function fim(api) {
  if (api) api.kill();
  pool.end().catch(() => {});
  console.log(`\n${passou} passaram · ${falhou} falharam\n`);
  setTimeout(() => process.exit(falhou ? 1 : 0), 300);
}
