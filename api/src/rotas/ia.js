/* Rotas de Inteligência Artificial (Google Gemini).
 * Integrada com Óleos e Filtros, Fila de Filtros e Comunidade.
 */
'use strict';
const express = require('express');
const { q, um } = require('../db');
const { rota, erro400 } = require('../meio/erros');
const { exigeLogin } = require('../meio/auth');
const { txt, inteiro } = require('../meio/validar');
const gemini = require('../meio/gemini');
const { sugerirFiltros } = require('../meio/wega');

const r = express.Router();
r.use(exigeLogin);

/* GET /api/ia/status — verifica se a IA está ativa */
r.get('/status', rota(async (_req, res) => {
  res.json({
    configurado: gemini.estaConfigurado(),
    modelo: gemini.modeloAtual(),
    /* Quem está no revezamento e quem está pausado. Nunca inclui chave. */
    provedores: gemini.situacaoIA()
  });
}));

/* POST /api/ia/oleo-capacidade — consulta capacidade de cárter em litros e viscosidade */
r.post('/oleo-capacidade', rota(async (req, res) => {
  const modelo = txt(req.body?.modelo);
  if (!modelo) throw erro400('O modelo do veículo é obrigatório.');

  const marca = txt(req.body?.marca || '');
  const motor = txt(req.body?.motor || '');
  const ano = req.body?.ano ? parseInt(req.body.ano, 10) : null;

  const resultado = await gemini.consultarCapacidadeOleo({ marca, modelo, motor, ano });

  // Tenta enriquecer a tabela catalogo_oleo se encontrar registro sem litros
  try {
    if (resultado && resultado.litros) {
      await q(
        `UPDATE catalogo_oleo
         SET litros = ?, viscosidades = COALESCE(NULLIF(viscosidades, ''), ?)
         WHERE (litros IS NULL OR litros = 0)
           AND modelo LIKE ?
         LIMIT 3`,
        [resultado.litros, resultado.viscosidade_principal, `%${modelo}%`]
      );
    }
  } catch {}

  res.json({ ok: true, ia: resultado });
}));

/* POST /api/ia/varredura-fila — varre a fila de veículos sem filtros e combina Wega + IA */
r.post('/varredura-fila', rota(async (req, res) => {
  const limite = Math.min(inteiro(req.body?.limite || 15, 'o limite', { min: 1, max: 50 }), 50);

  // Seleciona veículos ativos que ainda não têm filtro_oleo definido
  const veiculos = await q(
    `SELECT v.id, v.placa, v.marca, v.modelo, v.cilindrada, v.ano, v.visitas, c.nome AS cliente
     FROM veiculos v
     JOIN clientes c ON c.id = v.cliente_id
     WHERE v.filtro_oleo IS NULL AND v.situacao IN ('em_dia', 'vencido')
     ORDER BY v.visitas DESC, v.ultima_troca DESC
     LIMIT ?`,
    [limite]
  );

  if (!veiculos.length) {
    return res.json({ ok: true, total: 0, sugestoes: [] });
  }

  const sugestoes = [];

  for (const v of veiculos) {
    // 1. Tenta casar primeiro com o catálogo Wega
    let sWega = null;
    try {
      sWega = await sugerirFiltros({ marca: v.marca, modelo: v.modelo, ano: v.ano });
    } catch {}

    const temWegaValido = sWega && sWega.itens && sWega.itens.length && sWega.status !== 'sem_catalogo';

    if (temWegaValido && sWega.confianca >= 65) {
      const mapa = {};
      sWega.itens.forEach(i => { mapa[i.tipo] = i.codigo; });
      sugestoes.push({
        id: v.id,
        placa: v.placa,
        modelo: v.modelo,
        marca: v.marca,
        ano: v.ano,
        cliente: v.cliente,
        filtros: {
          filtro_oleo: mapa.oleo || null,
          filtro_ar: mapa.ar || null,
          filtro_cabine: mapa.cabine || null,
          filtro_combustivel: mapa.combustivel || null
        },
        fonte: 'catalogo_wega',
        confianca: sWega.confianca,
        origem: sWega.origem || 'Catálogo Wega'
      });
    } else if (gemini.estaConfigurado()) {
      // 2. Não casou perfeitamente com Wega -> usa a IA do Gemini
      try {
        const iaFiltros = await gemini.identificarFiltrosVeiculo({
          marca: v.marca,
          modelo: v.modelo,
          motor: v.cilindrada,
          ano: v.ano
        });

        sugestoes.push({
          id: v.id,
          placa: v.placa,
          modelo: v.modelo,
          marca: v.marca,
          ano: v.ano,
          cliente: v.cliente,
          filtros: {
            filtro_oleo: iaFiltros.filtro_oleo || null,
            filtro_ar: iaFiltros.filtro_ar || null,
            filtro_cabine: iaFiltros.filtro_cabine || null,
            filtro_combustivel: iaFiltros.filtro_combustivel || null
          },
          fonte: 'gemini_ia',
          confianca: iaFiltros.confianca || 80,
          origem: 'Google Gemini IA'
        });
      } catch {
        // Se a chamada da IA falhar pontualmente para um carro, mantém o que tiver
        if (temWegaValido) {
          const mapa = {};
          sWega.itens.forEach(i => { mapa[i.tipo] = i.codigo; });
          sugestoes.push({
            id: v.id,
            placa: v.placa,
            modelo: v.modelo,
            marca: v.marca,
            ano: v.ano,
            cliente: v.cliente,
            filtros: {
              filtro_oleo: mapa.oleo || null,
              filtro_ar: mapa.ar || null,
              filtro_cabine: mapa.cabine || null,
              filtro_combustivel: mapa.combustivel || null
            },
            fonte: 'catalogo_wega_parcial',
            confianca: sWega.confianca || 40,
            origem: sWega.origem || 'Catálogo Wega'
          });
        }
      }
    }
  }

  res.json({
    ok: true,
    total: sugestoes.length,
    sugestoes
  });
}));

/* POST /api/ia/varredura-fila/aplicar — aplica sugestões aprovadas em lote */
r.post('/varredura-fila/aplicar', rota(async (req, res) => {
  const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];
  if (!itens.length) throw erro400('Nenhum item informado para aplicar.');

  let aplicados = 0;
  for (const item of itens) {
    if (!item.id) continue;
    const fOleo = item.filtro_oleo ? String(item.filtro_oleo).trim().toUpperCase() : null;
    const fAr = item.filtro_ar ? String(item.filtro_ar).trim().toUpperCase() : null;
    const fCabine = item.filtro_cabine ? String(item.filtro_cabine).trim().toUpperCase() : null;
    const fCombustivel = item.filtro_combustivel ? String(item.filtro_combustivel).trim().toUpperCase() : null;

    if (!fOleo && !fAr && !fCabine && !fCombustivel) continue;

    await q(
      `UPDATE veiculos
       SET filtro_oleo = COALESCE(filtro_oleo, ?),
           filtro_ar = COALESCE(filtro_ar, ?),
           filtro_cabine = COALESCE(filtro_cabine, ?),
           filtro_combustivel = COALESCE(filtro_combustivel, ?),
           filtros_por = ?,
           filtros_em = NOW()
       WHERE id = ?`,
      [fOleo, fAr, fCabine, fCombustivel, `IA Gemini (${req.usuario.username})`, item.id]
    );
    aplicados++;
  }

  res.json({ ok: true, aplicados });
}));

/* POST /api/ia/comunidade/gerar — gera textos atrativos para WhatsApp com a IA */
r.post('/comunidade/gerar', rota(async (req, res) => {
  const tema = txt(req.body?.tema);
  const tipo = txt(req.body?.tipo || 'campanha');

  /* Nome da loja: é só enfeite do texto. Se o banco falhar aqui (ex.: tabela
     configuracoes ainda não criada no servidor), NÃO derruba a geração —
     antes isso aparecia na tela como "Confira os dados enviados.". */
  let nomeLoja = 'Farias Troca de Óleo';
  try {
    const cfg = await um("SELECT valor FROM configuracoes WHERE chave = 'nomeLoja'");
    if (cfg?.valor) nomeLoja = cfg.valor;
  } catch (e) {
    console.warn('[ia] não consegui ler nomeLoja de configuracoes:', e.code || e.message,
                 '— rode api/sql/2026-09-26-configuracoes.sql no banco.');
  }

  const ideia = await gemini.gerarMensagemComunidade({ tema, tipo, nomeLoja });
  res.json({ ok: true, ideia });
}));

module.exports = r;
