/* Configurações da loja — as que a oficina muda sozinha.
 *
 * Só chave PÚBLICA mora aqui. Qualquer atendente logado lê esta rota, então
 * segredo (JWT_SECRET, senha do banco, chave de provedor de IA) continua no
 * .env do servidor e nunca passa por esta tabela. A lista branca abaixo é o
 * que impede isso de escorregar com o tempo: chave fora dela não é lida nem
 * gravada, mesmo que alguém a insira no banco à mão.
 *
 * Ler: qualquer um logado — o balcão precisa do nome e do link do canal.
 * Gravar: só admin. Trocar o canal da oficina não é decisão de atendente.
 */
'use strict';
const express = require('express');
const { q } = require('../db');
const { rota, erro400 } = require('../meio/erros');
const { exigeLogin, exigePapel } = require('../meio/auth');
const { txt } = require('../meio/validar');

const r = express.Router();

/* chave -> como validar. Acrescentar chave aqui é o único jeito de ela
   existir na API. */
const PERMITIDAS = {
  nomeLoja: v => {
    const s = txt(v);
    if (!s) throw erro400('O nome da loja não pode ficar vazio.');
    if (s.length > 60) throw erro400(`O nome da loja passa de 60 caracteres. Digitou ${s.length}.`);
    return s;
  },
  canalWhatsapp: v => {
    const s = txt(v);
    if (!s) return '';                       // vazio = canal ainda não existe
    if (s.length > 300) throw erro400('O link do canal passa de 300 caracteres.');
    /* https e só https. Este valor volta para a tela e vira href e
       window.open: aceitar "javascript:" ou "data:" aqui seria entregar
       execução de script a quem conseguisse gravar uma vez. E http puro num
       link que a oficina manda para cliente não tem por que existir. */
    if (!/^https:\/\/[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s))
      throw erro400('O link do canal precisa começar com https:// e ter um endereço válido.');
    return s;
  },
  diaVencimento: v => {
    const n = parseInt(v, 10);
    if (!n || n < 1 || n > 31) return '10';
    return String(n);
  },
  linkPagamento: v => {
    const s = txt(v);
    if (!s) return '';
    if (s.length > 400) throw erro400('O link de pagamento passa de 400 caracteres.');
    return s;
  },
  ultimoMesPago: v => {
    const s = txt(v);
    if (!s) return '';
    return s.slice(0, 10);
  }
};
const CHAVES = Object.keys(PERMITIDAS);

const ehPermitida = c => Object.prototype.hasOwnProperty.call(PERMITIDAS, c);

/** Lê o banco e devolve SEMPRE todas as chaves, mesmo as que faltarem lá.
 *  Chave a mais no banco é ignorada; chave a menos volta vazia. Assim a tela
 *  nunca recebe um objeto com forma diferente do que espera. */
async function lerTudo() {
  const marcas = CHAVES.map(() => '?').join(', ');
  const linhas = await q(
    `SELECT chave, valor FROM configuracoes WHERE chave IN (${marcas})`, CHAVES);
  const saida = {};
  for (const k of CHAVES) saida[k] = '';
  for (const l of linhas) if (ehPermitida(l.chave)) saida[l.chave] = l.valor;
  if (!saida.diaVencimento) saida.diaVencimento = '10';
  return saida;
}

/* GET /api/config */
r.get('/', exigeLogin, rota(async (_req, res) => {
  res.json({ config: await lerTudo() });
}));

/* PUT /api/config — grava só o que veio, e só o que está na lista branca. */
r.put('/', exigeLogin, rota(async (req, res) => {
  const corpo = req.body || {};
  const ehAdmin = req.usuario.papel === 'admin';

  if ((corpo.nomeLoja !== undefined || corpo.linkPagamento !== undefined || corpo.canalWhatsapp !== undefined) && !ehAdmin) {
    throw erro400('Apenas o administrador pode alterar o nome da loja, canal ou link de pagamento.');
  }

  const gravar = [];
  for (const chave of CHAVES)
    if (corpo[chave] !== undefined) gravar.push([chave, PERMITIDAS[chave](corpo[chave])]);

  if (!gravar.length) throw erro400('Nada para gravar.');

  for (const [chave, valor] of gravar) {
    await q(
      `INSERT INTO configuracoes (chave, valor, alterado_por) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE valor = VALUES(valor), alterado_por = VALUES(alterado_por)`,
      [chave, valor, req.usuario.username]);
  }

  res.json({ config: await lerTudo() });
}));

module.exports = r;
