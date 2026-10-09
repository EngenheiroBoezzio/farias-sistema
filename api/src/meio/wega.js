/* Sugestão de filtros a partir do catálogo Wega.

   O catálogo SUGERE; quem confirma é o balcão. Toda sugestão volta com a
   confiança e com a linha do PDF de onde saiu, porque código de filtro errado
   é peça errada no motor do cliente — precisa dar para conferir.

   Devolve todos os tipos de filtro, cada um com o seu rótulo, que é como a
   Farias quer ver: "para o filtro de cabine usa tal, para o de ar usa tal". */
'use strict';
const { q } = require('../db');

const LIMIAR = +(process.env.FILTRO_LIMIAR || 45);

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const util = t => t.length >= 3 || /^(KA|UP|HR|T4|C3|C4|I30|XC|CR|RX|GT)$/.test(t);

/* ordem em que o balcão lê a tela */
const TIPOS = [
  ['oleo',        'f_oleo',        'f_oleo_opc',        'Filtro de óleo'],
  ['ar',          'f_ar',          null,                'Filtro de ar'],
  ['combustivel', 'f_combustivel', 'f_combustivel_opc', 'Filtro de combustível'],
  ['cabine',      'f_cabine',      'f_cabine_carvao',   'Filtro de cabine']
];

/* Ruído que a ficha da Farias carrega e o catálogo não: "8V", "16V", "FLEX",
   "DIESEL" viram coluna própria ou não existem no nome do modelo. */
const RUIDO = /^(8V|16V|12V|20V|4P|2P|FLEX|GASOLINA|ALCOOL|DIESEL|TURBO|AUT|AUTOMATICO|MANUAL|SEDAN|HATCH)$/;

function pontuar(e, alvo) {
  // tCat/tMarca/gCat vêm prontos do carregamento: normalizar 2.500 linhas a
  // cada consulta levou a busca de placa de 1,8ms para 10ms. Medido.
  const tCat = e._tCat;
  let tCar = alvo._tCar;
  if (!tCat.length || !tCar.length) return { p: 0 };

  /* A ficha da Farias costuma trazer a marca dentro do modelo ("FORD KA"),
     enquanto o catálogo separa marca de modelo ("Ford" | "Ka"). Sem tirar a
     marca daqui, "FORD KA" contra "Ka" perdia metade da nota por um token
     que nem era do modelo. */
  const tMarca = e._tMarca;
  const marcaNoModelo = tCar.some(t => tMarca.includes(t));
  if (marcaNoModelo) tCar = tCar.filter(t => !tMarca.includes(t));
  if (!tCar.length) return { p: 0 };          // só a marca não identifica carro

  const comuns = tCat.filter(t => tCar.includes(t));

  /* O balcão escreve grudado ("SPACEFOX") o que o catálogo separa
     ("Space Fox"), e às vezes usa a variante ("HB20S" x "HB20"). Comparar
     também sem espaço recupera esses casos, com nota proporcional. */
  const gCat = e._gCat, gCar = tCar.join('');
  let pGrudado = 0, comoGrudado = null;
  if (gCat === gCar) { pGrudado = 45; comoGrudado = `modelo "${e.modelo}"`; }
  else if (gCat.length >= 4 && gCar.length >= 4 &&
           (gCat.includes(gCar) || gCar.includes(gCat))) {
    const men = Math.min(gCat.length, gCar.length), mai = Math.max(gCat.length, gCar.length);
    pGrudado = 45 * (men / mai);
    comoGrudado = `modelo "${e.modelo}" (variante de "${alvo.modelo}")`;
  }

  const pTokens = comuns.length ? 45 * (comuns.length / Math.max(tCat.length, tCar.length)) : 0;
  if (!pTokens && !pGrudado) return { p: 0 };

  let p = Math.max(pTokens, pGrudado);
  const razoes = [pGrudado > pTokens ? comoGrudado : `modelo "${comuns.join(' ')}"`];

  if (marcaNoModelo ||
      (alvo.marca && e.marca && norm(e.marca).includes(norm(alvo.marca).split(' ')[0]))) {
    p += 10; razoes.push(`marca ${e.marca}`);
  }

  const ano = parseInt(alvo.ano, 10);
  if (ano && e.ano_ini) {
    const fim = e.ano_fim || 2100;               // "-->" = em diante
    if (ano >= e.ano_ini && ano <= fim) {
      p += 30;
      razoes.push(`ano ${e.ano_ini}${e.ano_fim ? '–' + e.ano_fim : ' em diante'}`);
    } else {
      p -= 25;                                   // fora da faixa derruba, não zera
    }
  }

  if (alvo.combustivel && e.combustivel_txt) {
    if (alvo.combustivel === e.combustivel_txt) { p += 15; razoes.push(e.combustivel_txt); }
    else p -= 15;
  }

  return { p: Math.max(0, Math.min(100, Math.round(p))), razoes };
}

/** Monta a lista de filtros de uma linha do catálogo, já rotulada. */
function itensDe(e) {
  const itens = [];
  for (const [tipo, campo, campoOpc, rotulo] of TIPOS) {
    const codigo = e[campo];
    const alternativo = campoOpc ? e[campoOpc] : null;
    if (!codigo && !alternativo) continue;
    itens.push({
      tipo, rotulo,
      codigo: codigo || alternativo,
      alternativo: codigo && alternativo ? alternativo : null,
      // a coluna "com carvão" é uma opção melhor, não um substituto qualquer
      nota: tipo === 'cabine' && codigo && alternativo
        ? 'O segundo código é a versão com carvão ativado.' : null
    });
  }
  return itens;
}

const rotuloFonte = e =>
  `Wega · ${e.marca} ${e.modelo}` +
  (e.versao ? ` ${e.versao}` : '') +
  (e.ano_ini ? ` (${e.ano_ini}${e.ano_fim ? '–' + e.ano_fim : ' em diante'})` : '');

/* O catálogo tem ~2.500 linhas e não muda em produção: cabe inteiro na
   memória. Pré-filtrar por SQL custava cobertura — um LIKE não acha
   "Space Fox" quando o balcão digitou "SPACEFOX" — e ainda dava uma ida
   ao banco por consulta. Carrega uma vez e casa tudo em memória. */
let _cache = null;
async function catalogo() {
  if (_cache) return _cache;
  const linhas = await q(
    `SELECT id, marca, modelo, versao, combustivel_txt, ano_ini, ano_fim,
            f_ar, f_oleo, f_oleo_opc, f_combustivel, f_combustivel_opc,
            f_cabine, f_cabine_carvao, pagina, linha_bruta
       FROM catalogo_filtro`);
  for (const e of linhas) {
    e._tCat = norm(e.modelo).split(' ').filter(util);
    e._gCat = e._tCat.join('');
    e._tMarca = norm(e.marca).split(' ').filter(Boolean);
  }
  _cache = linhas;
  return _cache;
}

/* Aqui NÃO há índice por token, e é decisão consciente.
   Tentei indexar por palavra e por começo do nome: cortou a fila de
   pendências de 24ms para 3ms, mas mudou 9 respostas em 3.075 — e o tipo
   de mudança era o pior: "Spin 2016" deixava de ser marcado como AMBÍGUO
   porque o índice não trazia a entrada concorrente. Esconder do balcão que
   existem dois códigos de óleo possíveis vale muito mais que 20ms numa tela
   que se abre uma vez por dia. A comparação está em scripts/teste-wega.js.
/** Usado depois de recarregar o catálogo. */
const esquecerCatalogo = () => { _cache = null; };


/* Desempate — e SÓ desempate: entra depois de b.p - a.p, então nunca muda
   quem tirou a maior nota, só quem ganha entre iguais.

   Existe porque o catálogo Wega escreve "Gol" no nome de TODAS as linhas de
   Gol, do G2 de 1994 ao G7 de 2020: a geração vai na descrição, não no nome.
   Resultado: um Gol 2020 empatava com a linha "Gol (EFI - MI / Power /
   Rallye) 2004 -->" e com a linha "Gol Total flex (G7) 2016 -->", e quem
   ganhava era a que estivesse antes na página do PDF. Saía WO370 num carro
   que leva WO545 — filtro de óleo errado, por ordem de impressão.

   Entre faixas que contêm o ano, a que COMEÇA mais perto dele é a geração
   do carro: um 2020 é da linha que abre em 2016, não da que abre em 2004.
   Empatando nisso, ganha a faixa mais estreita, que é a mais específica. */
function geracaoMaisProxima(a, b, ano) {
  if (!ano) return 0;
  const dentro = e => e.ano_ini && ano >= e.ano_ini && ano <= (e.ano_fim || 2100);
  const da = dentro(a), db = dentro(b);
  if (da !== db) return da ? -1 : 1;          // quem está na faixa vem antes
  if (!da) return 0;

  const inicio = (ano - a.ano_ini) - (ano - b.ano_ini);
  if (inicio) return inicio;                  // menor distância do início

  const larg = e => (e.ano_fim || 2100) - e.ano_ini;
  return larg(a) - larg(b);                   // a faixa mais estreita é mais específica
}

/** Sugere os filtros para um veículo. Não faz rede: só o catálogo local. */
async function sugerirFiltros({ marca, modelo, ano, combustivel }) {
  if (!modelo) return { status: 'sem_modelo', itens: [] };

  const _tCar = norm(modelo).split(' ').filter(util).filter(t => !RUIDO.test(t));
  if (!_tCar.length) return { status: 'sem_modelo', itens: [] };

  const candidatos = await catalogo();
  const alvo = { marca, modelo, ano, combustivel, _tCar };

  const notas = candidatos
    .map(e => ({ e, ...pontuar(e, alvo) }))
    .filter(x => x.p > 0)
    .sort((a, b) => (b.p - a.p) || geracaoMaisProxima(a.e, b.e, ano));

  if (!notas.length) return { status: 'sem_catalogo', itens: [] };

  const top = notas[0];
  const itens = itensDe(top.e);
  if (!itens.length) return { status: 'sem_catalogo', itens: [] };

  // quantas linhas empatadas discordam do código de óleo: se discordam, avisa
  const empatadas = notas.filter(n => n.p >= top.p - 5);
  const oleos = [...new Set(empatadas.map(n => n.e.f_oleo).filter(Boolean))];

  return {
    status: top.p < LIMIAR ? 'precisa_confirmar' : (oleos.length > 1 ? 'ambiguo' : 'sugerido'),
    confianca: top.p,
    origem: rotuloFonte(top.e),
    porque: (top.razoes || []).join(', '),
    pagina_pdf: top.e.pagina,
    linha_pdf: top.e.linha_bruta,
    alternativas: oleos.length > 1 ? oleos : null,
    itens
  };
}

/** Os filtros que a loja já confirmou para este carro, no mesmo formato. */
function itensConfirmados(v) {
  const mapa = [
    ['oleo',        v.filtro_oleo,        'Filtro de óleo'],
    ['ar',          v.filtro_ar,          'Filtro de ar'],
    ['combustivel', v.filtro_combustivel, 'Filtro de combustível'],
    ['cabine',      v.filtro_cabine,      'Filtro de cabine']
  ];
  return mapa.filter(([, c]) => c)
    .map(([tipo, codigo, rotulo]) => ({ tipo, rotulo, codigo, alternativo: null, nota: null }));
}

/* Só para a bancada: a mesma pontuação, sem o índice. Serve para provar que
   otimizar não mudou nenhuma resposta. */
async function _forcaBruta(alvo, linhas) {
  const _tCar = norm(alvo.modelo).split(' ').filter(util).filter(t => !RUIDO.test(t));
  if (!_tCar.length) return { status: 'sem_modelo', itens: [] };
  for (const e of linhas) {
    if (!e._tCat) {
      e._tCat = norm(e.modelo).split(' ').filter(util);
      e._gCat = e._tCat.join('');
      e._tMarca = norm(e.marca).split(' ').filter(Boolean);
    }
  }
  /* mesmo desempate da versão de produção: a varredura serve para provar que
     o cache em memória não mudou resposta, não para comparar regras diferentes */
  const notas = linhas.map(e => ({ e, ...pontuar(e, { ...alvo, _tCar }) }))
    .filter(x => x.p > 0)
    .sort((a, b) => (b.p - a.p) || geracaoMaisProxima(a.e, b.e, parseInt(alvo.ano, 10)));
  if (!notas.length) return { status: 'sem_catalogo', itens: [] };
  const top = notas[0];
  const itens = itensDe(top.e);
  if (!itens.length) return { status: 'sem_catalogo', itens: [] };
  const oleos = [...new Set(notas.filter(n => n.p >= top.p - 5)
    .map(n => n.e.f_oleo).filter(Boolean))];
  return {
    status: top.p < LIMIAR ? 'precisa_confirmar' : (oleos.length > 1 ? 'ambiguo' : 'sugerido'),
    confianca: top.p, itens
  };
}

module.exports = { sugerirFiltros, itensConfirmados, esquecerCatalogo, _forcaBruta, TIPOS };
