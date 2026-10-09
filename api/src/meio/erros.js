/* Erros com status + handler central que NUNCA vaza detalhe do banco.
   (Playbook, Segurança 1 e 2.) */
'use strict';

function erroComStatus(msg, status) {
  const e = new Error(msg);
  e.status = status;
  e.publico = true;              // mensagem foi escrita para o usuário ler
  return e;
}
const erro400 = m => erroComStatus(m, 400);
const erro401 = m => erroComStatus(m || 'Faça login para continuar.', 401);
const erro403 = m => erroComStatus(m || 'Você não tem acesso a isso.', 403);
const erro404 = m => erroComStatus(m || 'Não encontrado.', 404);
const erro409 = m => erroComStatus(m || 'Conflito com um registro existente.', 409);

/** Envolve rota async: erro cai no handler central em vez de derrubar o processo. */
const rota = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function handlerDeErro(err, req, res, _next) {
  // o detalhe completo fica no log do servidor, nunca na resposta
  console.error('[erro]', req.method, req.originalUrl, '·', err.message);
  if (process.env.NODE_ENV !== 'producao' && err.stack) console.error(err.stack);

  const ehBanco = err && (String(err.code || '').startsWith('ER_') ||
                          err.sqlMessage || err.code === 'PROTOCOL_SEQUENCE_TIMEOUT');
  if (ehBanco) {
    const tempo = err.code === 'PROTOCOL_SEQUENCE_TIMEOUT';
    return res.status(tempo ? 504 : 400).json({
      erro: tempo ? 'A consulta demorou demais. Tente de novo.' : 'Confira os dados enviados.'
    });
  }
  if (err && err.type === 'entity.parse.failed')
    return res.status(400).json({ erro: 'Corpo da requisição não é um JSON válido.' });

  const status = err.status || 500;
  res.status(status).json({
    erro: status < 500 && err.publico ? err.message : 'Erro interno.'
  });
}

module.exports = { erroComStatus, erro400, erro401, erro403, erro404, erro409, rota, handlerDeErro };
