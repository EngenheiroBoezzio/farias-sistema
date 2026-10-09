/* Confere a leitura da resposta da consulta de placa.
 *
 * Sobe um servidor falso que devolve EXATAMENTE o JSON documentado pelo
 * serviço (apiplacas.com.br / wdapi2), aponta a API para ele e confere se o
 * que chega na tela é o que deveria. Assim dá para testar a integração sem
 * gastar consulta paga e sem depender de internet.
 *
 *   node scripts/teste-placa-api.js
 */
'use strict';
require('../src/ambiente');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORTA_FALSA = 3399;
const PORTA_API = 3199;

let passou = 0, falhou = 0;
const ok = (nome, cond, det = '') => {
  cond ? passou++ : falhou++;
  console.log(`  ${cond ? 'ok  ' : 'FALHA'} ${nome}${det ? ' · ' + det : ''}`);
  return !!cond;          // sem isto, `if (!ok(...))` sai sempre
};

/* Resposta real, copiada da documentação do serviço. Um Crossfox 2007:
   o modelo curto é "CROSSFOX", mas a motorização só aparece no bloco fipe. */
const CROSSFOX = {
  MARCA: 'VW', MODELO: 'CROSSFOX', SUBMODELO: 'CROSSFOX', VERSAO: 'CROSSFOX',
  ano: '2007', anoModelo: '2007', chassi: '*****10137', cor: 'Prata',
  extra: {
    ano_modelo: '2007', cilindradas: '1599', combustivel: 'Alcool / Gasolina',
    especie: 'Passageiro', modelo: 'VW/CROSSFOX', municipio: 'SAO LEOPOLDO',
    sub_segmento: 'AU - HATCH PEQUENO', tipo_veiculo: 'Automovel', uf: 'RS'
  },
  fipe: {
    dados: [
      /* de propósito fora de ordem e com score menor primeiro: se o código
         pegar a primeira da lista em vez da de maior score, o teste acusa */
      { ano_modelo: '2010', codigo_fipe: '005999-9', score: 40,
        texto_modelo: 'CROSSFOX 1.6 OUTRA VERSAO', texto_valor: 'R$ 99.999,00',
        combustivel: 'Gasolina', texto_marca: 'VW - VolksWagen' },
      { ano_modelo: '2007', codigo_fipe: '005225-6', score: 101,
        texto_modelo: 'CROSSFOX 1.6 Mi Total Flex 8V 5p', texto_valor: 'R$ 28.799,00',
        combustivel: 'Gasolina', texto_marca: 'VW - VolksWagen' }
    ]
  },
  logo: 'https://apiplacas.com.br/logos/logosMarcas/vw.png',
  marca: 'VW', marcaModelo: 'VW/CROSSFOX', mensagemRetorno: 'Sem erros.',
  modelo: 'CROSSFOX', placa: 'INT8C36'
};

const NAO_ACHOU = { mensagemRetorno: 'Placa nao encontrada na base.', placa: 'ZZZ9Z99' };

/* O que chega no servidor falso, para conferir COMO foi chamado. */
let ultima = null;

const falso = http.createServer((req, res) => {
  const pedacos = [];
  req.on('data', d => pedacos.push(d));
  req.on('end', () => {
    ultima = {
      metodo: req.method,
      url: req.url,
      cabecalhos: req.headers,
      corpo: pedacos.length ? Buffer.concat(pedacos).toString() : null
    };
    res.setHeader('content-type', 'application/json');
    if (/ZZZ9Z99/.test(req.url) || /ZZZ9Z99/.test(ultima.corpo || '')) {
      return res.end(JSON.stringify(NAO_ACHOU));
    }
    if (/DEMORA/.test(req.url)) return;               // nunca responde, testa o prazo
    /* no modo POST devolve ANINHADO, como fazem os gateways */
    if (req.method === 'POST')
      return res.end(JSON.stringify({ error: false, response: CROSSFOX }));
    res.end(JSON.stringify(CROSSFOX));
  });
});

(async () => {
  console.log('\n=== leitura da resposta da consulta de placa ===\n');
  await new Promise(r => falso.listen(PORTA_FALSA, r));

  const api = spawn(process.execPath, ['src/servidor.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORTA_API),
      PLACA_API_URL: `http://127.0.0.1:${PORTA_FALSA}/consulta/{placa}/{token}`,
      PLACA_API_TOKEN: 'token-de-teste',
      PLACA_TIMEOUT_MS: '2000'
    },
    stdio: 'ignore'
  });
  await new Promise(r => setTimeout(r, 4000));

  const BASE = `http://127.0.0.1:${PORTA_API}`;
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      usuario: process.env.TESTE_USUARIO || 'raissa',
      senha: process.env.TESTE_SENHA || 'farias2026'
    })
  }).then(r => r.json()).catch(() => ({}));

  if (!ok('login', !!login.token)) return fim(api);
  const h = { authorization: 'Bearer ' + login.token };

  /* uma placa que NÃO está no cadastro, para forçar a ida à API externa */
  const placa = 'INT8C36';
  await require('../src/db').q('DELETE FROM cache_placa WHERE placa = ?', [placa]);

  const r = await fetch(`${BASE}/api/placa/${placa}`, { headers: h }).then(x => x.json());
  const v = r.veiculo || {};

  ok('a consulta externa foi usada',
     (r.passos || []).some(p => p.passo === 'api_placa' && p.achou), r.origem_veiculo);
  ok('marca lida', v.marca === 'VW', v.marca);
  ok('modelo lido', v.modelo === 'CROSSFOX', v.modelo);

  /* o que o cliente pediu: a MOTORIZAÇÃO */
  ok('motorização em cc virou 1.6', v.cilindrada === '1.6', String(v.cilindrada));
  ok('versão específica veio da FIPE, não o modelo curto',
     v.versao === 'CROSSFOX 1.6 Mi Total Flex 8V 5p', v.versao);
  ok('pegou a linha de MAIOR score, não a primeira',
     v.fipe_codigo === '005225-6', v.fipe_codigo);
  ok('valor da FIPE lido como número', v.fipe_valor === 28799, String(v.fipe_valor));
  ok('combustível normalizado para flex', v.combustivel === 'flex', v.combustivel);
  ok('logo da montadora veio', /vw\.png$/.test(v.logo_marca || ''), v.logo_marca);
  ok('ano lido', v.ano === 2007, String(v.ano));

  /* a motorização tem que melhorar a sugestão de filtro */
  ok('com a motorização, o catálogo sugere filtro',
     (r.filtros?.itens || []).length > 0,
     `${r.filtros?.status} · ${r.filtros?.confianca ?? '—'}%`);

  /* segunda consulta: tem que sair do cache, sem rede */
  const r2 = await fetch(`${BASE}/api/placa/${placa}`, { headers: h }).then(x => x.json());
  ok('a segunda consulta sai do cache (não gasta consulta paga)',
     (r2.passos || []).some(p => p.passo === 'cache_placa' && p.achou),
     r2.origem_veiculo);
  ok('o cache devolve a mesma motorização',
     r2.veiculo?.versao === v.versao && r2.veiculo?.cilindrada === '1.6');

  /* Placa que o serviço não acha. Antes isto era 404; agora é 200 com
     precisa_modelo, e a mudança é de propósito: carro que nunca veio na
     oficina não é falha do sistema, é o começo de um atendimento. Quem
     recebe 404 pinta a tela de vermelho; o que o balcão precisa ver aqui é
     um campo pedindo o modelo. */
  const r3 = await fetch(`${BASE}/api/placa/ZZZ9Z99`, { headers: h });
  const j3 = await r3.json();
  ok('placa desconhecida não é tratada como erro', r3.status === 200, `veio ${r3.status}`);
  ok('a resposta pede o modelo', j3.precisa_modelo === true && j3.encontrado === false);
  ok('e já vem com os modelos mais comuns da oficina',
     Array.isArray(j3.modelos_comuns) && j3.modelos_comuns.length > 0,
     `${(j3.modelos_comuns || []).length} modelos`);

  ok('a chamada saiu como GET', ultima?.metodo === 'GET', ultima?.metodo);
  ok('o token foi para a URL', /token-de-teste/.test(ultima?.url || ''));

  api.kill();
  await new Promise(r => setTimeout(r, 600));

  /* ---------- o outro formato: POST com token em cabeçalho ----------
     É assim que gateways como a APIBrasil chamam. Sem isto, trocar de
     fornecedor exigiria mexer no código. */
  console.log('\n  --- mesmo teste, chamando por POST com cabeçalho ---');
  const api2 = spawn(process.execPath, ['src/servidor.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORTA_API),
      PLACA_API_URL: `http://127.0.0.1:${PORTA_FALSA}/api/v2/vehicles/dados`,
      PLACA_API_TOKEN: 'bearer-de-teste',
      PLACA_API_METODO: 'POST',
      PLACA_API_CABECALHOS: '{"DeviceToken":"disp-123","Authorization":"Bearer {token}"}',
      PLACA_API_CORPO: '{"placa":"{placa}"}',
      PLACA_TIMEOUT_MS: '2000'
    },
    stdio: 'ignore'
  });
  await new Promise(r => setTimeout(r, 4000));

  const login2 = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      usuario: process.env.TESTE_USUARIO || 'raissa',
      senha: process.env.TESTE_SENHA || 'farias2026'
    })
  }).then(r => r.json()).catch(() => ({}));
  const h2 = { authorization: 'Bearer ' + login2.token };

  await require('../src/db').q('DELETE FROM cache_placa WHERE placa = ?', [placa]);
  const rp = await fetch(`${BASE}/api/placa/${placa}`, { headers: h2 }).then(x => x.json());

  ok('a chamada saiu como POST', ultima?.metodo === 'POST', ultima?.metodo);
  ok('o cabeçalho de dispositivo foi enviado',
     ultima?.cabecalhos?.devicetoken === 'disp-123', ultima?.cabecalhos?.devicetoken);
  ok('o token entrou no Authorization',
     /Bearer bearer-de-teste/.test(ultima?.cabecalhos?.authorization || ''),
     ultima?.cabecalhos?.authorization);
  ok('a placa foi no corpo', /INT8C36/.test(ultima?.corpo || ''), ultima?.corpo);
  ok('leu a resposta ANINHADA em "response"',
     rp.veiculo?.versao === 'CROSSFOX 1.6 Mi Total Flex 8V 5p', rp.veiculo?.versao);
  ok('motorização lida no formato POST', rp.veiculo?.cilindrada === '1.6',
     String(rp.veiculo?.cilindrada));

  fim(api2);
})().catch(e => { console.error('erro:', e.message); process.exit(1); });

function fim(api) {
  api.kill();
  falso.close();
  console.log(`\n${passou} passaram · ${falhou} falharam\n`);
  setTimeout(() => process.exit(falhou ? 1 : 0), 200);
}
