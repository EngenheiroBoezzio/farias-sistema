/* O que a própria Farias já usou — a fonte mais barata e mais confiável que
   existe aqui dentro.

   Sem consulta de placa paga, a pergunta "que óleo vai neste carro?" tem uma
   resposta melhor que qualquer catálogo: a que a oficina já deu 135 vezes num
   Gol. Catálogo é teoria; a prateleira da casa é prática, e é ela que o
   atendente confere quando o cliente está na frente dele.

   Regra que vale para tudo neste arquivo: o ANO importa. Gol 2005 e Gol 2018
   não levam o mesmo filtro. Quando o ano vem, a busca se aperta numa faixa
   em volta dele e a resposta DIZ que se apertou — senão o balcão acha que a
   contagem é do modelo inteiro. */
'use strict';
const { q } = require('../db');

const JANELA = 3;                    // anos para cada lado

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Os veículos da casa que são deste modelo. Exato primeiro; se não houver,
 *  tenta por aproximação — o balcão nem sempre digita igual ao cadastro. */
async function irmaos(modelo, ano) {
  if (!modelo) return { linhas: [], criterio: null };

  const campos = `id, modelo, ano, cilindrada, ultimo_oleo, ultima_troca,
                  filtro_oleo, filtro_ar, filtro_combustivel, filtro_cabine`;

  let linhas = await q(
    `SELECT ${campos} FROM veiculos WHERE modelo = ? LIMIT 400`, [modelo]);
  let criterio = 'exato';

  if (!linhas.length) {
    const t = norm(modelo).split(' ').filter(x => x.length >= 3)[0];
    if (!t) return { linhas: [], criterio: null };
    linhas = await q(
      `SELECT ${campos} FROM veiculos WHERE modelo LIKE ? LIMIT 400`, [`%${t}%`]);
    criterio = 'aproximado';
  }
  if (!linhas.length) return { linhas: [], criterio: null };

  if (ano) {
    const perto = linhas.filter(v => v.ano && Math.abs(v.ano - ano) <= JANELA);
    /* Só aperta se sobrar gente: com dois carros na faixa a contagem não diz
       nada, e é melhor responder pelo modelo inteiro avisando disso. */
    if (perto.length >= 3) return { linhas: perto, criterio, janela: JANELA, ano };
  }
  return { linhas, criterio };
}

/* "5W40 MOB" -> viscosidade "5W-40" + marca "MOB".
   O balcão anota o produto da prateleira; a decisão técnica, porém, é a
   VISCOSIDADE — é ela que o catálogo fala e é ela que o motor sente. Contar
   "5W40 MOB", "5W40 SHELL" e "5W40 HAV" como três respostas diferentes
   esconde que a casa concorda: num Gol 2015 são 51 trocas de 5W-40 em 63,
   e não um 5W40 MOB isolado com 56%. */
function partirOleo(t) {
  const s = String(t || '').toUpperCase();
  const m = s.match(/(\d{1,2})\s*W\s*[-\/ ]?\s*(\d{2})/);
  if (!m) return { visc: null, marca: s.trim() || null };
  const visc = `${+m[1]}W-${m[2]}`;
  const marca = s.replace(m[0], ' ').replace(/[^A-Z0-9 ]/g, ' ')
                 .replace(/\s+/g, ' ').trim() || null;
  return { visc, marca };
}

/* Quanto vale o histórico: a fatia do mais usado, descontada quando há pouca
   troca para contar. Com 7 trocas, 43% não é padrão da casa — é coincidência,
   e a resposta tem que dizer isso em número, não em adjetivo. */
const pesoDaAmostra = total => Math.min(1, total / 20);

/** Óleo que a casa usou nesses carros, agrupado por viscosidade. */
async function oleoDoModelo(modelo, ano) {
  const { linhas, criterio, janela } = await irmaos(modelo, ano);
  if (!linhas.length) return null;

  const ids = linhas.map(v => v.id);
  /* Conta o que foi de fato POSTO na troca, não o que está no cadastro: a
     coluna ultimo_oleo é um resumo, a tabela de serviços é o histórico. */
  const marcadores = ids.map(() => '?').join(',');
  const trocas = await q(
    `SELECT oleo, COUNT(*) n, MAX(data) ultima
       FROM servicos
      WHERE veiculo_id IN (${marcadores}) AND oleo IS NOT NULL AND oleo <> ''
      GROUP BY oleo ORDER BY n DESC, ultima DESC`, ids);

  if (!trocas.length) return null;
  const total = trocas.reduce((s, t) => s + t.n, 0);

  const porVisc = new Map();
  for (const t of trocas) {
    const { visc, marca } = partirOleo(t.oleo);
    const chave = visc || `(${t.oleo})`;
    const v = porVisc.get(chave) ||
      { viscosidade: visc, vezes: 0, ultima: null, marcas: new Map() };
    v.vezes += t.n;
    if (!v.ultima || t.ultima > v.ultima) v.ultima = t.ultima;
    if (marca) v.marcas.set(marca, (v.marcas.get(marca) || 0) + t.n);
    porVisc.set(chave, v);
  }

  const itens = [...porVisc.entries()]
    .map(([chave, v]) => {
      const marcas = [...v.marcas.entries()].sort((a, b) => b[1] - a[1]);
      return {
        viscosidade: v.viscosidade,
        rotulo: chave,
        vezes: v.vezes,
        parte: Math.round((v.vezes / total) * 100),
        ultima: v.ultima,
        marca_usual: marcas.length ? marcas[0][0] : null,
        marcas: marcas.map(([marca, n]) => ({ marca, vezes: n }))
      };
    })
    .sort((a, b) => b.vezes - a.vezes || (a.ultima < b.ultima ? 1 : -1));

  const topo = itens[0];
  return {
    itens: itens.slice(0, 6),
    viscosidade: topo.viscosidade,
    marca_usual: topo.marca_usual,
    parte: topo.parte,
    confianca: Math.round(topo.parte * pesoDaAmostra(total)),
    total,
    carros: linhas.length,
    criterio,
    janela: janela || null,
    ano: janela ? ano : null
  };
}

/** Filtros que a casa já confirmou em carros do mesmo modelo. */
async function filtrosDoModelo(modelo, ano) {
  const { linhas, criterio, janela } = await irmaos(modelo, ano);
  if (!linhas.length) return null;

  const tipos = [
    ['oleo', 'filtro_oleo', 'Filtro de óleo'],
    ['ar', 'filtro_ar', 'Filtro de ar'],
    ['combustivel', 'filtro_combustivel', 'Filtro de combustível'],
    ['cabine', 'filtro_cabine', 'Filtro de cabine']
  ];

  const itens = [];
  for (const [tipo, coluna, rotulo] of tipos) {
    const contagem = new Map();
    for (const v of linhas) {
      const c = String(v[coluna] || '').trim();
      if (!c) continue;
      contagem.set(c, (contagem.get(c) || 0) + 1);
    }
    if (!contagem.size) continue;

    const ordenado = [...contagem.entries()].sort((a, b) => b[1] - a[1]);
    const soma = ordenado.reduce((s, [, n]) => s + n, 0);
    const parte = Math.round((ordenado[0][1] / soma) * 100);
    itens.push({
      tipo, rotulo,
      codigo: ordenado[0][0],
      vezes: ordenado[0][1],
      parte,
      confianca: Math.round(parte * pesoDaAmostra(soma)),
      /* Divergência não é erro: motor diferente dentro do mesmo modelo leva
         filtro diferente. Mas o balcão precisa VER que há mais de um. */
      outros: ordenado.slice(1, 4).map(([codigo, n]) => ({ codigo, vezes: n }))
    });
  }
  if (!itens.length) return null;

  return {
    itens,
    carros: linhas.length,
    criterio,
    janela: janela || null,
    ano: janela ? ano : null
  };
}

/* ---------- lista de modelos para o balcão escolher ----------
   Junta os modelos que a oficina realmente atende com os do catálogo Wega.
   Os da casa vêm primeiro: são os carros que entram na porta. */

let _lista = null, _em = 0;
const VALIDADE = 10 * 60 * 1000;

async function listaModelos() {
  if (_lista && Date.now() - _em < VALIDADE) return _lista;

  const daCasa = await q(
    `SELECT modelo, COUNT(*) n FROM veiculos
      WHERE modelo IS NOT NULL AND modelo <> ''
      GROUP BY modelo`);

  const doCatalogo = await q(
    `SELECT marca, modelo, COUNT(*) n FROM catalogo_filtro
      WHERE modelo IS NOT NULL AND modelo <> ''
      GROUP BY marca, modelo`);

  const mapa = new Map();
  for (const l of daCasa) {
    const chave = norm(l.modelo);
    if (!chave) continue;
    mapa.set(chave, {
      modelo: l.modelo, marca: null, carros: l.n, de: 'oficina',
      _n: norm(l.modelo), _g: norm(l.modelo).replace(/ /g, '')
    });
  }
  for (const l of doCatalogo) {
    const chave = norm(l.modelo);
    if (!chave) continue;
    const ja = mapa.get(chave);
    /* Já existe na casa: só empresta a marca, que o cadastro da Farias não
       preenche. Não vira entrada nova nem perde a contagem de carros. */
    if (ja) { if (!ja.marca) ja.marca = l.marca; ja.de = 'oficina+catalogo'; continue; }
    mapa.set(chave, {
      modelo: l.modelo, marca: l.marca, carros: 0, de: 'catalogo',
      _n: chave, _g: chave.replace(/ /g, '')
    });
  }

  _lista = [...mapa.values()];
  _em = Date.now();
  return _lista;
}

const esquecerModelos = () => { _lista = null; };

/** Autocompletar. Casa também sem espaço: quem digita "SPACEFOX" tem que
 *  achar "Space Fox", que é como o catálogo escreve. */
async function buscarModelos(busca, limite = 20) {
  const alvo = norm(busca);
  const grudado = alvo.replace(/ /g, '');
  if (grudado.length < 2) return [];

  const lista = await listaModelos();
  const achados = [];

  for (const m of lista) {
    let p = 0;
    if (m._n === alvo || m._g === grudado) p = 100;
    else if (m._g.startsWith(grudado)) p = 80;
    else if (m._g.includes(grudado)) p = 60;
    else if (alvo.split(' ').every(t => t && m._n.includes(t))) p = 40;
    if (!p) continue;
    achados.push({ ...m, _p: p });
  }

  achados.sort((a, b) => (b._p - a._p) || (b.carros - a.carros) ||
                          a.modelo.localeCompare(b.modelo));

  return achados.slice(0, limite).map(m => ({
    modelo: m.modelo, marca: m.marca, carros: m.carros, de: m.de
  }));
}

/** Os modelos que mais aparecem na oficina — o atalho da tela vazia. */
async function modelosMaisComuns(limite = 12) {
  const lista = await listaModelos();
  return lista.filter(m => m.carros > 0)
    .sort((a, b) => b.carros - a.carros)
    .slice(0, limite)
    .map(m => ({ modelo: m.modelo, marca: m.marca, carros: m.carros, de: m.de }));
}

module.exports = {
  partirOleo, oleoDoModelo, filtrosDoModelo, buscarModelos, modelosMaisComuns,
  listaModelos, esquecerModelos
};
