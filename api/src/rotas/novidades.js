/* Novidades — o "o que mudou" que a equipe vê no sino.
 *
 * Ler e marcar como visto: qualquer um logado (é o aviso da própria pessoa).
 * Publicar e apagar: só admin — é o Pedro anunciando a atualização.
 *
 * O "não lido" é POR USUÁRIO, via usuarios.novidades_visto_em: uma novidade
 * conta como não lida para quem não abriu o sino desde que ela foi publicada.
 * Assim a Raíssa abrir num computador não apaga a bolinha dos pais no outro.
 */
'use strict';
const express = require('express');
const { q, um } = require('../db');
const { rota, erro400, erro404 } = require('../meio/erros');
const { exigeLogin, exigePapel } = require('../meio/auth');
const { exigeTexto, textoAte, inteiro, paginacao } = require('../meio/validar');

const r = express.Router();
r.use(exigeLogin);

/* Quantas novidades listar por vez. O sino mostra as recentes; o histórico
   inteiro é raro de precisar e pagina. */
const LIMITE_SINO = 20;

/* GET /api/novidades — a lista, e quantas esta pessoa ainda não viu. */
r.get('/', rota(async (req, res) => {
  const { limite, offset } = paginacao(req.query);
  const lim = limite || LIMITE_SINO;

  const [lista, [cont], usuario] = await Promise.all([
    q(`SELECT id, versao, titulo, corpo, a_pedido, destaque, publicada_em, criada_por
         FROM novidades
        ORDER BY destaque DESC, publicada_em DESC
        LIMIT ? OFFSET ?`, [lim, offset]),
    /* Não lidas = publicadas depois do último "visto" desta pessoa.
       Quem nunca abriu (visto_em NULL) vê tudo como novo. */
    q(`SELECT COUNT(*) AS nao_lidas
         FROM novidades n
         JOIN usuarios u ON u.id = ?
        WHERE u.novidades_visto_em IS NULL
           OR n.publicada_em > u.novidades_visto_em`, [req.usuario.id]),
    um('SELECT novidades_visto_em FROM usuarios WHERE id = ?', [req.usuario.id])
  ]);

  const visto = usuario?.novidades_visto_em;
  /* Marca cada item com "é novo para mim", para o sino destacar sem ter que
     repetir a conta de data no front. */
  const comFlag = lista.map(n => ({
    ...n,
    a_pedido: !!n.a_pedido,
    destaque: !!n.destaque,
    nova: !visto || new Date(n.publicada_em) > new Date(visto)
  }));

  res.json({ nao_lidas: Number(cont.nao_lidas || 0), novidades: comFlag });
}));

/* POST /api/novidades/visto — carimba que esta pessoa viu tudo até agora.
   É o que zera a bolinha, só para ela. */
r.post('/visto', rota(async (req, res) => {
  await q('UPDATE usuarios SET novidades_visto_em = NOW() WHERE id = ?', [req.usuario.id]);
  res.json({ ok: true });
}));

/* POST /api/novidades — publica uma novidade. Só admin. */
r.post('/', exigePapel('admin'), rota(async (req, res) => {
  const titulo = exigeTexto(req.body?.titulo, 'o título', 140);
  const corpo = exigeTexto(req.body?.corpo, 'o que mudou', 4000, 1);
  const versao = textoAte(req.body?.versao, 'a versão', 20) || null;
  const aPedido = req.body?.a_pedido ? 1 : 0;
  const destaque = req.body?.destaque ? 1 : 0;

  const ins = await q(
    `INSERT INTO novidades (versao, titulo, corpo, a_pedido, destaque, criada_por)
     VALUES (?,?,?,?,?,?)`,
    [versao, titulo, corpo, aPedido, destaque, req.usuario.username]);

  const nova = await um('SELECT * FROM novidades WHERE id = ?', [ins.insertId]);
  res.status(201).json({ novidade: nova });
}));

/* PATCH /api/novidades/:id — corrigir um erro de digitação. Só admin. */
r.patch('/:id', exigePapel('admin'), rota(async (req, res) => {
  const id = inteiro(req.params.id, 'o id', { min: 1 });
  const atual = await um('SELECT id FROM novidades WHERE id = ?', [id]);
  if (!atual) throw erro404('Novidade não encontrada.');

  const sets = [], vals = [];
  if (req.body?.titulo !== undefined) {
    sets.push('titulo = ?'); vals.push(exigeTexto(req.body.titulo, 'o título', 140));
  }
  if (req.body?.corpo !== undefined) {
    sets.push('corpo = ?'); vals.push(exigeTexto(req.body.corpo, 'o que mudou', 4000, 1));
  }
  if (req.body?.versao !== undefined) {
    sets.push('versao = ?'); vals.push(textoAte(req.body.versao, 'a versão', 20) || null);
  }
  if (req.body?.a_pedido !== undefined) { sets.push('a_pedido = ?'); vals.push(req.body.a_pedido ? 1 : 0); }
  if (req.body?.destaque !== undefined) { sets.push('destaque = ?'); vals.push(req.body.destaque ? 1 : 0); }
  if (!sets.length) throw erro400('Nada para alterar.');

  vals.push(id);
  await q(`UPDATE novidades SET ${sets.join(', ')} WHERE id = ?`, vals);
  res.json({ novidade: await um('SELECT * FROM novidades WHERE id = ?', [id]) });
}));

/* DELETE /api/novidades/:id — apagar uma novidade. Só admin. */
r.delete('/:id', exigePapel('admin'), rota(async (req, res) => {
  const id = inteiro(req.params.id, 'o id', { min: 1 });
  const n = await um('SELECT id FROM novidades WHERE id = ?', [id]);
  if (!n) throw erro404('Novidade não encontrada.');
  await q('DELETE FROM novidades WHERE id = ?', [id]);
  res.json({ ok: true, removida: id });
}));

module.exports = r;
