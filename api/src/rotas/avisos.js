/* Avisos enviados aos clientes.

   Registrar o contato é o que separa "lista de telefones" de "trabalho de
   recuperação": sem isso, na semana seguinte a mesma pessoa é chamada de novo,
   e ninguém sabe se avisar deu resultado. */
'use strict';
const express = require('express');
const { q, um } = require('../db');
const { rota, erro400, erro404 } = require('../meio/erros');
const { exigeLogin, exigeEscrita } = require('../meio/auth');
const { inteiro, txt, paginacao } = require('../meio/validar');

const r = express.Router();
r.use(exigeLogin, exigeEscrita('admin', 'atendente'));

const TIPOS = ['vencido', 'aniversario', 'campanha'];
const DESFECHOS = ['sem_resposta', 'respondeu', 'voltou', 'pediu_sair'];
const CARENCIA = +(process.env.AVISO_CARENCIA_DIAS || 30);

/* GET /avisos/fila — quem avisar hoje.
   Já exclui quem foi contatado há pouco e quem pediu para sair. */
r.get('/fila', rota(async (req, res) => {
  const { limite, offset, pagina } = paginacao(req.query);
  const tipo = TIPOS.includes(txt(req.query.tipo)) ? txt(req.query.tipo) : 'vencido';

  const condicao = tipo === 'aniversario'
    ? `c.nasc_mes = MONTH(CURDATE()) AND c.nasc_dia = DAY(CURDATE())`
    : `v.situacao = 'vencido'`;

  const [linhas, [{ total }]] = await Promise.all([
    q(`SELECT v.id AS veiculo_id, v.placa, v.marca, v.modelo, v.ultima_troca, v.ultimo_km,
              v.ultimo_oleo, DATEDIFF(CURDATE(), v.ultima_troca) AS dias,
              c.id AS cliente_id, c.nome AS cliente, c.telefone, c.tel_inferido,
              (SELECT MAX(a.enviado_em) FROM avisos a
                WHERE a.veiculo_id = v.id AND a.tipo = ?) AS ultimo_aviso
       FROM veiculos v JOIN clientes c ON c.id = v.cliente_id
       WHERE ${condicao}
         AND c.telefone IS NOT NULL
         AND c.aceita_aviso = 1
         AND NOT EXISTS (
           SELECT 1 FROM avisos a WHERE a.veiculo_id = v.id
             AND (a.desfecho = 'pediu_sair'
                  OR (a.tipo = ? AND a.enviado_em >= DATE_SUB(NOW(), INTERVAL ? DAY))))
       ORDER BY v.ultima_troca ASC LIMIT ? OFFSET ?`,
      [tipo, tipo, CARENCIA, limite, offset]),
    q(`SELECT COUNT(*) AS total
       FROM veiculos v JOIN clientes c ON c.id = v.cliente_id
       WHERE ${condicao} AND c.telefone IS NOT NULL AND c.aceita_aviso = 1
         AND NOT EXISTS (
           SELECT 1 FROM avisos a WHERE a.veiculo_id = v.id
             AND (a.desfecho = 'pediu_sair'
                  OR (a.tipo = ? AND a.enviado_em >= DATE_SUB(NOW(), INTERVAL ? DAY))))`,
      [tipo, CARENCIA])
  ]);

  // link pronto do WhatsApp, com a mensagem montada a partir dos dados do carro
  const comLink = linhas.map(l => ({
    ...l,
    whatsapp: l.telefone ? montarLink(l, tipo) : null
  }));

  res.json({ total, pagina, limite, tipo, carencia_dias: CARENCIA, fila: comLink });
}));

function montarLink(l, tipo) {
  const primeiro = String(l.cliente || '').split(' ')[0];
  const carro = [l.marca, l.modelo].filter(Boolean).join(' ') || 'seu carro';
  const quando = l.ultima_troca
    ? new Date(l.ultima_troca).toLocaleDateString('pt-BR') : null;

  const texto = tipo === 'aniversario'
    ? `Oi ${primeiro}! Aqui é da Farias Troca de Óleo. Passando para desejar um feliz aniversário!`
    : `Oi ${primeiro}, tudo bem? Aqui é da Farias Troca de Óleo. ` +
      `Vi que a última troca do ${carro}` +
      (quando ? ` foi em ${quando}` : '') +
      (l.ultimo_km ? `, com ${Number(l.ultimo_km).toLocaleString('pt-BR')} km` : '') +
      `. Já passou do intervalo — quer que eu separe um horário?`;

  return `https://wa.me/${l.telefone}?text=${encodeURIComponent(texto)}`;
}

/* POST /avisos — registra que o contato foi feito */
r.post('/', rota(async (req, res) => {
  const veiculo_id = inteiro(req.body?.veiculo_id, 'o veículo', { min: 1 });
  const tipo = txt(req.body?.tipo) || 'vencido';
  if (!TIPOS.includes(tipo)) throw erro400(`Tipo inválido. Use: ${TIPOS.join(', ')}.`);

  const v = await um('SELECT id FROM veiculos WHERE id = ?', [veiculo_id]);
  if (!v) throw erro404('Veículo não encontrado.');

  const ins = await q(
    'INSERT INTO avisos (veiculo_id, tipo, usuario_id) VALUES (?,?,?)',
    [veiculo_id, tipo, req.usuario.id]);
  res.status(201).json({ aviso: { id: ins.insertId, veiculo_id, tipo } });
}));

/* PATCH /avisos/:id — o desfecho, que é o que mede se avisar funciona */
r.patch('/:id', rota(async (req, res) => {
  const id = inteiro(req.params.id, 'o id', { min: 1 });
  const desfecho = txt(req.body?.desfecho);
  if (!DESFECHOS.includes(desfecho))
    throw erro400(`Desfecho inválido. Use: ${DESFECHOS.join(', ')}.`);

  const a = await um('SELECT id, veiculo_id FROM avisos WHERE id = ?', [id]);
  if (!a) throw erro404('Aviso não encontrado.');

  await q('UPDATE avisos SET desfecho = ? WHERE id = ?', [desfecho, id]);

  // "pediu para sair" desliga o aviso para o cliente inteiro, não só para o carro
  if (desfecho === 'pediu_sair')
    await q(`UPDATE clientes c JOIN veiculos v ON v.cliente_id = c.id
             SET c.aceita_aviso = 0 WHERE v.id = ?`, [a.veiculo_id]);

  res.json({ ok: true, id, desfecho });
}));

/* GET /avisos/resultado — avisar deu retorno? */
r.get('/resultado', rota(async (req, res) => {
  const dias = inteiro(req.query.dias, 'o período', { min: 1, max: 365 }) || 90;

  const [[r1]] = [await q(
    `SELECT COUNT(*) enviados,
            SUM(desfecho = 'voltou') voltaram,
            SUM(desfecho = 'respondeu') responderam,
            SUM(desfecho = 'pediu_sair') sairam,
            SUM(desfecho IS NULL) sem_desfecho
     FROM avisos WHERE enviado_em >= DATE_SUB(NOW(), INTERVAL ? DAY)`, [dias])];

  // quem voltou de fato: teve serviço DEPOIS do aviso
  const [[r2]] = [await q(
    `SELECT COUNT(DISTINCT a.veiculo_id) AS retornaram
     FROM avisos a
     JOIN servicos s ON s.veiculo_id = a.veiculo_id AND s.data > DATE(a.enviado_em)
     WHERE a.enviado_em >= DATE_SUB(NOW(), INTERVAL ? DAY)`, [dias])];

  const enviados = Number(r1.enviados || 0);
  res.json({
    periodo_dias: dias,
    enviados,
    retornaram: Number(r2.retornaram || 0),
    taxa_retorno: enviados ? +(100 * r2.retornaram / enviados).toFixed(1) : null,
    responderam: Number(r1.responderam || 0),
    pediram_sair: Number(r1.sairam || 0),
    sem_desfecho: Number(r1.sem_desfecho || 0),
    nota: 'Retorno é medido por serviço registrado depois do aviso, não pelo que foi marcado à mão.'
  });
}));

/* GET /avisos — histórico de um veículo */
r.get('/', rota(async (req, res) => {
  const veiculo_id = inteiro(req.query.veiculo_id, 'o veículo', { min: 1 });
  if (!veiculo_id) throw erro400('Informe veiculo_id.');
  const lista = await q(
    `SELECT a.id, a.tipo, a.enviado_em, a.desfecho, u.nome AS usuario
     FROM avisos a LEFT JOIN usuarios u ON u.id = a.usuario_id
     WHERE a.veiculo_id = ? ORDER BY a.enviado_em DESC`, [veiculo_id]);
  res.json({ veiculo_id, total: lista.length, avisos: lista });
}));

module.exports = r;
