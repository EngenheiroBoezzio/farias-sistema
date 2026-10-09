/* Login, logout e perfil.
   O /eu NUNCA aceita campo de privilégio — senão o usuário se autopromove.
   (Playbook, Segurança 4, armadilha "escalada por campo".) */
'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { q, um } = require('../db');
const { rota, erro400, erro401 } = require('../meio/erros');
const { exigeLogin, assinar, opcoesDoCookie, COOKIE } = require('../meio/auth');
const { txt, exigeTexto } = require('../meio/validar');

const r = express.Router();

r.post('/login', rota(async (req, res) => {
  const usuario = txt(req.body?.usuario).toLowerCase();
  const senha = String(req.body?.senha ?? '');
  if (!usuario || !senha) throw erro400('Informe usuário e senha.');

  const u = await um(
    'SELECT id, username, nome, papel, senha_hash, token_version, ativo FROM usuarios WHERE username = ?',
    [usuario]
  );

  // mesma mensagem e mesmo custo para usuário inexistente e senha errada:
  // não conta ao atacante quais usuários existem
  const hashFalso = '$2a$12$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQR';
  const confere = await bcrypt.compare(senha, u ? u.senha_hash : hashFalso);
  if (!u || !u.ativo || !confere) throw erro401('Usuário ou senha não conferem.');

  const token = assinar(u);
  res.cookie(COOKIE, token, opcoesDoCookie());
  res.json({
    usuario: { id: u.id, username: u.username, nome: u.nome, papel: u.papel },
    token   // para clientes que não usam cookie (app móvel)
  });
}));

r.post('/logout', exigeLogin, rota(async (req, res) => {
  // incrementa a versão: todo token emitido antes para de valer agora
  await q('UPDATE usuarios SET token_version = token_version + 1 WHERE id = ?', [req.usuario.id]);
  res.clearCookie(COOKIE, { ...opcoesDoCookie(), maxAge: undefined });
  res.json({ ok: true });
}));

r.get('/eu', exigeLogin, (req, res) => res.json({ usuario: req.usuario }));

r.patch('/eu', exigeLogin, rota(async (req, res) => {
  // lista branca curta: papel, ativo e token_version JAMAIS entram aqui
  const nome = req.body?.nome !== undefined ? exigeTexto(req.body.nome, 'o nome', 80) : null;
  const novaSenha = req.body?.nova_senha;

  if (nome) await q('UPDATE usuarios SET nome = ? WHERE id = ?', [nome, req.usuario.id]);

  if (novaSenha !== undefined) {
    const atual = String(req.body?.senha_atual ?? '');
    if (String(novaSenha).length < 8) throw erro400('A nova senha precisa de ao menos 8 caracteres.');
    const u = await um('SELECT senha_hash FROM usuarios WHERE id = ?', [req.usuario.id]);
    if (!await bcrypt.compare(atual, u.senha_hash)) throw erro401('A senha atual não confere.');
    const hash = await bcrypt.hash(String(novaSenha), 12);
    // trocar a senha também derruba as outras sessões
    await q('UPDATE usuarios SET senha_hash = ?, token_version = token_version + 1 WHERE id = ?',
            [hash, req.usuario.id]);
    res.clearCookie(COOKIE, { ...opcoesDoCookie(), maxAge: undefined });
    return res.json({ ok: true, aviso: 'Senha trocada. Entre de novo.' });
  }

  const u = await um('SELECT id, username, nome, papel FROM usuarios WHERE id = ?', [req.usuario.id]);
  res.json({ usuario: u });
}));

module.exports = r;
