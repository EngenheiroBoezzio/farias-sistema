/* GET /api/placa/:placa — o que o balcão consulta.

   Ordem de resolução, do mais barato ao mais caro:
     1. veículo já cadastrado  -> histórico + filtros do próprio carro  (0 rede)
     2. cache de placa         -> consulta anterior guardada            (0 rede)
     3. API externa            -> 1 chamada, com prazo e guardada       (1 rede)
     4. catálogo de óleo       -> casamento por modelo+motor+ano        (0 rede)

   O sistema SUGERE; quem confirma é o atendente. Toda resposta diz de onde
   veio o dado, para a tela poder mostrar. */
'use strict';
const express = require('express');
const { q, um } = require('../db');
const { rota, erro400 } = require('../meio/erros');
const { exigeLogin } = require('../meio/auth');
const { placaValida, textoAte, inteiro } = require('../meio/validar');
const { sugerirFiltros, itensConfirmados, TIPOS } = require('../meio/wega');
const casa = require('../meio/casa');

const r = express.Router();
r.use(exigeLogin);

const API_URL = process.env.PLACA_API_URL || '';
const API_TOKEN = process.env.PLACA_API_TOKEN || '';
const API_TIMEOUT = +(process.env.PLACA_TIMEOUT_MS || 8000);
/* Cada fornecedor chama de um jeito: uns usam GET com o token na URL, outros
   POST com o token em cabeçalho. Em vez de amarrar a um, o formato vem do
   .env — trocar de fornecedor não exige mexer no código. */
const API_METODO = (process.env.PLACA_API_METODO || 'GET').toUpperCase();
const API_CABECALHOS = process.env.PLACA_API_CABECALHOS || '';
const API_CORPO = process.env.PLACA_API_CORPO || '';
const LIMIAR = +(process.env.OLEO_LIMIAR || 45);   // abaixo disso não sugere

/* ---------- utilidades ---------- */
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** 1599 cc -> "1.6" · aceita "1.6" direto */
function cilindrada(v) {
  if (v == null) return null;
  const s = String(v).replace(',', '.');
  const dec = s.match(/\b([0-9])\.([0-9])\b/);
  if (dec) return `${dec[1]}.${dec[2]}`;
  const cc = parseInt(s.replace(/\D/g, ''), 10);
  if (!cc || cc < 600 || cc > 8000) return null;
  return (Math.round(cc / 100) / 10).toFixed(1);
}

const util = t => t.length >= 3 || /^(KA|UP|HR|T4|C3|C4|I30|XC|CR|RX|GT)$/.test(t);

/** Pontua uma entrada do catálogo contra o veículo. */
function pontuar(entrada, alvo) {
  const tCat = norm(entrada.modelo).split(' ').filter(util);
  const tCar = norm(alvo.modelo).split(' ').filter(util);
  if (!tCat.length || !tCar.length) return { p: 0 };

  const comuns = tCat.filter(t => tCar.includes(t));
  if (!comuns.length) return { p: 0 };

  let p = 40 * (comuns.length / Math.max(tCat.length, tCar.length));
  const razoes = [`modelo "${comuns.join(' ')}"`];

  if (alvo.cil && entrada.cilindrada) {
    if (alvo.cil === entrada.cilindrada) { p += 35; razoes.push(`motor ${alvo.cil}`); }
    else return { p: 0 };                     // motor diferente invalida
  }

  const ano = parseInt(alvo.ano, 10);
  if (ano && entrada.ano_ini && entrada.ano_fim) {
    if (ano >= entrada.ano_ini && ano <= entrada.ano_fim) {
      p += 25; razoes.push(`ano ${entrada.ano_ini}–${entrada.ano_fim}`);
    } else p -= 20;
  } else if (entrada.fonte === 'atria') {
    p += 5;
  } else if (ano && ano >= 2010) {
    p -= 25; razoes.push('fonte sem faixa de ano');   // Petronas em carro recente
  }

  return { p: Math.max(0, Math.min(100, Math.round(p))), razoes };
}

/** Consulta o catálogo no banco e devolve a melhor sugestão. */
async function sugerirOleo({ modelo, cil, ano }, usoDaCasa) {
  if (!modelo) return { status: 'sem_modelo' };

  // pré-filtra pelo primeiro token do modelo: não varre a tabela inteira
  const token = norm(modelo).split(' ').filter(util)[0] || '';
  const candidatos = await q(
    `SELECT fonte, marca, modelo, motor, cilindrada, ano_ini, ano_fim, litros, viscosidades
     FROM catalogo_oleo WHERE modelo LIKE ? LIMIT 200`, [`%${token}%`]);

  const notas = candidatos
    .map(e => ({ e, ...pontuar(e, { modelo, cil, ano }) }))
    .filter(x => x.p > 0)
    .sort((a, b) => b.p - a.p);

  if (!notas.length) return { status: 'sem_catalogo' };

  const top = notas[0];
  if (top.p < LIMIAR)
    return { status: 'precisa_confirmar', confianca: top.p,
             palpite: top.e.viscosidades.split(','), origem: rotulo(top.e) };

  let viscos = [...new Set(notas.filter(n => n.p >= top.p - 5)
    .flatMap(n => n.e.viscosidades.split(',')))];

  // quando há empate, a que a oficina mais usa vem primeiro
  let preferida = null;
  if (viscos.length > 1 && usoDaCasa) {
    const ord = viscos.slice().sort((a, b) => (usoDaCasa[b] || 0) - (usoDaCasa[a] || 0));
    if (usoDaCasa[ord[0]]) { preferida = ord[0]; viscos = ord; }
  }

  return {
    status: viscos.length === 1 ? 'ok' : 'ambiguo',
    viscosidades: viscos,
    preferida,
    litros: top.e.litros ? Number(top.e.litros) : null,
    confianca: top.p,
    origem: rotulo(top.e),
    porque: (top.razoes || []).join(', ')
  };
}

const rotulo = e =>
  `${e.fonte === 'atria' ? 'Atria/Havoline' : 'Petronas'} · ` +
  `${e.modelo}${e.motor ? ' ' + e.motor : ''}` +
  (e.ano_ini ? ` (${e.ano_ini}–${e.ano_fim})` : '');

/** O que a oficina realmente usa, por viscosidade. Usado no desempate. */
async function usoDaCasa() {
  const linhas = await q(
    `SELECT oleo, COUNT(*) n FROM servicos
     WHERE oleo IS NOT NULL AND oleo <> '' GROUP BY oleo ORDER BY n DESC LIMIT 40`);
  const mapa = {};
  for (const l of linhas) {
    const m = String(l.oleo).match(/(\d{1,2}W)[- ]?(\d{2})/);
    if (m) { const k = `${m[1]}-${m[2]}`; mapa[k] = (mapa[k] || 0) + l.n; }
  }
  return mapa;
}

/** Chamada à API externa, com prazo. Nunca deixa a rota pendurada. */
/* "Alcool / Gasolina" -> "flex". O catálogo Wega usa esses três rótulos, e
   sem normalizar a comparação de combustível nunca casa. */
function normCombustivel(v) {
  const t = String(v || '').toLowerCase();
  if (/[áa]lcool|etanol/.test(t) && /gasolina/.test(t)) return 'flex';
  if (/flex/.test(t)) return 'flex';
  if (/diesel/.test(t)) return 'diesel';
  if (/gasolina/.test(t)) return 'gasolina';
  if (/[áa]lcool|etanol/.test(t)) return 'alcool';
  return null;
}

/* O bloco `fipe` vem com VÁRIAS linhas candidatas, cada uma com um `score`.
   A própria documentação do serviço manda usar a de maior score — e é essa
   que traz o modelo específico ("CROSSFOX 1.6 Mi Total Flex 8V 5p"), que é o
   que identifica a motorização. Pegar a primeira da lista dá modelo errado
   em carro com mais de uma versão. */
function melhorFipe(j, ano) {
  const lista = j?.fipe?.dados;
  if (!Array.isArray(lista) || !lista.length) return null;
  const candidatos = lista.slice();
  // entre scores iguais, prefere a linha do mesmo ano do carro
  candidatos.sort((a, b) => {
    const s = (+b.score || 0) - (+a.score || 0);
    if (s) return s;
    const da = Math.abs((+a.ano_modelo || 0) - (ano || 0));
    const db = Math.abs((+b.ano_modelo || 0) - (ano || 0));
    return da - db;
  });
  return candidatos[0];
}

const valorFipe = t => {
  const n = parseFloat(String(t || '').replace(/[^\d,]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** Troca {placa} e {token} em qualquer texto de configuração. */
const preencher = (txt, placa) => String(txt || '')
  .replace(/\{placa\}/g, placa)
  .replace(/\{token\}/g, API_TOKEN);

function montarChamada(placa) {
  const url = API_URL
    .replace(/\{placa\}/g, encodeURIComponent(placa))
    .replace(/\{token\}/g, encodeURIComponent(API_TOKEN));

  const opcoes = { method: API_METODO, signal: AbortSignal.timeout(API_TIMEOUT) };

  if (API_CABECALHOS) {
    try {
      opcoes.headers = JSON.parse(preencher(API_CABECALHOS, placa));
    } catch {
      throw new Error('PLACA_API_CABECALHOS não é um JSON válido. Confira o .env.');
    }
  }

  if (API_METODO !== 'GET' && API_METODO !== 'HEAD') {
    const corpo = API_CORPO || '{"placa":"{placa}"}';
    try {
      JSON.parse(preencher(corpo, placa));          // valida antes de enviar
    } catch {
      throw new Error('PLACA_API_CORPO não é um JSON válido. Confira o .env.');
    }
    opcoes.body = preencher(corpo, placa);
    opcoes.headers = { 'content-type': 'application/json', ...(opcoes.headers || {}) };
  }

  return { url, opcoes };
}

/* Fornecedores diferentes aninham a resposta em lugares diferentes
   (`response`, `data`, `dados`, `retorno`). Desembrulha até achar algo com
   cara de veículo, em vez de exigir um formato só. */
function desembrulhar(j) {
  let atual = j;
  for (let i = 0; i < 4; i++) {
    if (!atual || typeof atual !== 'object') break;
    const temVeiculo = atual.MODELO || atual.modelo || atual.extra || atual.fipe ||
                       atual.marca || atual.MARCA;
    if (temVeiculo) return atual;
    const dentro = atual.response ?? atual.data ?? atual.dados ?? atual.retorno ?? atual.result;
    if (!dentro) break;
    atual = dentro;
  }
  return j;
}

async function consultarApi(placa) {
  if (!API_URL) return null;
  const { url, opcoes } = montarChamada(placa);
  const res = await fetch(url, opcoes);
  if (!res.ok) throw new Error(`a consulta de placa respondeu ${res.status}`);
  const j = desembrulhar(await res.json());

  // o serviço responde 200 mesmo quando não achou; o aviso vem no corpo
  if (j?.mensagemRetorno && !/sem erros/i.test(j.mensagemRetorno) && !j.MODELO && !j.modelo)
    throw new Error(String(j.mensagemRetorno).slice(0, 120));

  const e = j.extra || {};
  const ano = parseInt(j.anoModelo || e.ano_modelo || j.ano, 10) || null;
  const f = melhorFipe(j, ano);

  return {
    marca: j.MARCA || j.marca || f?.texto_marca || null,
    modelo: j.MODELO || j.modelo || null,
    /* a versão específica vem da FIPE e é a que tem a motorização escrita;
       o SUBMODELO do Denatran costuma repetir o modelo curto */
    versao: f?.texto_modelo || j.VERSAO || j.SUBMODELO || j.versao || null,
    cor: j.cor || j.COR || null,
    ano,
    cilindrada: cilindrada(e.cilindradas || j.cilindradas),
    combustivel: normCombustivel(e.combustivel || f?.combustivel),
    carroceria: e.carroceria || e.sub_segmento || null,
    fipe_codigo: f?.codigo_fipe || null,
    fipe_modelo: f?.texto_modelo || null,
    fipe_valor: valorFipe(f?.texto_valor),
    fipe_score: f?.score != null ? +f.score : null,
    logo_marca: j.logo || null,
    bruto: j
  };
}


/* ---------- o miolo: dado um carro, o que vai nele ----------
   Vale para os dois caminhos — placa consultada e modelo digitado à mão.
   Nenhum dos dois faz rede aqui: é catálogo local mais o histórico da casa. */
async function oQueVaiNele({ dados, veic, passos }) {
  /* óleo: o histórico deste carro vale mais que o catálogo; depois o que a
     casa usa neste modelo; e só então o catálogo genérico */
  const t3 = Date.now();
  let oleo;
  if (veic && veic.ultimo_oleo) {
    let litros = null;
    const [ultServ] = await q(
      'SELECT litros FROM servicos WHERE veiculo_id = ? AND litros > 0 ORDER BY data DESC, id DESC LIMIT 1',
      [veic.id]
    );
    if (ultServ && ultServ.litros) {
      litros = Number(ultServ.litros);
    } else {
      const sug = await sugerirOleo(
        { modelo: dados.modelo, cil: cilindrada(dados.cilindrada), ano: dados.ano },
        null
      );
      if (sug && sug.litros) litros = sug.litros;
    }

    oleo = {
      status: 'historico',
      viscosidades: [veic.ultimo_oleo],
      litros,
      confianca: 100,
      origem: `histórico da oficina · última troca em ` +
              `${new Date(veic.ultima_troca).toLocaleDateString('pt-BR')}`,
      porque: 'foi o óleo que a própria Farias usou neste carro'
    };
  } else {
    oleo = await sugerirOleo(
      { modelo: dados.modelo, cil: cilindrada(dados.cilindrada), ano: dados.ano },
      await usoDaCasa());
  }
  passos.push({ passo: 'catalogo_oleo', achou: !!oleo.viscosidades, ms: Date.now() - t3 });

  /* filtros: o que a loja confirmou neste carro vale mais que o catálogo.
     Sem confirmação, sugere pela Wega — todos os tipos, cada um rotulado. */
  const t4 = Date.now();
  const confirmados = veic ? itensConfirmados(veic) : [];
  let filtros;

  if (confirmados.length) {
    filtros = {
      status: 'cadastrado',
      itens: confirmados,
      confirmado_por: veic.filtros_por,
      confirmado_em: veic.filtros_em
    };
    const faltam = TIPOS.map(t => t[0]).filter(t => !confirmados.some(i => i.tipo === t));
    if (faltam.length) {
      const s = await sugerirFiltros({
        marca: dados.marca, modelo: dados.modelo, ano: dados.ano,
        combustivel: dados.combustivel
      });
      const extra = (s.itens || []).filter(i => faltam.includes(i.tipo));
      if (extra.length) {
        filtros.sugeridos = extra;
        filtros.origem_sugestao = s.origem;
        filtros.confianca_sugestao = s.confianca;
      }
    }
  } else {
    const s = await sugerirFiltros({
      marca: dados.marca, modelo: dados.modelo, ano: dados.ano,
      combustivel: dados.combustivel
    });
    filtros = s.itens.length
      ? { ...s, acao: 'Confira e confirme: uma vez confirmado, nas próximas trocas já vem pronto.' }
      : { status: s.status, itens: [],
          acao: 'Sem correspondência no catálogo Wega. Preencha à mão uma vez.' };
  }
  passos.push({ passo: 'catalogo_wega', achou: !!(filtros.itens || []).length, ms: Date.now() - t4 });

  /* O que a casa já pôs em carros iguais. Não substitui o catálogo: entra ao
     lado dele. Quando os dois concordam, o atendente confirma sem pensar;
     quando discordam, ele vê os dois e decide — que é como tem que ser, já
     que peça errada vai parar no motor de um cliente. */
  const t5 = Date.now();
  const [oleoCasa, filtrosCasa] = await Promise.all([
    casa.oleoDoModelo(dados.modelo, dados.ano),
    casa.filtrosDoModelo(dados.modelo, dados.ano)
  ]);
  passos.push({ passo: 'historico_do_modelo', achou: !!(oleoCasa || filtrosCasa),
                ms: Date.now() - t5 });

  if (oleoCasa) oleo.na_casa = oleoCasa;
  if (filtrosCasa) filtros.na_casa = filtrosCasa;

  /* ---- uma única linha de resposta, que é o que a tela mostra grande ----
     O balcão tem um cliente na frente e não vai comparar dois blocos de JSON.
     Então o servidor escolhe UMA recomendação e diz de onde ela saiu; o resto
     continua na resposta, aberto, para quem quiser conferir. A ordem é por
     quem erra menos: este carro > carros iguais desta oficina > catálogo. */
  const doCatalogo = oleo.viscosidades || oleo.palpite || null;
  const viscCasa = oleoCasa && oleoCasa.viscosidade;

  if (oleo.status === 'historico') {
    oleo.recomendado = {
      texto: oleo.viscosidades[0], fonte: 'este carro', confianca: 100,
      porque: 'foi o óleo que a Farias já pôs nesta placa'
    };
  } else if (viscCasa && oleoCasa.confianca >= (oleo.confianca || 0)) {
    oleo.recomendado = {
      texto: viscCasa,
      marca_usual: oleoCasa.marca_usual,
      fonte: 'histórico da oficina',
      confianca: oleoCasa.confianca,
      porque: `${oleoCasa.itens[0].vezes} de ${oleoCasa.total} trocas em ` +
              `${oleoCasa.carros} ${dados.modelo}` +
              (oleoCasa.janela ? ` de ${dados.ano - oleoCasa.janela} a ${dados.ano + oleoCasa.janela}` : '')
    };
  } else if (doCatalogo && doCatalogo.length) {
    oleo.recomendado = {
      texto: oleo.preferida || doCatalogo[0],
      fonte: 'catálogo', confianca: oleo.confianca || null,
      porque: oleo.origem || null
    };
  } else {
    oleo.recomendado = null;
  }

  /* Rótulo de força, para a tela não ter que decidir o que é pouco.
     15% não é "a oficina usa 15W-40": é "três carros levaram e não dá para
     tirar regra disso". A tela mostra fraco em cinza, forte em destaque. */
  if (oleo.recomendado) {
    const c = oleo.recomendado.confianca || 0;
    oleo.recomendado.forca = c >= 70 ? 'alta' : c >= 40 ? 'media' : 'baixa';
  }

  /* Catálogo e casa dizem a mesma viscosidade? Dizer isso em voz alta é o que
     deixa o atendente confirmar sem hesitar — e, quando NÃO dizem, é o que o
     faz parar e olhar, que é exatamente quando tem que parar. */
  if (viscCasa && doCatalogo && doCatalogo.length) {
    const chave = t => String(t).replace(/[^0-9Ww]/g, '').toUpperCase();
    oleo.confere_com_a_casa = doCatalogo.some(v => chave(v) === chave(viscCasa));
    if (!oleo.confere_com_a_casa)
      oleo.divergencia = `O catálogo indica ${doCatalogo.join(' ou ')} e a oficina ` +
        `vem usando ${viscCasa} neste modelo. Confira antes de fechar.`;
  }

  if (filtrosCasa && (filtros.itens || []).length) {
    const chave = c => String(c).replace(/\W/g, '').toUpperCase();
    const doCat = new Map(filtros.itens.map(i => [i.tipo, i.codigo]));
    const comuns = filtrosCasa.itens.filter(i => doCat.has(i.tipo));
    const diferentes = comuns.filter(i => chave(doCat.get(i.tipo)) !== chave(i.codigo));
    filtros.confere_com_a_casa = comuns.length > 0 && diferentes.length === 0;
    if (diferentes.length)
      filtros.divergencia = diferentes.map(i =>
        `${i.rotulo}: catálogo ${doCat.get(i.tipo)}, oficina ${i.codigo} ` +
        `(${i.vezes}x)`).join(' · ');
  }

  return { oleo, filtros };
}

/* ---------- as rotas ----------
   /modelos e /por-modelo vêm ANTES de /:placa: o Express casa na ordem, e
   sem isto "por-modelo" seria lido como uma placa. */

/** GET /api/placa/modelos?busca=spacef — para o campo de digitar o modelo. */
r.get('/modelos', rota(async (req, res) => {
  const busca = String(req.query.busca || '').slice(0, 40);
  if (!busca.trim())
    return res.json({ busca: '', modelos: await casa.modelosMaisComuns(12),
                      dica: 'Os que mais entram na oficina.' });
  const modelos = await casa.buscarModelos(busca, 20);
  res.json({ busca, modelos });
}));

/** GET /api/placa/por-modelo?modelo=Gol&ano=2015&cilindrada=1.0
 *
 *  O caminho sem placa: o atendente digita o modelo e a tela responde óleo e
 *  filtros. É a saída para o carro que não está no cadastro — e, como não
 *  consulta ninguém de fora, não custa nada e funciona sem internet. */
r.get('/por-modelo', rota(async (req, res) => {
  const t0 = Date.now();
  const passos = [];

  const modelo = textoAte(req.query.modelo, 'modelo', 80);
  if (!modelo) throw erro400('Informe o modelo do carro.');

  const ano = req.query.ano ? inteiro(req.query.ano, 'ano', { min: 1950, max: 2100 }) : null;
  const cil = cilindrada(req.query.cilindrada);
  const marca = textoAte(req.query.marca, 'marca', 40);
  const combustivel = normCombustivel(req.query.combustivel);

  const dados = { marca, modelo, versao: null, cilindrada: cil, ano, combustivel,
                  cor: null, carroceria: null };

  const { oleo, filtros } = await oQueVaiNele({ dados, veic: null, passos });

  /* Se nem o catálogo nem a casa souberam, não devolve uma tela vazia:
     devolve o que mais se parece com o que foi digitado, para o atendente
     escolher de novo. Errar o nome do modelo é o erro mais comum aqui. */
  let parecidos = null;
  if (!(filtros.itens || []).length && !oleo.viscosidades)
    parecidos = await casa.buscarModelos(modelo, 8);

  res.json({
    placa: null,
    encontrado: true,
    origem_veiculo: 'modelo informado no balcão',
    veiculo: { marca, modelo, versao: null, cilindrada: cil, ano,
               cor: null, combustivel, carroceria: null,
               fipe_codigo: null, fipe_modelo: null, fipe_valor: null,
               logo_marca: null },
    cadastro: null,
    oleo,
    filtros,
    historico: [],
    parecidos,
    confirmar: true,
    passos,
    ms: Date.now() - t0
  });
}));

/** GET /api/placa/:placa — o que o balcão consulta primeiro. */
r.get('/:placa', rota(async (req, res) => {
  const placa = placaValida(req.params.placa);
  const t0 = Date.now();
  const passos = [];

  /* 1. o carro já é da casa? */
  const veic = await um(
    `SELECT v.id, v.placa, v.marca, v.modelo, v.cilindrada, v.ano, v.situacao,
            v.ultima_troca, v.ultimo_km, v.ultimo_oleo, v.visitas,
            v.filtro_oleo, v.filtro_ar, v.filtro_cabine, v.filtro_combustivel,
            v.filtros_por, v.filtros_em,
            c.id AS cliente_id, c.nome AS cliente, c.telefone, c.aceita_aviso,
            DATEDIFF(CURDATE(), v.ultima_troca) AS dias
     FROM veiculos v JOIN clientes c ON c.id = v.cliente_id
     WHERE v.placa = ?`, [placa]);
  passos.push({ passo: 'veiculo_cadastrado', achou: !!veic, ms: Date.now() - t0 });

  let dados = null, origemVeiculo = null;

  if (veic) {
    dados = { marca: veic.marca, modelo: veic.modelo, cilindrada: veic.cilindrada,
              ano: veic.ano, cor: null, versao: null };
    origemVeiculo = 'cadastro da oficina';
  } else {
    /* 2. cache de consulta anterior */
    const t1 = Date.now();
    const cache = await um('SELECT * FROM cache_placa WHERE placa = ?', [placa]);
    passos.push({ passo: 'cache_placa', achou: !!cache, ms: Date.now() - t1 });

    if (cache) {
      dados = { marca: cache.marca, modelo: cache.modelo, cilindrada: cache.cilindrada,
                ano: cache.ano, cor: null, versao: cache.versao,
                combustivel: cache.combustivel, fipe_codigo: cache.fipe_codigo,
                fipe_modelo: cache.fipe_modelo, fipe_valor: cache.fipe_valor,
                logo_marca: cache.logo_marca };
      origemVeiculo = `consulta guardada em ${new Date(cache.consultado_em).toLocaleDateString('pt-BR')}`;
    } else if (API_URL) {
      /* 3. API externa — uma vez por placa na vida. Opcional: sem
            PLACA_API_URL no .env o sistema inteiro continua funcionando,
            só que passando direto para o passo 4. */
      const t2 = Date.now();
      try {
        const api = await consultarApi(placa);
        passos.push({ passo: 'api_placa', achou: !!api, ms: Date.now() - t2 });
        if (api) {
          dados = api;
          origemVeiculo = 'consulta de placa';
          await q(
            `INSERT INTO cache_placa
               (placa, marca, modelo, versao, cilindrada, ano, combustivel,
                fipe_codigo, fipe_modelo, fipe_valor, fipe_score, logo_marca, bruto)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE marca=VALUES(marca), modelo=VALUES(modelo),
               versao=VALUES(versao), cilindrada=VALUES(cilindrada), ano=VALUES(ano),
               combustivel=VALUES(combustivel), fipe_codigo=VALUES(fipe_codigo),
               fipe_modelo=VALUES(fipe_modelo), fipe_valor=VALUES(fipe_valor),
               fipe_score=VALUES(fipe_score), logo_marca=VALUES(logo_marca),
               bruto=VALUES(bruto)`,
            [placa, api.marca, api.modelo, api.versao, api.cilindrada, api.ano,
             api.combustivel, api.fipe_codigo, api.fipe_modelo, api.fipe_valor,
             api.fipe_score, api.logo_marca, JSON.stringify(api.bruto)]);
        }
      } catch (e) {
        passos.push({ passo: 'api_placa', erro: e.message, ms: Date.now() - t2 });
      }
    } else {
      passos.push({ passo: 'api_placa', pulado: 'consulta externa não configurada' });
    }
  }

  /* 4. não achou a placa em lugar nenhum.
     Isto NÃO é erro, é o caminho normal de um carro novo na oficina — por
     isso volta 200 e não 404. Quem recebe 404 mostra tela vermelha de falha;
     o que o balcão precisa ver aqui é um campo pedindo o modelo. */
  if (!dados) {
    /* Só nesta saída, que é rara: saber se a base está vazia muda a mensagem. */
    const [{ n: temCarro }] = await q('SELECT COUNT(*) n FROM veiculos');
    return res.json({
      placa,
      encontrado: false,
      precisa_modelo: true,
      /* Três situações diferentes chegavam aqui com a MESMA frase, e a
         diferença é justamente o que a pessoa precisa saber:
           - base vazia: a planilha nunca foi importada, e é por isso que
             NENHUMA placa responde — não é esta placa que é especial;
           - base cheia e consulta externa desligada: carro novo mesmo;
           - consulta externa ligada e sem resposta: o serviço não achou.
         Dizer só "não está no cadastro" nas três fazia o balcão procurar
         defeito na placa quando o problema era a importação. */
      motivo: temCarro === 0
        ? 'A oficina ainda não tem nenhum carro cadastrado — a planilha de ' +
          'clientes não foi importada. Enquanto isso, nenhuma placa vai responder.'
        : API_URL
          ? 'A placa não está no cadastro e a consulta externa não devolveu este carro.'
          : 'A placa não está no cadastro da oficina, e a consulta externa de ' +
            'placa não está configurada (é opcional).',
      acao: 'Informe o modelo do carro. O sistema diz o óleo e os filtros na hora.',
      caminho: '/api/placa/por-modelo?modelo=',
      modelos_comuns: await casa.modelosMaisComuns(12),
      passos,
      ms: Date.now() - t0
    });
  }

  const { oleo, filtros } = await oQueVaiNele({ dados, veic, passos });

  const historico = veic
    ? await q(`SELECT data, km, oleo, litros, total FROM servicos
               WHERE veiculo_id = ? ORDER BY data DESC LIMIT 10`, [veic.id])
    : [];

  res.json({
    placa,
    encontrado: true,
    origem_veiculo: origemVeiculo,
    veiculo: {
      marca: dados.marca, modelo: dados.modelo, versao: dados.versao,
      cilindrada: cilindrada(dados.cilindrada), ano: dados.ano,
      cor: dados.cor, combustivel: dados.combustivel, carroceria: dados.carroceria,
      fipe_codigo: dados.fipe_codigo || null,
      fipe_modelo: dados.fipe_modelo || null,
      fipe_valor: dados.fipe_valor ?? null,
      logo_marca: dados.logo_marca || null
    },
    cadastro: veic ? {
      id: veic.id, cliente_id: veic.cliente_id, cliente: veic.cliente,
      telefone: veic.telefone, aceita_aviso: !!veic.aceita_aviso,
      visitas: veic.visitas, situacao: veic.situacao, dias: veic.dias,
      ultima_troca: veic.ultima_troca, ultimo_km: veic.ultimo_km
    } : null,
    oleo,
    filtros,
    historico,
    // a tela precisa mostrar isto: o sistema sugere, o atendente confirma
    confirmar: true,
    passos,
    ms: Date.now() - t0
  });
}));

module.exports = r;
