/* A lista de preços da oficina: quanto custa comprar, quanto se cobra.
 *
 * Ler: qualquer um logado. A decisão foi essa de propósito — o balcão vê o
 * custo enquanto monta a ordem, e assim não vende abaixo do que pagou.
 * Gravar: só admin. Mexer no custo é decisão de quem compra.
 *
 * A CHAVE É SEMPRE MAIÚSCULA. É por ela que a ordem encontra o item, e o
 * balcão digita "5w30 mob" hoje e "5W30 MOB" amanhã. Normalizar na entrada
 * evita a lista virar dois itens que são o mesmo óleo com margens diferentes.
 */
'use strict';
const express = require('express');
const { q, um } = require('../db');
const { rota, erro400, erro404 } = require('../meio/erros');
const { exigeLogin, exigePapel } = require('../meio/auth');
const { txt, textoAte, decimal, inteiro } = require('../meio/validar');

const r = express.Router();

const TIPOS = ['oleo', 'filtro_oleo', 'filtro_ar', 'filtro_cabine', 'filtro_combustivel'];
const UNIDADES = ['litro', 'peca'];

/** Óleo se compra por litro; filtro, por peça. A unidade segue o tipo, e não
 *  o que o cliente mandar: um filtro "por litro" não existe no mundo real. */
const unidadeDoTipo = tipo => (tipo === 'oleo' ? 'litro' : 'peca');

function validarTipo(v) {
  const t = txt(v).toLowerCase();
  if (!TIPOS.includes(t))
    throw erro400(`Tipo inválido. Use um destes: ${TIPOS.join(', ')}.`);
  return t;
}

function validarChave(v) {
  const s = txt(v).toUpperCase();
  if (!s) throw erro400('Informe o óleo ou o código do filtro.');
  if (s.length > 40) throw erro400(`Passa de 40 caracteres. Digitou ${s.length}.`);
  return s;
}

/* GET /precos — a lista inteira, ou de um tipo só. */
r.get('/', exigeLogin, rota(async (req, res) => {
  const tipo = req.query.tipo ? validarTipo(req.query.tipo) : null;
  const todos = String(req.query.todos || '') === '1';

  const onde = [];
  const p = [];
  if (tipo) { onde.push('tipo = ?'); p.push(tipo); }
  if (!todos) onde.push('ativo = 1');

  const itens = await q(
    `SELECT id, tipo, chave, descricao, unidade, custo, venda, ativo,
            atualizado_em, atualizado_por
       FROM precos_itens
      ${onde.length ? 'WHERE ' + onde.join(' AND ') : ''}
      ORDER BY tipo, chave`, p);

  res.json({ itens, total: itens.length });
}));

/* GET /precos/buscar — o que a ordem chama: o custo de um item específico.
   Devolve 200 com item: null quando não há cadastro, e NÃO 404: "este óleo
   ainda não tem custo" é resposta normal, não erro. A tela precisa saber a
   diferença entre "não cadastrado" e "o servidor falhou". */
r.get('/buscar', exigeLogin, rota(async (req, res) => {
  const tipo = validarTipo(req.query.tipo);
  const chave = validarChave(req.query.chave);
  const item = await um(
    `SELECT id, tipo, chave, descricao, unidade, custo, venda
       FROM precos_itens WHERE tipo = ? AND chave = ? AND ativo = 1`,
    [tipo, chave]);
  res.json({ item: item || null });
}));

/* POST /precos — cadastra ou atualiza pelo par (tipo, chave). */
r.post('/', exigeLogin, exigePapel('admin'), rota(async (req, res) => {
  const c = req.body || {};
  const tipo = validarTipo(c.tipo);
  const chave = validarChave(c.chave);
  const descricao = textoAte(c.descricao, 'a descrição', 80);
  const custo = decimal(c.custo, 'o custo', { min: 0, max: 99999 });
  const venda = decimal(c.venda, 'o preço de venda', { min: 0, max: 99999 });
  const unidade = unidadeDoTipo(tipo);

  /* Vender abaixo do custo é quase sempre erro de digitação — dois zeros a
     menos no preço. Recusar seria pior: promoção e queima de estoque
     existem. Então a API grava e DEVOLVE o aviso, e quem decide é a tela. */
  const aviso = (custo != null && venda != null && venda < custo)
    ? `O preço de venda (${venda}) está abaixo do custo (${custo}). Confira se não faltou um dígito.`
    : null;

  await q(
    `INSERT INTO precos_itens (tipo, chave, descricao, unidade, custo, venda, atualizado_por)
     VALUES (?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       descricao = VALUES(descricao), unidade = VALUES(unidade),
       custo = VALUES(custo), venda = VALUES(venda),
       ativo = 1, atualizado_por = VALUES(atualizado_por)`,
    [tipo, chave, descricao, unidade, custo, venda, req.usuario.username]);

  const item = await um(
    `SELECT id, tipo, chave, descricao, unidade, custo, venda, ativo,
            atualizado_em, atualizado_por
       FROM precos_itens WHERE tipo = ? AND chave = ?`, [tipo, chave]);
  res.json({ item, aviso });
}));

/* DELETE /precos/:id — desativa, não apaga.
   As ordens antigas guardam a própria cópia do custo, então apagar a linha
   não estragaria relatório nenhum. Ainda assim some o histórico de quanto a
   oficina pagava por aquele filtro — e isso é a única memória de preço que
   existe aqui. */
r.delete('/:id', exigeLogin, exigePapel('admin'), rota(async (req, res) => {
  const id = inteiro(req.params.id, 'o id', { min: 1 });
  const item = await um('SELECT id FROM precos_itens WHERE id = ?', [id]);
  if (!item) throw erro404('Item não encontrado.');
  await q('UPDATE precos_itens SET ativo = 0, atualizado_por = ? WHERE id = ?',
          [req.usuario.username, id]);
  res.json({ ok: true, desativado: id });
}));

module.exports = { rotas: r, TIPOS, unidadeDoTipo, validarTipo, validarChave };
