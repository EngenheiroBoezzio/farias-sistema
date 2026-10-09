/* Gestão de usuários pelo administrador master. */
'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { q, um } = require('../db');
const { rota, erro400, erro403, erro404 } = require('../meio/erros');
const { exigeLogin, exigePapel } = require('../meio/auth');
const { txt, exigeTexto, inteiro } = require('../meio/validar');

const r = express.Router();
/* ACHADO DE SEGURANCA (corrigido): aqui estava `exigeEscrita('admin')`, que so
   pede admin nos metodos que gravam. O GET /api/usuarios passava para QUALQUER
   usuario logado — um atendente via a lista inteira da equipe, com nome, login
   e papel de cada um. Isso e reconhecimento pronto para quem roubar a senha de
   um balcao: ja sai sabendo quem e admin e qual login atacar.

   Nenhuma rota deste arquivo e do atendente. O roteador inteiro exige admin,
   inclusive para ler. */
r.use(exigeLogin, exigePapel('admin'));

/* Minimo de senha em UM lugar so. Estava 4 aqui e 8 no /eu e na tela — ou
   seja, a conta que o admin criava para o funcionario aceitava "1234", e
   so a troca de senha depois exigia 8. Senha de equipe e a porta da frente
   do sistema; 8 e o piso em todo lugar agora. */
const MINIMO_SENHA = 8;

/* GET /api/usuarios — lista toda a equipe */
r.get('/', rota(async (_req, res) => {
  const usuarios = await q(
    `SELECT id, username AS usuario, nome, papel, criado_em, ativo
     FROM usuarios WHERE ativo = 1 ORDER BY nome`
  );
  res.json({ usuarios });
}));

/* POST /api/usuarios — cadastra um atendente ou administrador */
r.post('/', rota(async (req, res) => {
  const nome = exigeTexto(req.body?.nome, 'o nome', 80);
  const usuario = txt(req.body?.usuario).toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (!usuario || usuario.length < 3) throw erro400('Nome de usuário deve ter ao menos 3 caracteres.');
  const senha = String(req.body?.senha ?? '');
  if (senha.length < MINIMO_SENHA)
    throw erro400(`A senha deve ter ao menos ${MINIMO_SENHA} caracteres.`);
  const papel = req.body?.papel === 'admin' ? 'admin' : 'atendente';

  const jaExiste = await um('SELECT id FROM usuarios WHERE username = ?', [usuario]);
  if (jaExiste) throw erro400(`O usuário "${usuario}" já existe.`);

  const hash = await bcrypt.hash(senha, 12);
  const ins = await q(
    'INSERT INTO usuarios (username, senha_hash, nome, papel, ativo) VALUES (?,?,?,?,1)',
    [usuario, hash, nome, papel]
  );

  res.status(201).json({
    usuario: { id: ins.insertId, usuario, nome, papel, criado_em: new Date().toISOString() }
  });
}));

/* PATCH /api/usuarios/:id — edita nome, usuário, papel ou senha */
r.patch('/:id', rota(async (req, res) => {
  const id = inteiro(req.params.id, 'o id', { min: 1 });
  const atual = await um('SELECT id, username, nome, papel FROM usuarios WHERE id = ? AND ativo = 1', [id]);
  if (!atual) throw erro404('Usuário não encontrado.');

  const sets = [], vals = [];

  if (req.body?.nome !== undefined) {
    const nome = exigeTexto(req.body.nome, 'o nome', 80);
    sets.push('nome = ?'); vals.push(nome);
  }

  if (req.body?.usuario !== undefined) {
    const usuario = txt(req.body.usuario).toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (!usuario || usuario.length < 3) throw erro400('Nome de usuário deve ter ao menos 3 caracteres.');
    const dup = await um('SELECT id FROM usuarios WHERE username = ? AND id <> ?', [usuario, id]);
    if (dup) throw erro400(`O usuário "${usuario}" já está em uso.`);
    sets.push('username = ?'); vals.push(usuario);
  }

  if (req.body?.papel !== undefined) {
    const papel = req.body.papel === 'admin' ? 'admin' : 'atendente';
    // Protege contra rebaixar o próprio master conectado se for o único admin
    if (req.usuario.id === id && papel !== 'admin') {
      throw erro400('Você não pode revogar seu próprio acesso de administrador.');
    }
    sets.push('papel = ?'); vals.push(papel);
  }

  if (req.body?.senha !== undefined) {
    const senha = String(req.body.senha);
    if (senha.length < MINIMO_SENHA)
      throw erro400(`A senha deve ter ao menos ${MINIMO_SENHA} caracteres.`);
    const hash = await bcrypt.hash(senha, 12);
    sets.push('senha_hash = ?'); vals.push(hash);
    sets.push('token_version = token_version + 1');
  }

  if (!sets.length) throw erro400('Nenhum dado informado para alteração.');

  vals.push(id);
  await q(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`, vals);

  const novo = await um('SELECT id, username AS usuario, nome, papel FROM usuarios WHERE id = ?', [id]);
  res.json({ ok: true, usuario: novo });
}));

/* DELETE /api/usuarios/:id — desativa o usuário */
r.delete('/:id', rota(async (req, res) => {
  const id = inteiro(req.params.id, 'o id', { min: 1 });
  if (req.usuario.id === id) throw erro400('Você não pode remover seu próprio usuário.');

  const u = await um('SELECT id, username FROM usuarios WHERE id = ?', [id]);
  if (!u) throw erro404('Usuário não encontrado.');

  await q('UPDATE usuarios SET ativo = 0, token_version = token_version + 1 WHERE id = ?', [id]);
  res.json({ ok: true, removido: { id, usuario: u.username } });
}));

module.exports = r;
