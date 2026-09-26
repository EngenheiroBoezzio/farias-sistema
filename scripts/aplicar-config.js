/* Leva configuracao.json para dentro do que vai ser compilado.
 *
 * Roda antes do `ng build`, sempre. Existe por um motivo específico: quando a
 * API é hospedada pelo fornecedor, o endereço dela vira parte do executável, e
 * um executável com o endereço errado só aparece na máquina da oficina, depois
 * de instalado, com o cliente na frente. Então este script RECUSA compilar
 * quando a configuração não faz sentido, em vez de gerar um instalador quebrado.
 *
 *   node scripts/aplicar-config.js              (usa configuracao.json)
 *   node scripts/aplicar-config.js --conferir   (só valida, não grava)
 *   node scripts/aplicar-config.js --servidor   (build que a própria API serve)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ORIGEM = path.join(RAIZ, 'configuracao.json');
const DESTINO = path.join(RAIZ, 'public', 'config.json');
const SO_CONFERIR = process.argv.includes('--conferir');
/* Modo servidor: este build é o que a API entrega na porta dela. Aí não há
   endereço para configurar — a tela fala com quem a serviu — e configuracao.json
   nem é lido, porque ele descreve o executável do balcão, que é outra coisa. */
const MODO_SERVIDOR = process.argv.includes('--servidor');

const erros = [];
const avisos = [];

function parar() {
  console.error('\n  Não vou compilar com esta configuração:\n');
  for (const e of erros) console.error(`    [X] ${e}`);
  console.error(`\n  Arquivo: ${ORIGEM}\n`);
  process.exit(1);
}

/* ---------- as dependências instaladas batem com o projeto? ----------

   Erro real de uma máquina Windows: `npm install` numa pasta que já tinha um
   node_modules de outra versão montou uma árvore misturada — Angular novo com
   o TypeScript do projeto — e o build morreu com "The Angular Compiler
   requires TypeScript >=5.9.0 and <6.1.0 but 5.5.4 was found instead". A
   mensagem fala de TypeScript, mas o problema é o Angular estar fora do lugar,
   e isso manda a pessoa mexer na versão errada.

   Como este script roda antes de todo build, o aviso sai aqui, em português, e
   dizendo o comando que resolve. */
function conferirDependencias() {
  const versao = m => {
    try { return require(`${m}/package.json`).version; } catch { return null; }
  };

  const ts = versao('typescript');
  const ng = versao('@angular/core');
  const cc = versao('@angular/compiler-cli');

  if (!ts || !ng) {
    console.error('\n  As dependências não estão instaladas.');
    console.error('  Rode:  npm ci\n');
    process.exit(1);
  }

  const maiorNg = +String(ng).split('.')[0];
  const maiorCc = cc ? +String(cc).split('.')[0] : maiorNg;
  const alvo = +String(
    JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'))
      .dependencies['@angular/core']).replace(/[^\d.]/g, '').split('.')[0];

  /* O sintoma que apareceu: compilador e runtime do Angular em versões
     diferentes. Um só deles sobe de major e o build quebra reclamando de
     TypeScript. */
  if (cc && maiorCc !== maiorNg) {
    console.error('\n  O Angular instalado está inconsistente:\n');
    console.error(`    @angular/core         ${ng}`);
    console.error(`    @angular/compiler-cli ${cc}`);
    console.error('\n  Isso acontece quando o node_modules foi montado com');
    console.error('  `npm install` por cima de uma instalação antiga.');
    console.error('\n  Rode:  npm ci');
    console.error('  (apaga o node_modules e instala exatamente o package-lock.json)\n');
    process.exit(1);
  }

  if (Number.isFinite(alvo) && maiorNg !== alvo) {
    console.error(`\n  Este projeto é Angular ${alvo}, mas o instalado é ${ng}.`);
    console.error('\n  Rode:  npm ci\n');
    process.exit(1);
  }

  console.log(`  Angular ${ng} · TypeScript ${ts}`);

  /* O electron-builder avisa "default Electron icon is used" numa linha só,
     no meio de cem — e o cliente recebe um programa com a logo do Electron.
     O aviso sai aqui, onde dá para ver. */
  if (!fs.existsSync(path.join(RAIZ, 'build', 'icone.ico')))
    avisos.push('build/icone.ico não existe — o executável sairá com o ícone ' +
                'padrão do Electron.\n        Ponha a logo em build/icone.png ' +
                '(256x256) e rode:  npm run icone');
}

conferirDependencias();

/* ---------- a versão, escrita onde o Angular consegue ler ----------

   O rodapé do login mostrava "v1.0.8" porque alguém digitou ali, e o
   package.json já ia na 1.0.11. Número de versão errado manda o suporte
   procurar problema na instalação errada, então ele deixa de ser digitado:
   sai daqui, do package.json, a cada build. */
function gravarVersao() {
  const versao = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8')).version;
  const destino = path.join(RAIZ, 'src', 'app', 'nucleo', 'versao.ts');
  const conteudo =
    `/* GERADO. Não edite à mão.\n` +
    ` *\n` +
    ` * Escrito por scripts/aplicar-config.js a partir do package.json, antes de\n` +
    ` * cada build. Existe porque a versão estava digitada no rodapé do login e\n` +
    ` * marcava 1.0.8 enquanto o pacote já ia na 1.0.11 — um número errado no\n` +
    ` * rodapé é a primeira coisa que faz o suporte procurar problema no lugar\n` +
    ` * errado. O valor abaixo é só o que fica no repositório entre um build e\n` +
    ` * outro; quem manda é o package.json. */\n` +
    `export const VERSAO = '${versao}';\n`;

  /* Só grava se mudou: reescrever o arquivo a cada build faz o `ng build
     --watch` recompilar em laço. */
  let atual = null;
  try { atual = fs.readFileSync(destino, 'utf8'); } catch {}
  if (atual !== conteudo) {
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, conteudo, 'utf8');
  }
  console.log(`  versão no rodapé: ${versao}`);
}

gravarVersao();

if (MODO_SERVIDOR) {
  const saidaS = {
    apiUrl: 'mesma-origem',
    nomeLoja: 'Farias Troca de Óleo',
    canalWhatsapp: '',
    travado: true,
    _gerado: 'Build servido pela própria API (scripts/aplicar-config.js --servidor).'
  };
  if (!SO_CONFERIR) {
    fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
    fs.writeFileSync(DESTINO, JSON.stringify(saidaS, null, 2) + '\n', 'utf8');
  }
  console.log('\n  Build para a própria API servir: apiUrl = mesma-origem\n');
  process.exit(0);
}

if (!fs.existsSync(ORIGEM)) {
  erros.push('configuracao.json não existe.');
  parar();
}

let c;
try {
  c = JSON.parse(fs.readFileSync(ORIGEM, 'utf8'));
} catch (e) {
  erros.push(`configuracao.json não é um JSON válido: ${e.message}`);
  parar();
}

const travado = c.travado === true;
const url = String(c.apiUrl || '').trim();

/* ---------- as regras ---------- */

if (!url) {
  erros.push('apiUrl está vazio.');
} else if (url !== 'mesma-origem') {
  if (!/^https?:\/\//i.test(url))
    erros.push(`apiUrl precisa começar com http:// ou https:// — está "${url}".`);
  else {
    try { new URL(url); }
    catch { erros.push(`apiUrl não é um endereço válido: "${url}".`); }
  }

  /* O erro que custa caro: compilar travado apontando para a própria máquina
     de quem compilou. Instala na oficina e nenhuma tela abre, porque
     localhost lá é o computador do balcão, não o servidor. */
  if (travado && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url))
    erros.push(
      `apiUrl aponta para ${url}, que na máquina da oficina é o computador ` +
      'do próprio balcão — não o seu servidor.\n' +
      '        Ponha o endereço público da API antes de compilar.');

  if (travado && /^http:\/\//i.test(url) && !/^https?:\/\/(\d{1,3}\.){3}\d{1,3}(:|\/|$)/.test(url))
    avisos.push(
      `apiUrl usa http:// sem criptografia num domínio (${url}). ` +
      'Na rede local tudo bem; saindo para a internet, senha e dados dos ' +
      'clientes viajam abertos. Prefira https://.');

  /* Domínio COM porta fora do padrão.
     Aconteceu de verdade: API na 6520, domínio atrás da Cloudflare, navegador
     abrindo normal e o aplicativo sem conectar. A Cloudflare (e proxy/CDN em
     geral) só encaminha um conjunto fixo de portas — 80, 8080, 8880, 2052,
     2082, 2086, 2095 em http e 443, 2053, 2083, 2087, 2096, 8443 em https.
     Pedir a porta de origem ao domínio não chega em lugar nenhum.
     Num IP direto a porta é normal e esperada, então o aviso só sai para
     domínio. */
  const PROXIAVEIS = new Set(['', '80', '8080', '8880', '2052', '2082', '2086', '2095',
                              '443', '2053', '2083', '2087', '2096', '8443']);
  try {
    const u = new URL(url);
    const ehIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(u.hostname) ||
                 /^(localhost|\[.*\])$/i.test(u.hostname);
    if (!ehIp && !PROXIAVEIS.has(u.port)) {
      avisos.push(
        `apiUrl aponta para um domínio numa porta fora do padrão (:${u.port}).\n` +
        '        Se esse domínio passa por Cloudflare ou outro proxy, essa porta\n' +
        '        NÃO é encaminhada: o navegador funciona quando você digita o\n' +
        '        domínio sem porta, e o aplicativo falha quando ela está aqui.\n' +
        `        Em geral o certo é https://${u.hostname} — sem a porta.`);
    }
  } catch { /* já foi acusado acima */ }
}

if (!String(c.nomeLoja || '').trim())
  erros.push('nomeLoja está vazio — é o nome que aparece na tela de entrada.');

const canal = String(c.canalWhatsapp || '').trim();
if (canal && !/^https?:\/\//i.test(canal))
  erros.push(`canalWhatsapp precisa ser um link completo — está "${canal}".`);

if (c.travado === undefined)
  avisos.push('travado não foi definido; vou usar false (a oficina poderá ' +
              'trocar o endereço do servidor pela tela).');

if (erros.length) parar();

/* ---------- grava ---------- */

const saida = {
  apiUrl: url,
  nomeLoja: String(c.nomeLoja).trim(),
  canalWhatsapp: canal,
  travado,
  _gerado: 'Escrito por scripts/aplicar-config.js a partir de configuracao.json. ' +
           'Não edite este arquivo à mão: ele é sobrescrito a cada build.'
};

console.log('\n  Configuração que vai para dentro do programa:\n');
console.log(`    servidor  : ${saida.apiUrl}`);
console.log(`    loja      : ${saida.nomeLoja}`);
console.log(`    canal     : ${saida.canalWhatsapp || '(nenhum)'}`);
console.log(`    travado   : ${travado ? 'SIM — a oficina não altera o servidor'
                                       : 'não — a tela de Configuração fica editável'}`);

for (const a of avisos) console.log(`\n    [!] ${a}`);

if (SO_CONFERIR) {
  console.log('\n  (só conferi, não gravei)\n');
  process.exit(0);
}

fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
fs.writeFileSync(DESTINO, JSON.stringify(saida, null, 2) + '\n', 'utf8');
console.log(`\n  gravado em ${path.relative(RAIZ, DESTINO)}`);

/* ---------- o repositório da atualização automática ----------
   O electron-builder lê isto do package.json, mas quem edita é uma pessoa, e
   pessoa não deve ter que lembrar de dois arquivos. Então o repositório mora
   no configuracao.json junto com o resto e é copiado para lá. */
const gh = c.github || {};
const dono = String(gh.owner || '').trim();
const repo = String(gh.repo || '').trim() || 'farias-sistema';
const PKG = path.join(RAIZ, 'package.json');
const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));

if (dono) {
  const antes = JSON.stringify(pkg.build.publish);
  pkg.build.publish = [{ provider: 'github', owner: dono, repo, releaseType: 'release' }];
  if (JSON.stringify(pkg.build.publish) !== antes) {
    fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    console.log(`  atualização automática: github.com/${dono}/${repo}`);
  }
  console.log(`  versão que será publicada: ${pkg.version}`);
  console.log('  (o app instalado compara com esta; suba o número antes de publicar:');
  console.log('   npm version patch)');
} else {
  console.log('\n    [!] github.owner está vazio em configuracao.json.');
  console.log('        O instalador é gerado normalmente, mas os computadores da');
  console.log('        oficina NÃO vão se atualizar sozinhos — sem repositório, o');
  console.log('        app não tem onde procurar versão nova.');
}
console.log();
