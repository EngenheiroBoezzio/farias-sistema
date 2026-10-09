/* Validação na BORDA, com lista branca de campos.
   Nada chega ao banco sem passar por aqui. (Playbook, Segurança 1 e 3.) */
'use strict';
const { erro400 } = require('./erros');

const txt = v => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Mantém só as chaves permitidas — mata mass assignment na entrada. */
function somente(corpo, permitidas) {
  const saida = {};
  for (const k of permitidas) if (corpo && corpo[k] !== undefined) saida[k] = corpo[k];
  return saida;
}

function exigeTexto(v, campo, max = 120, min = 1) {
  const s = txt(v);
  if (!s) throw erro400(`Informe ${campo}.`);
  if (s.length < min) throw erro400(`${campo} precisa ter ao menos ${min} caracteres.`);
  if (s.length > max) throw erro400(`${campo} passa de ${max} caracteres.`);
  return s;
}

/* Texto opcional com teto REAL: passou do limite, devolve 400.
   Cortar em silêncio com .slice() é pior do que recusar — quem digitou
   "MANN W 712/95 (motor 1.6 16v)" acha que gravou inteiro e não gravou. */
function textoAte(v, campo, max) {
  const s = txt(v);
  if (!s) return null;
  if (s.length > max)
    throw erro400(`${campo} passa de ${max} caracteres. Digitou ${s.length}.`);
  return s;
}

function placaValida(v) {
  const p = txt(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p))
    throw erro400('Placa inválida. Use o formato ABC1D23 ou ABC1234.');
  return p;
}

function telefoneValido(v) {
  if (v == null || v === '') return null;
  const d = String(v).replace(/\D/g, '');
  const n = d.startsWith('55') && d.length >= 12 ? d : '55' + d;
  if (n.length !== 13 || n[4] !== '9')
    throw erro400('Telefone inválido. Use DDD + 9 dígitos, ex.: 55 99999-9999.');
  return n;
}

function dataValida(v, campo = 'a data') {
  if (v == null || v === '') return null;
  const s = txt(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw erro400(`Informe ${campo} no formato AAAA-MM-DD.`);
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d)) throw erro400(`${campo} não existe no calendário.`);
  return s;
}

function inteiro(v, campo, { min = 0, max = 9999999 } = {}) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n)) throw erro400(`${campo} precisa ser um número inteiro.`);
  if (n < min || n > max) throw erro400(`${campo} precisa estar entre ${min} e ${max}.`);
  return n;
}

function decimal(v, campo, { min = 0, max = 99999 } = {}) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw erro400(`${campo} precisa ser um número.`);
  if (n < min || n > max) throw erro400(`${campo} precisa estar entre ${min} e ${max}.`);
  return Math.round(n * 100) / 100;
}

/** Paginação com teto: ninguém pede 1 milhão de linhas. */
function paginacao(query) {
  const limite = Math.min(Math.max(parseInt(query.limite, 10) || 50, 1), 200);
  const pagina = Math.max(parseInt(query.pagina, 10) || 1, 1);
  return { limite, offset: (pagina - 1) * limite, pagina };
}

/** Só aceita nomes de coluna de uma lista fechada — ORDER BY nunca vem do cliente cru. */
function ordenacao(query, permitidas, padrao) {
  const campo = permitidas.includes(query.ordenar) ? query.ordenar : padrao;
  const dir = String(query.dir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return { campo, dir };
}

module.exports = {
  txt, somente, exigeTexto, textoAte, placaValida, telefoneValido,
  dataValida, inteiro, decimal, paginacao, ordenacao
};
