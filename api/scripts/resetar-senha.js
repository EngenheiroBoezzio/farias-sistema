/* Redefine a senha de um usuário que já existe.
 *
 * Senha esquecida não se recupera: o banco guarda um hash bcrypt de 12
 * rounds, que é caminho de mão única. O que existe é a troca — e é para
 * isso que este script serve.
 *
 *   node scripts/resetar-senha.js                      -> lista as contas, não muda nada
 *   node scripts/resetar-senha.js raissa               -> sorteia uma senha forte e mostra uma vez
 *   node scripts/resetar-senha.js raissa MinhaSenha123 -> define a senha informada
 *
 * Diferente do seed.js, este script NÃO cria conta nova e NÃO mexe no papel.
 * Se o usuário não existir, ele para e mostra a lista — assim um erro de
 * digitação não vira um segundo admin sem ninguém perceber.
 *
 * Trocar a senha incrementa token_version, o que derruba na hora qualquer
 * sessão aberta daquela conta, inclusive a de quem já estava logado.
 */
'use strict';
require('../src/ambiente');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { q, um, pool } = require('../src/db');

const senhaForte = () => crypto.randomBytes(9).toString('base64url');

async function listar() {
  const linhas = await q(
    `SELECT username, nome, papel, ativo, criado_em
       FROM usuarios ORDER BY papel, username`);
  if (!linhas.length) {
    console.log('\nNão há nenhum usuário cadastrado. Use: node scripts/seed.js\n');
    return;
  }
  console.log('\nContas cadastradas:\n');
  console.log('  ' + 'usuário'.padEnd(14) + 'papel'.padEnd(12) + 'situação'.padEnd(10) + 'nome');
  console.log('  ' + '-'.repeat(60));
  for (const u of linhas) {
    console.log('  ' + String(u.username).padEnd(14)
              + String(u.papel).padEnd(12)
              + (u.ativo ? 'ativa' : 'DESATIVADA').padEnd(10)
              + u.nome);
  }
  console.log('\nPara trocar uma senha:  node scripts/resetar-senha.js <usuário>\n');
}

(async () => {
  const [, , userArg, senhaArg] = process.argv;

  if (!userArg) { await listar(); return; }

  const username = String(userArg).trim().toLowerCase();
  const alvo = await um('SELECT id, username, nome, papel, ativo FROM usuarios WHERE username = ?',
                        [username]);

  if (!alvo) {
    console.error(`\nNão existe usuário "${username}". Este script não cria contas.`);
    await listar();
    process.exitCode = 1;
    return;
  }

  const senha = senhaArg ? String(senhaArg) : senhaForte();
  if (senha.length < 8) {
    console.error('\nA senha precisa de ao menos 8 caracteres.\n');
    process.exitCode = 1;
    return;
  }

  const hash = await bcrypt.hash(senha, 12);
  await q('UPDATE usuarios SET senha_hash = ?, token_version = token_version + 1 WHERE id = ?',
          [hash, alvo.id]);

  console.log(`\nSenha trocada para ${alvo.nome} (${alvo.username}, ${alvo.papel}).`);
  console.log('\n  ANOTE AGORA — não aparece de novo:\n');
  console.log(`      usuário: ${alvo.username}`);
  console.log(`      senha:   ${senha}\n`);
  if (!alvo.ativo) {
    console.log('  Atenção: esta conta está DESATIVADA. A senha nova só serve depois de reativá-la.\n');
  }
  console.log('  As sessões abertas dessa conta caíram agora. Quem estiver usando');
  console.log('  o sistema com ela vai precisar entrar de novo.\n');
})()
  .catch(e => { console.error('\nFalhou: ' + e.message + '\n'); process.exitCode = 1; })
  .finally(() => pool.end());
