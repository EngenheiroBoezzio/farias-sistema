/* Catálogo de Óleos e Filtros.
   Permite consulta e navegação rápida das especificações técnicas de motores,
   capacidade do cárter em litros, viscosidades e códigos de filtros (Wega e oficina). */
'use strict';
const express = require('express');
const { q } = require('../db');
const { rota } = require('../meio/erros');
const { exigeLogin } = require('../meio/auth');
const { txt, paginacao } = require('../meio/validar');

const r = express.Router();
r.use(exigeLogin);

/* GET /api/catalogo/oleos — busca e paginação de óleos e capacidades */
r.get('/oleos', rota(async (req, res) => {
  const { limite, offset, pagina } = paginacao(req.query);
  const busca = txt(req.query.busca || '').trim();
  const marca = txt(req.query.marca || '').trim();

  let condicoes = ['1=1'];
  let params = [];

  if (busca) {
    condicoes.push('(modelo LIKE ? OR motor LIKE ? OR marca LIKE ? OR viscosidades LIKE ?)');
    const like = `%${busca}%`;
    params.push(like, like, like, like);
  }

  if (marca) {
    condicoes.push('marca = ?');
    params.push(marca);
  }

  const where = condicoes.join(' AND ');

  const [itens, [{ total }]] = await Promise.all([
    q(`SELECT id, fonte, marca, modelo, motor, cilindrada, ano_ini, ano_fim,
              CAST(litros AS DOUBLE) AS litros, viscosidades
       FROM catalogo_oleo
       WHERE ${where}
       ORDER BY marca ASC, modelo ASC, ano_ini DESC
       LIMIT ? OFFSET ?`, [...params, limite, offset]),
    q(`SELECT COUNT(*) AS total FROM catalogo_oleo WHERE ${where}`, params)
  ]);

  res.json({ total, pagina, limite, itens });
}));

/* GET /api/catalogo/filtros — busca e paginação de filtros */
r.get('/filtros', rota(async (req, res) => {
  const { limite, offset, pagina } = paginacao(req.query);
  const busca = txt(req.query.busca || '').trim();
  const marca = txt(req.query.marca || '').trim();

  let condicoes = ['1=1'];
  let params = [];

  if (busca) {
    condicoes.push('(modelo LIKE ? OR marca LIKE ? OR versao LIKE ? OR f_oleo LIKE ? OR f_ar LIKE ? OR f_combustivel LIKE ? OR f_cabine LIKE ?)');
    const like = `%${busca}%`;
    params.push(like, like, like, like, like, like, like);
  }

  if (marca) {
    condicoes.push('marca = ?');
    params.push(marca);
  }

  const where = condicoes.join(' AND ');

  const [itens, [{ total }]] = await Promise.all([
    q(`SELECT id, fonte, marca, modelo, versao, combustivel_txt, ano_ini, ano_fim,
              f_oleo, f_ar, f_combustivel, f_cabine
       FROM catalogo_filtro
       WHERE ${where}
       ORDER BY marca ASC, modelo ASC, ano_ini DESC
       LIMIT ? OFFSET ?`, [...params, limite, offset]),
    q(`SELECT COUNT(*) AS total FROM catalogo_filtro WHERE ${where}`, params)
  ]);

  res.json({ total, pagina, limite, itens });
}));

/* GET /api/catalogo/marcas — marcas distintas para filtros rápidos */
r.get('/marcas', rota(async (_req, res) => {
  const [mOleos, mFiltros] = await Promise.all([
    q('SELECT DISTINCT marca FROM catalogo_oleo WHERE marca IS NOT NULL AND marca <> "" ORDER BY marca'),
    q('SELECT DISTINCT marca FROM catalogo_filtro WHERE marca IS NOT NULL AND marca <> "" ORDER BY marca')
  ]);

  const marcasSet = new Set([
    ...mOleos.map(x => x.marca.toUpperCase()),
    ...mFiltros.map(x => x.marca.toUpperCase())
  ]);

  const marcas = [...marcasSet].sort();
  res.json({ marcas });
}));

/* GET /api/catalogo/resumo — totais gerais do acervo */
r.get('/resumo', rota(async (_req, res) => {
  const [[{ totalOleos }], [{ totalFiltros }]] = await Promise.all([
    q('SELECT COUNT(*) AS totalOleos FROM catalogo_oleo'),
    q('SELECT COUNT(*) AS totalFiltros FROM catalogo_filtro')
  ]);

  res.json({ totalOleos, totalFiltros });
}));

module.exports = r;
