/* Autenticação em camadas + sessão revogável.
   (Playbook, Segurança 4 e 5.)

   exigeLogin      -> sessão válida e não revogada  · senão 401
   exigePapel(...) -> papel autorizado              · senão 403
   exigeEscrita    -> método que grava pede 'admin' quando a rota pedir
*/
'use strict';
const jwt = require('jsonwebtoken');
const { um } = require('../db');
const { erro401, erro403, rota } = require('./erros');

const SEGREDO = process.env.JWT_SECRET;
const TTL = process.env.SESSAO_TTL || '3d';     // curto de propósito
const COOKIE = 'farias_sessao';

if (!SEGREDO || SEGREDO.length < 32) {
  console.error('\n[fatal] JWT_SECRET ausente ou curto demais (mínimo 32 caracteres).');
  console.error('gere um com: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n');
  process.exit(1);
}

function assinar(usuario) {
  // tv = token_version: o logout incrementa no banco e derruba tokens antigos
  return jwt.sign(
    { sub: usuario.id, u: usuario.username, papel: usuario.papel, tv: usuario.token_version || 0 },
    SEGREDO, { expiresIn: TTL }
  );
}

function opcoesDoCookie() {
  const producao = process.env.NODE_ENV === 'producao';
  return {
    httpOnly: true,                       // JS da página não lê -> XSS não rouba
    secure: producao,                     // só HTTPS em produção
    sameSite: producao ? 'none' : 'lax',  // 'none' exige secure
    maxAge: 3 * 24 * 3600 * 1000,
    path: '/'
  };
}

function tokenDaRequisicao(req) {
  if (req.cookies && req.cookies[COOKIE]) return req.cookies[COOKIE];
  const h = req.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

const exigeLogin = rota(async (req, _res, next) => {
  const token = tokenDaRequisicao(req);
  if (!token) throw erro401();

  let carga;
  try { carga = jwt.verify(token, SEGREDO); }
  catch { throw erro401('Sessão expirada. Entre de novo.'); }

  // a versão da sessão é conferida no banco a cada requisição:
  // é isso que faz o logout valer na hora
  const u = await um(
    'SELECT id, username, nome, papel, token_version, ativo FROM usuarios WHERE id = ?',
    [carga.sub]
  );
  if (!u || !u.ativo) throw erro401('Conta inativa.');
  if (Number(u.token_version) !== Number(carga.tv || 0))
    throw erro401('Sessão encerrada. Entre de novo.');

  req.usuario = { id: u.id, username: u.username, nome: u.nome, papel: u.papel };
  next();
});

const exigePapel = (...papeis) => (req, _res, next) => {
  if (!req.usuario) return next(erro401());
  if (!papeis.includes(req.usuario.papel)) return next(erro403());
  next();
};

/** GET/HEAD passa; qualquer método que grava exige o papel informado. */
const exigeEscrita = (...papeis) => (req, _res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  return exigePapel(...papeis)(req, _res, next);
};

module.exports = { assinar, opcoesDoCookie, exigeLogin, exigePapel, exigeEscrita, COOKIE };
