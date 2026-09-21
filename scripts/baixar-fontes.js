/* Baixa as fontes e guarda dentro do app, para a oficina não depender de
   internet para ter tipografia.
   Rode UMA vez, numa máquina com rede:  node scripts/baixar-fontes.js */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const DESTINO = path.join(__dirname, '..', 'public', 'assets', 'fontes');
const CSS = 'https://fonts.googleapis.com/css2?' +
  'family=Schibsted+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap';
// user-agent moderno faz o Google devolver woff2, que é menor
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const pegar = url => new Promise((ok, falha) => {
  https.get(url, { headers: { 'user-agent': UA } }, r => {
    if (r.statusCode !== 200) return falha(new Error(`${url} devolveu ${r.statusCode}`));
    const p = [];
    r.on('data', d => p.push(d));
    r.on('end', () => ok(Buffer.concat(p)));
  }).on('error', falha);
});

(async () => {
  fs.mkdirSync(DESTINO, { recursive: true });
  console.log('buscando a folha de estilo das fontes…');
  let css = (await pegar(CSS)).toString('utf8');

  const urls = [...new Set([...css.matchAll(/url\((https:\/\/[^)]+)\)/g)].map(m => m[1]))];
  console.log(`${urls.length} arquivos de fonte`);

  for (const u of urls) {
    const nome = path.basename(new URL(u).pathname).replace(/[^\w.-]/g, '_');
    const dados = await pegar(u);
    fs.writeFileSync(path.join(DESTINO, nome), dados);
    css = css.split(u).join(`./${nome}`);
    console.log(`  ${nome} · ${(dados.length / 1024).toFixed(0)} KB`);
  }

  fs.writeFileSync(path.join(DESTINO, 'fontes.css'), css);
  console.log(`\npronto em ${DESTINO}`);
  console.log('Agora acrescente em src/styles.css, na primeira linha:');
  console.log('  @import url("assets/fontes/fontes.css");');
})().catch(e => {
  console.error('\nfalhou:', e.message);
  console.error('Sem as fontes o app ainda funciona — cai em system-ui.');
  process.exit(1);
});
