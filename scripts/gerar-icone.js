/* Monta build/icone.ico a partir de build/icone.png.
 *
 * Existe porque o electron-builder, sem um .ico, empacota o app com o ÍCONE
 * PADRÃO DO ELECTRON — e ele avisa isso numa linha só, no meio de cem, que
 * passa batido. O cliente recebe um programa com a logo do Electron na área
 * de trabalho e parece coisa não terminada.
 *
 * Aceita a logo em qualquer tamanho e reduz para os sete que o Windows usa,
 * do ícone da barra de tarefas ao da janela grande. O redimensionamento é
 * feito aqui mesmo (scripts/png.js), sem biblioteca de imagem: compilar
 * dependência nativa no Windows é justamente onde as coisas quebram.
 *
 *   npm run icone
 *   node scripts/gerar-icone.js caminho/para/logo.png
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { lerPng, redimensionar, escreverPng } = require('./png');

const RAIZ = path.join(__dirname, '..');
const ORIGEM = path.resolve(process.argv[2] || path.join(RAIZ, 'build', 'icone.png'));
const DESTINO = path.join(RAIZ, 'build', 'icone.ico');

/* Os tamanhos que o Windows pede. 256 é o da visualização grande; 16 é o da
   barra de tarefas. Guardar os dois extremos e o meio evita que o sistema
   improvise uma redução feia na hora. */
const TAMANHOS = [16, 24, 32, 48, 64, 128, 256];

function pare(msg, dica) {
  console.error(`\n  [X] ${msg}`);
  if (dica) console.error(`      ${dica}`);
  console.error();
  process.exit(1);
}

if (!fs.existsSync(ORIGEM))
  pare(`não achei ${ORIGEM}.`,
       'Ponha a logo em build/icone.png e rode de novo.');

let img;
try {
  img = lerPng(fs.readFileSync(ORIGEM));
} catch (e) {
  pare(`não consegui ler a imagem: ${e.message}`,
       'Exporte a logo como PNG de 8 bits, sem entrelaçamento.');
}

if (img.largura !== img.altura)
  pare(`a imagem é ${img.largura}x${img.altura}, e ícone precisa ser quadrado.`,
       'Exporte num quadrado — 512x512 ou 256x256 servem.');

if (img.largura < 16)
  pare(`a imagem é ${img.largura}x${img.largura}, pequena demais para virar ícone.`);

/* Cada entrada do ICO é um PNG completo. O formato aceita isso desde o Vista
   e é o que evita ter que escrever bitmap com máscara de transparência.
   O electron-builder EXIGE que o .ico contenha a camada de 256x256. */
const imagens = TAMANHOS
  .map(t => ({ lado: t, png: escreverPng(t === img.largura ? img : redimensionar(img, t)) }));

if (!imagens.length) pare('nenhum tamanho utilizável saiu da imagem.');

// Se a imagem de origem for menor que 256, atualiza build/icone.png para 256x256
// para satisfazer os requisitos de empacotamento do electron-builder
if (img.largura < 256) {
  const png256 = escreverPng(redimensionar(img, 256));
  fs.writeFileSync(ORIGEM, png256);
  console.log(`  [+] build/icone.png atualizado para 256x256`);
}

const cabecalho = Buffer.alloc(6);
cabecalho.writeUInt16LE(0, 0);                 // reservado
cabecalho.writeUInt16LE(1, 2);                 // 1 = ícone
cabecalho.writeUInt16LE(imagens.length, 4);

let deslocamento = 6 + imagens.length * 16;
const entradas = imagens.map(({ lado, png }) => {
  const e = Buffer.alloc(16);
  /* Largura e altura cabem num byte só, e 256 é escrito como 0 — é a
     convenção do formato, não um descuido. */
  e.writeUInt8(lado === 256 ? 0 : lado, 0);
  e.writeUInt8(lado === 256 ? 0 : lado, 1);
  e.writeUInt8(0, 2);                          // cores da paleta
  e.writeUInt8(0, 3);                          // reservado
  e.writeUInt16LE(1, 4);                       // planos
  e.writeUInt16LE(32, 6);                      // bits por pixel
  e.writeUInt32LE(png.length, 8);
  e.writeUInt32LE(deslocamento, 12);
  deslocamento += png.length;
  return e;
});

fs.writeFileSync(DESTINO, Buffer.concat([
  cabecalho, ...entradas, ...imagens.map(i => i.png)
]));

const kb = (fs.statSync(DESTINO).size / 1024).toFixed(1);
console.log(`\n  ícone gerado: ${path.relative(RAIZ, DESTINO)} (${kb} KB)`);
console.log(`  origem: ${path.relative(RAIZ, ORIGEM)} · ${img.largura}x${img.largura}`);
console.log(`  tamanhos: ${imagens.map(i => i.lado).join(', ')}`);
console.log('\n  Recompile para ele entrar no executável:  npm run empacotar\n');
