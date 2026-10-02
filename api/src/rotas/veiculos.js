/* Veículos: busca, ficha e consulta por placa.
   Toda query é parametrizada; ORDER BY vem de lista fechada. */
'use strict';
const express = require('express');
const { q, um } = require('../db');
const { rota, erro400, erro404, erro409 } = require('../meio/erros');
const { exigeLogin, exigeEscrita } = require('../meio/auth');
const { placaValida, paginacao, ordenacao, txt, textoAte, inteiro, somente } = require('../meio/validar');
const { sugerirFiltros } = require('../meio/wega');

const r = express.Router();
r.use(exigeLogin, exigeEscrita('admin', 'atendente'));

const COLUNAS = `v.id, v.placa, v.modelo, v.marca, v.cilindrada, v.ano,
  v.ultima_troca, v.ultimo_km, v.ultimo_oleo, v.visitas, v.situacao, v.obs,
  v.filtro_oleo, v.filtro_ar, v.filtro_cabine, v.filtro_combustivel,
  v.filtros_por, v.filtros_em,
  c.id AS cliente_id, c.nome AS cliente, c.telefone, c.tel_inferido,
  DATEDIFF(CURDATE(), v.ultima_troca) AS dias`;

/* GET /veiculos?busca=&situacao=&pagina=&limite= */
r.get('/', rota(async (req, res) => {
  const { limite, offset, pagina } = paginacao(req.query);
  const { campo, dir } = ordenacao(req.query,
    ['ultima_troca', 'visitas', 'placa', 'dias'], 'ultima_troca');

  const onde = [];
  const p = [];
  const busca = txt(req.query.busca);
  if (busca) {
    onde.push('(c.nome LIKE ? OR v.placa LIKE ? OR v.modelo LIKE ?)');
    const like = `%${busca}%`;
    p.push(like, like, like);
  }
  const sit = txt(req.query.situacao);
  if (['em_dia', 'vencido', 'parado', 'frio'].includes(sit)) {
    onde.push('v.situacao = ?');
    p.push(sit);
  }
  const filtro = onde.length ? 'WHERE ' + onde.join(' AND ') : '';
  const ordem = campo === 'dias' ? `v.ultima_troca ${dir === 'ASC' ? 'DESC' : 'ASC'}`
                                 : `v.${campo} ${dir}`;

  const [linhas, [{ total }]] = await Promise.all([
    q(`SELECT ${COLUNAS} FROM veiculos v
       JOIN clientes c ON c.id = v.cliente_id
       ${filtro} ORDER BY ${ordem} LIMIT ? OFFSET ?`, [...p, limite, offset]),
    q(`SELECT COUNT(*) AS total FROM veiculos v
       JOIN clientes c ON c.id = v.cliente_id ${filtro}`, p)
  ]);

  res.json({ total, pagina, limite, veiculos: linhas });
}));

/* GET /veiculos/placa/ABC1D23 — a rota mais usada do sistema.
   Índice UNIQUE em placa: um seek, sem varredura. */
r.get('/placa/:placa', rota(async (req, res) => {
  const placa = placaValida(req.params.placa);
  const v = await um(`SELECT ${COLUNAS} FROM veiculos v
                      JOIN clientes c ON c.id = v.cliente_id
                      WHERE v.placa = ?`, [placa]);
  if (!v) return res.status(404).json({ erro: 'Placa não encontrada.', placa, cadastrar: true });

  const historico = await q(
    `SELECT id, data, km, oleo, litros, total, valor_oleo,
            valor_filtro_oleo, valor_filtro_ar,
            cod_filtro_oleo, cod_filtro_ar, cod_filtro_cabine
     FROM servicos WHERE veiculo_id = ? ORDER BY data DESC LIMIT 20`, [v.id]);

  res.json({ veiculo: v, historico });
}));

/* GET /veiculos/:id */
r.get('/:id', rota(async (req, res) => {
  const id = inteiro(req.params.id, 'o id', { min: 1 });
  const v = await um(`SELECT ${COLUNAS} FROM veiculos v
                      JOIN clientes c ON c.id = v.cliente_id WHERE v.id = ?`, [id]);
  if (!v) throw erro404('Veículo não encontrado.');
  const historico = await q(
    `SELECT id, data, km, oleo, litros, total FROM servicos
     WHERE veiculo_id = ? ORDER BY data DESC LIMIT 20`, [id]);
  res.json({ veiculo: v, historico });
}));


/* ---------- cadastro ---------- */

// lista branca: o resto do corpo é ignorado
const CAMPOS = ['cliente_id', 'placa', 'marca', 'modelo', 'cilindrada', 'ano',
                'filtro_oleo', 'filtro_ar', 'filtro_cabine', 'filtro_combustivel', 'obs'];

/* Os quatro tipos que a Wega lista para a linha leve. */
const FILTROS = ['filtro_oleo', 'filtro_ar', 'filtro_cabine', 'filtro_combustivel'];

function validarVeiculo(corpo, { parcial = false } = {}) {
  const c = somente(corpo || {}, CAMPOS);
  const saida = {};

  if (!parcial || c.placa !== undefined) saida.placa = placaValida(c.placa);
  if (!parcial || c.cliente_id !== undefined)
    saida.cliente_id = inteiro(c.cliente_id, 'o cliente', { min: 1 });
  if (!parcial || c.marca !== undefined) saida.marca = textoAte(c.marca, 'a marca', 40);
  if (!parcial || c.modelo !== undefined) saida.modelo = textoAte(c.modelo, 'o modelo', 80);

  if (!parcial || c.cilindrada !== undefined) {
    const cil = txt(c.cilindrada).replace(',', '.');
    if (cil && !/^[0-9]\.[0-9]$/.test(cil))
      throw erro400('Cilindrada no formato 1.0, 1.6, 2.0.');
    saida.cilindrada = cil || null;
  }

  if (!parcial || c.ano !== undefined) {
    const ano = inteiro(c.ano, 'o ano', { min: 1950, max: new Date().getFullYear() + 1 });
    saida.ano = ano;
  }

  // a subseção de filtros: preenchida uma vez, vale para todas as trocas
  for (const f of FILTROS)
    if (!parcial || c[f] !== undefined)
      saida[f] = (textoAte(c[f], 'o código do filtro', 40) || '').toUpperCase() || null;

  if (!parcial || c.obs !== undefined) saida.obs = textoAte(c.obs, 'a observação', 255);

  if (parcial && !Object.keys(saida).length) throw erro400('Nada para alterar.');
  return saida;
}

const mexeuNosFiltros = c => FILTROS.some(f => c[f] !== undefined);

/* POST /veiculos */
r.post('/', rota(async (req, res) => {
  const v = validarVeiculo(req.body);

  const cli = await um('SELECT id, nome FROM clientes WHERE id = ?', [v.cliente_id]);
  if (!cli) throw erro400('Cliente não encontrado. Cadastre o cliente antes do veículo.');

  const dup = await um('SELECT id, placa FROM veiculos WHERE placa = ?', [v.placa]);
  if (dup) throw erro409(`A placa ${v.placa} já está cadastrada.`);

  const marcouFiltro = mexeuNosFiltros(v);
  const [ins] = [await q(
    `INSERT INTO veiculos
     (cliente_id, placa, marca, modelo, cilindrada, ano,
      filtro_oleo, filtro_ar, filtro_cabine, filtro_combustivel,
      filtros_por, filtros_em, obs, visitas)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
    [v.cliente_id, v.placa, v.marca, v.modelo, v.cilindrada, v.ano,
     v.filtro_oleo, v.filtro_ar, v.filtro_cabine, v.filtro_combustivel,
     marcouFiltro ? req.usuario.username : null,
     marcouFiltro ? new Date() : null, v.obs])];

  const novo = await um(`SELECT ${COLUNAS} FROM veiculos v
                          JOIN clientes c ON c.id = v.cliente_id WHERE v.id = ?`,
                         [ins.insertId]);
  res.status(201).json({ veiculo: novo });
}));

/* PATCH /veiculos/:id */
r.patch('/:id', rota(async (req, res) => {
  const id = inteiro(req.params.id, 'o id', { min: 1 });
  const v = validarVeiculo(req.body, { parcial: true });

  const atual = await um('SELECT id, placa FROM veiculos WHERE id = ?', [id]);
  if (!atual) throw erro404('Veículo não encontrado.');

  if (v.placa && v.placa !== atual.placa) {
    const dup = await um('SELECT id FROM veiculos WHERE placa = ? AND id <> ?', [v.placa, id]);
    if (dup) throw erro409(`A placa ${v.placa} já está em outro veículo.`);
  }
  if (v.cliente_id) {
    const cli = await um('SELECT id FROM clientes WHERE id = ?', [v.cliente_id]);
    if (!cli) throw erro400('Cliente não encontrado.');
  }

  const campos = Object.keys(v);
  let sets = campos.map(k => `${k} = ?`).join(', ');
  const valores = campos.map(k => v[k]);
  if (mexeuNosFiltros(v)) {                       // registra quem confirmou e quando
    sets += ', filtros_por = ?, filtros_em = ?';
    valores.push(req.usuario.username, new Date());
  }
  await q(`UPDATE veiculos SET ${sets} WHERE id = ?`, [...valores, id]);

  const novo = await um(`SELECT ${COLUNAS} FROM veiculos v
                          JOIN clientes c ON c.id = v.cliente_id WHERE v.id = ?`, [id]);
  res.json({ veiculo: novo });
}));

/* PUT /veiculos/:id/filtros — a subseção, isolada.
   É a tela onde a Raíssa preenche os códigos de peça uma vez por carro. */
r.put('/:id/filtros', rota(async (req, res) => {
  const id = inteiro(req.params.id, 'o id', { min: 1 });
  const c = somente(req.body || {}, FILTROS);
  if (!Object.keys(c).length) throw erro400('Informe ao menos um filtro.');

  const v = await um('SELECT id FROM veiculos WHERE id = ?', [id]);
  if (!v) throw erro404('Veículo não encontrado.');

  const vals = FILTROS
    .map(f => c[f] === undefined
      ? undefined
      : ((textoAte(c[f], `o código de ${f.replace('_', ' de ')}`, 40) || '').toUpperCase() || null));

  const campos = [], valores = [];
  FILTROS.forEach((f, i) => {
    if (vals[i] !== undefined) { campos.push(`${f} = ?`); valores.push(vals[i]); }
  });
  await q(`UPDATE veiculos SET ${campos.join(', ')}, filtros_por = ?, filtros_em = ? WHERE id = ?`,
           [...valores, req.usuario.username, new Date(), id]);

  const novo = await um(
    `SELECT id, placa, filtro_oleo, filtro_ar, filtro_cabine, filtro_combustivel,
            filtros_por, filtros_em
     FROM veiculos WHERE id = ?`, [id]);
  res.json({ veiculo: novo });
}));

/* GET /veiculos/sem-filtro — a fila de trabalho: carros que ainda não têm peça definida */
r.get('/pendencias/sem-filtro', rota(async (req, res) => {
  const { limite, offset, pagina } = paginacao(req.query);
  const [linhas, [{ total }]] = await Promise.all([
    q(`SELECT v.id, v.placa, v.marca, v.modelo, v.cilindrada, v.ano, v.visitas,
               v.situacao, c.nome AS cliente
        FROM veiculos v JOIN clientes c ON c.id = v.cliente_id
        WHERE v.filtro_oleo IS NULL AND v.situacao IN ('em_dia','vencido')
        ORDER BY v.visitas DESC, v.ultima_troca DESC LIMIT ? OFFSET ?`, [limite, offset]),
    q(`SELECT COUNT(*) AS total FROM veiculos
        WHERE filtro_oleo IS NULL AND situacao IN ('em_dia','vencido')`)
  ]);
  /* Já vem com a sugestão do catálogo ao lado: a fila é para conferir e
     aceitar, não para digitar do zero. O catálogo está em memória, então
     isto não custa ida ao banco. */
  const comSugestao = await Promise.all(linhas.map(async v => {
    const s = await sugerirFiltros({
      marca: v.marca, modelo: v.modelo, ano: v.ano });
    return {
      ...v,
      sugestao: s.itens && s.itens.length
        ? { status: s.status, confianca: s.confianca, origem: s.origem,
            pagina_pdf: s.pagina_pdf, itens: s.itens }
        : { status: s.status, itens: [] }
    };
  }));

  res.json({ total, pagina, limite, veiculos: comSugestao,
             nota: 'Carros ativos sem filtro cadastrado, com a sugestão do ' +
                   'catálogo Wega ao lado. Confira antes de aceitar.' });
}));

/* POST /veiculos/:id/filtros/aceitar — grava a sugestão do catálogo.

   Fica separado do PUT /filtros de propósito: aqui o código não foi digitado
   por ninguém, veio do catálogo. `filtros_por` registra quem aceitou e que a
   origem foi o catálogo, para depois dar para saber o que foi conferido de
   verdade e o que foi aceito no atacado. */
r.post('/:id/filtros/aceitar', rota(async (req, res) => {
  const id = inteiro(req.params.id, 'o id', { min: 1 });
  const v = await um(
    'SELECT id, marca, modelo, ano, filtro_oleo FROM veiculos WHERE id = ?', [id]);
  if (!v) throw erro404('Veículo não encontrado.');

  const s = await sugerirFiltros({ marca: v.marca, modelo: v.modelo, ano: v.ano });
  if (!s.itens || !s.itens.length)
    throw erro400('O catálogo não tem sugestão para este veículo. Preencha à mão.');
  if (s.status === 'precisa_confirmar' && String(req.query.mesmo_assim) !== '1')
    return res.status(409).json({
      erro: 'Sugestão de baixa confiança — confira antes de aceitar.',
      confianca: s.confianca,
      origem: s.origem,
      itens: s.itens,
      aceitar_com: `POST /api/veiculos/${id}/filtros/aceitar?mesmo_assim=1`
    });

  const mapa = { oleo: 'filtro_oleo', ar: 'filtro_ar',
                 cabine: 'filtro_cabine', combustivel: 'filtro_combustivel' };
  const campos = [], valores = [];
  for (const i of s.itens) {
    if (!mapa[i.tipo]) continue;
    campos.push(`${mapa[i.tipo]} = COALESCE(${mapa[i.tipo]}, ?)`);  // não sobrescreve
    valores.push(i.codigo);
  }
  if (!campos.length) throw erro400('Nada a gravar.');

  await q(
    `UPDATE veiculos SET ${campos.join(', ')}, filtros_por = ?, filtros_em = ?
      WHERE id = ?`,
    [...valores, `catálogo, aceito por ${req.usuario.username}`, new Date(), id]);

  const novo = await um(
    `SELECT id, placa, filtro_oleo, filtro_ar, filtro_cabine, filtro_combustivel,
            filtros_por, filtros_em FROM veiculos WHERE id = ?`, [id]);
  res.json({ veiculo: novo, confianca: s.confianca, origem: s.origem });
}));

/* DELETE /veiculos/:id */
r.delete('/:id', exigeEscrita('admin'), rota(async (req, res) => {
  const id = inteiro(req.params.id, 'o id', { min: 1 });
  const v = await um('SELECT placa FROM veiculos WHERE id = ?', [id]);
  if (!v) throw erro404('Veículo não encontrado.');

  const [cont] = await q('SELECT COUNT(*) AS servicos FROM servicos WHERE veiculo_id = ?', [id]);
  if (String(req.query.confirmar) !== '1') {
    return res.status(409).json({
      erro: 'Confirme a exclusão.',
      detalhe: `Excluir a placa ${v.placa} apaga junto ${cont.servicos} ordem(ns) de serviço.`,
      confirmar_com: `DELETE /api/veiculos/${id}?confirmar=1`
    });
  }
  await q('DELETE FROM veiculos WHERE id = ?', [id]);
  res.json({ ok: true, removido: { placa: v.placa, servicos: cont.servicos } });
}));

module.exports = r;
