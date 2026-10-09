/* Percorre o fluxo inteiro do balcão, como o atendente faria.
   node scripts/teste-fluxo.js */
'use strict';
const BASE = process.argv[2] || 'http://localhost:3001';
let passou = 0, falhou = 0, T = null;

const ok = (nome, cond, det='') => {
  cond ? passou++ : falhou++;
  console.log(`  ${cond ? 'ok   ' : 'FALHA'} ${nome}${det ? ' · ' + det : ''}`);
  return cond;
};

async function req(caminho, opcoes = {}) {
  const res = await fetch(BASE + caminho, {
    ...opcoes,
    headers: { 'content-type': 'application/json',
               ...(T ? { authorization: 'Bearer ' + T } : {}), ...(opcoes.headers || {}) }
  });
  let corpo = null; try { corpo = await res.json(); } catch {}
  return { status: res.status, corpo };
}

(async () => {
  console.log('\n=== fluxo do balcão ===\n');

  const login = await req('/api/auth/login', { method:'POST',
    body: JSON.stringify({ usuario:'raissa', senha:'farissa2026' }) });
  const login2 = await req('/api/auth/login', { method:'POST',
    body: JSON.stringify({ usuario:'raissa', senha:'farias2026' }) });
  T = login2.corpo?.token;
  if (!ok('login', !!T)) return fim();

  const placa = 'TST' + Math.floor(Math.random()*9) + 'X' + String(Math.floor(Math.random()*90)+10);

  /* 1. cliente novo com veículo, como acontece no balcão */
  const novo = await req('/api/clientes', { method:'POST', body: JSON.stringify({
    nome: 'Cliente de Teste', telefone: '55999887766', nascimento: '1985-03-14',
    veiculo: { placa, marca:'VW', modelo:'Gol', cilindrada:'1.6', ano:2015,
               filtro_oleo:'PSL560', filtro_ar:'ARL8720' }
  })});
  ok('cria cliente + veículo de uma vez', novo.status === 201, `status ${novo.status}`);
  const cliId = novo.corpo?.cliente?.id, veicId = novo.corpo?.veiculo?.id;
  ok('devolve os dois ids', !!cliId && !!veicId);

  /* 2. campos sensíveis vindos do cliente são ignorados */
  const hack = await req('/api/clientes', { method:'POST', body: JSON.stringify({
    nome:'Tentativa', id: 99999, criado_em:'1900-01-01', tel_inferido: 1 })});
  ok('ignora id e campos que o cliente não controla',
     hack.status === 201 && hack.corpo.cliente.id !== 99999);

  /* 3. validação */
  const semNome = await req('/api/clientes', { method:'POST', body: JSON.stringify({ telefone:'55999887766' })});
  ok('exige o nome', semNome.status === 400, semNome.corpo?.erro);
  const telRuim = await req('/api/clientes', { method:'POST', body: JSON.stringify({ nome:'Fulano Teste', telefone:'123' })});
  ok('recusa telefone sem DDD', telRuim.status === 400, telRuim.corpo?.erro);
  const nascFuturo = await req('/api/clientes', { method:'POST',
    body: JSON.stringify({ nome:'Fulano Teste', telefone:'5555999887766', nascimento:'2099-01-01' })});
  ok('recusa nascimento no futuro', nascFuturo.status === 400);

  /* 4. placa duplicada */
  const dup = await req('/api/veiculos', { method:'POST', body: JSON.stringify({
    cliente_id: cliId, placa, marca:'VW', modelo:'Gol' })});
  ok('recusa placa duplicada com 409', dup.status === 409, dup.corpo?.erro);

  const placaRuim = await req('/api/veiculos', { method:'POST', body: JSON.stringify({
    cliente_id: cliId, placa:'XX', modelo:'Gol' })});
  ok('recusa placa mal formada', placaRuim.status === 400);

  /* 5. a subseção de filtros */
  const filtros = await req(`/api/veiculos/${veicId}/filtros`, { method:'PUT',
    body: JSON.stringify({ filtro_cabine:'ACP940' })});
  ok('grava filtro de cabine', filtros.status === 200 &&
     filtros.corpo.veiculo.filtro_cabine === 'ACP940');
  ok('registra quem confirmou', filtros.corpo?.veiculo?.filtros_por === 'raissa',
     filtros.corpo?.veiculo?.filtros_por);
  ok('mantém os filtros já cadastrados', filtros.corpo?.veiculo?.filtro_oleo === 'PSL560');

  /* 6. consulta por placa: agora o carro é da casa */
  const cons = await req(`/api/placa/${placa}`);
  ok('consulta por placa acha o cadastro', cons.status === 200 && cons.corpo.encontrado);
  ok('traz os filtros cadastrados', cons.corpo?.filtros?.status === 'cadastrado',
     `óleo ${cons.corpo?.filtros?.oleo}, ar ${cons.corpo?.filtros?.ar}, cabine ${cons.corpo?.filtros?.cabine}`);
  ok('sugere óleo pelo catálogo', !!cons.corpo?.oleo?.viscosidades,
     `${cons.corpo?.oleo?.viscosidades} · ${cons.corpo?.oleo?.confianca}% · ${cons.corpo?.oleo?.origem}`);

  /* 7. registra a ordem */
  const ordem = await req('/api/servicos', { method:'POST', body: JSON.stringify({
    placa, km: 96500, oleo:'5W40 MOB', litros: 4, total: 298,
    filtro_oleo:'PSL560', usuario_id: 999 })});
  ok('registra a ordem', ordem.status === 201, `status ${ordem.status}`);

  /* 8. o resumo do veículo avançou */
  const depois = await req(`/api/placa/${placa}`);
  ok('resumo do veículo foi atualizado',
     depois.corpo?.cadastro?.ultimo_km === 96500 && depois.corpo?.cadastro?.visitas === 1,
     `km ${depois.corpo?.cadastro?.ultimo_km}, visitas ${depois.corpo?.cadastro?.visitas}`);
  ok('situação virou "em dia"', depois.corpo?.cadastro?.situacao === 'em_dia');
  ok('óleo agora vem do histórico', depois.corpo?.oleo?.status === 'historico',
     depois.corpo?.oleo?.origem);

  /* 9. edição */
  const edit = await req(`/api/clientes/${cliId}`, { method:'PATCH',
    body: JSON.stringify({ telefone:'5555988776655', papel:'admin' })});
  ok('edita telefone e limpa o "inferido"',
     edit.status === 200 && edit.corpo.cliente.tel_inferido === 0);

  /* 10. exclusão pede confirmação */
  const semConf = await req(`/api/clientes/${cliId}`, { method:'DELETE' });
  ok('exclusão sem confirmar devolve 409', semConf.status === 409, semConf.corpo?.detalhe);
  const comConf = await req(`/api/clientes/${cliId}?confirmar=1`, { method:'DELETE' });
  ok('exclusão confirmada funciona', comConf.status === 200,
     JSON.stringify(comConf.corpo?.removido));
  /* A consulta de placa não devolve mais 404 para placa desconhecida — devolve
     200 pedindo o modelo, porque carro novo na oficina não é erro. Então a
     prova da cascata passou a ser o CONTEÚDO: nem cadastro, nem histórico. */
  const sumiu = await req(`/api/placa/${placa}`);
  ok('veículo saiu junto (cascata)',
     sumiu.corpo?.encontrado === false && !sumiu.corpo?.cadastro,
     `${sumiu.status} · encontrado=${sumiu.corpo?.encontrado}`);
  ok('e a tela é convidada a pedir o modelo, não a mostrar erro',
     sumiu.status === 200 && sumiu.corpo?.precisa_modelo === true, `${sumiu.status}`);

  /* 11. fila de trabalho dos filtros */
  const pend = await req('/api/veiculos/pendencias/sem-filtro?limite=5');
  ok('lista veículos sem filtro cadastrado', pend.status === 200 && pend.corpo.total > 0,
     `${pend.corpo?.total} carros ativos sem filtro`);

  /* limpeza */
  if (hack.corpo?.cliente?.id)
    await req(`/api/clientes/${hack.corpo.cliente.id}?confirmar=1`, { method:'DELETE' });

  fim();
})().catch(e => { console.error('erro:', e.message); process.exit(1); });

function fim() {
  console.log(`\n${passou} passaram · ${falhou} falharam\n`);
  process.exit(falhou ? 1 : 0);
}
