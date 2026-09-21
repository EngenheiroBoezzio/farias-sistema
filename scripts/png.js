/* PNG: ler, redimensionar e escrever — sem dependência nenhuma.
 *
 * Existe porque o gerador de ícone precisa reduzir a logo para os tamanhos que
 * o Windows usa, e exigir uma biblioteca de imagem só para isso seria mais uma
 * coisa para dar errado na máquina de quem compila (compilar nativo no Windows
 * é justamente onde as coisas quebram).
 *
 * O que dá para fazer com o que o Node já traz: zlib para os dados e um pouco
 * de aritmética para os filtros. Cobre PNG de 8 bits — tons de cinza, paleta,
 * RGB e RGBA, com ou sem transparência —, que é o que sai de qualquer programa
 * de design. Recusa 16 bits e entrelaçado dizendo o que fazer, em vez de
 * devolver imagem torta.
 */
'use strict';
const zlib = require('zlib');

const ASSINATURA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* ---------- CRC32, que todo pedaço do PNG carrega ---------- */
const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ---------- filtros de linha ----------
   Cada linha do PNG vem prefixada por um byte dizendo como ela foi filtrada.
   Desfazer é obrigatório antes de olhar para os pixels. */
const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

function desfiltrar(bruto, largura, altura, canais) {
  const passo = largura * canais;
  const saida = Buffer.alloc(altura * passo);
  let pos = 0;

  for (let y = 0; y < altura; y++) {
    const tipo = bruto[pos++];
    const linha = bruto.subarray(pos, pos + passo);
    pos += passo;
    const destino = y * passo;
    const anterior = destino - passo;

    for (let x = 0; x < passo; x++) {
      const cru = linha[x];
      const a = x >= canais ? saida[destino + x - canais] : 0;   // à esquerda
      const b = y > 0 ? saida[anterior + x] : 0;                 // acima
      const c = x >= canais && y > 0 ? saida[anterior + x - canais] : 0;
      let v;
      switch (tipo) {
        case 0: v = cru; break;
        case 1: v = cru + a; break;
        case 2: v = cru + b; break;
        case 3: v = cru + ((a + b) >> 1); break;
        case 4: v = cru + paeth(a, b, c); break;
        default: throw new Error(`filtro de linha desconhecido: ${tipo}`);
      }
      saida[destino + x] = v & 0xff;
    }
  }
  return saida;
}

/** Lê um PNG e devolve { largura, altura, pixels } em RGBA de 8 bits. */
function lerPng(buf) {
  if (!buf.subarray(0, 8).equals(ASSINATURA))
    throw new Error('não é um arquivo PNG.');

  let pos = 8, ihdr = null, paleta = null, transparencia = null;
  const partes = [];

  while (pos < buf.length) {
    const tamanho = buf.readUInt32BE(pos);
    const tipo = buf.toString('ascii', pos + 4, pos + 8);
    const dados = buf.subarray(pos + 8, pos + 8 + tamanho);
    pos += 12 + tamanho;                       // 4 tamanho + 4 tipo + dados + 4 crc

    if (tipo === 'IHDR') {
      ihdr = {
        largura: dados.readUInt32BE(0),
        altura: dados.readUInt32BE(4),
        bits: dados[8],
        cor: dados[9],
        entrelacado: dados[12]
      };
    } else if (tipo === 'PLTE') paleta = Buffer.from(dados);
    else if (tipo === 'tRNS') transparencia = Buffer.from(dados);
    else if (tipo === 'IDAT') partes.push(Buffer.from(dados));
    else if (tipo === 'IEND') break;
  }

  if (!ihdr) throw new Error('PNG sem cabeçalho IHDR.');
  if (ihdr.entrelacado)
    throw new Error('PNG entrelaçado não é suportado. Salve sem "interlaced".');
  if (ihdr.bits !== 8)
    throw new Error(`PNG de ${ihdr.bits} bits por canal não é suportado. ` +
                    'Exporte em 8 bits por canal.');

  const canaisDe = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const canais = canaisDe[ihdr.cor];
  if (!canais) throw new Error(`tipo de cor ${ihdr.cor} não é suportado.`);
  if (ihdr.cor === 3 && !paleta) throw new Error('PNG com paleta mas sem PLTE.');

  const cru = desfiltrar(zlib.inflateSync(Buffer.concat(partes)),
                         ihdr.largura, ihdr.altura, canais);

  /* Tudo vira RGBA: daí para frente o resto do código não precisa saber de
     paleta nem de tons de cinza. */
  const total = ihdr.largura * ihdr.altura;
  const pixels = Buffer.alloc(total * 4);
  for (let i = 0; i < total; i++) {
    const o = i * canais, d = i * 4;
    if (ihdr.cor === 0) {                                  // cinza
      pixels[d] = pixels[d + 1] = pixels[d + 2] = cru[o];
      pixels[d + 3] = 255;
    } else if (ihdr.cor === 4) {                           // cinza + alfa
      pixels[d] = pixels[d + 1] = pixels[d + 2] = cru[o];
      pixels[d + 3] = cru[o + 1];
    } else if (ihdr.cor === 3) {                           // paleta
      const idx = cru[o];
      pixels[d] = paleta[idx * 3];
      pixels[d + 1] = paleta[idx * 3 + 1];
      pixels[d + 2] = paleta[idx * 3 + 2];
      pixels[d + 3] = transparencia && idx < transparencia.length
        ? transparencia[idx] : 255;
    } else {                                               // RGB ou RGBA
      pixels[d] = cru[o];
      pixels[d + 1] = cru[o + 1];
      pixels[d + 2] = cru[o + 2];
      pixels[d + 3] = ihdr.cor === 6 ? cru[o + 3] : 255;
    }
  }

  return { largura: ihdr.largura, altura: ihdr.altura, pixels };
}

/* ---------- redução por média de área ----------
   Para ícone isso importa: pegar "o pixel mais próximo" numa redução de 512
   para 16 joga fora 99% da imagem e o resultado fica serrilhado e cheio de
   buraco. A média de área olha todos os pixels de origem que caem dentro do
   pixel de destino.

   O alfa entra pré-multiplicado. Sem isso, a cor de um pixel transparente
   (que costuma ser preto) entra na média e a borda da logo fica com um halo
   escuro. */
function redimensionar(img, lado) {
  const { largura: lo, altura: la, pixels: p } = img;
  const saida = Buffer.alloc(lado * lado * 4);

  // Se o destino for maior que a origem, usa interpolação bilinear suave
  if (lado > lo || lado > la) {
    for (let y = 0; y < lado; y++) {
      const srcY = (y + 0.5) * (la / lado) - 0.5;
      const y0 = Math.max(0, Math.min(la - 1, Math.floor(srcY)));
      const y1 = Math.max(0, Math.min(la - 1, y0 + 1));
      const dy = Math.max(0, Math.min(1, srcY - y0));

      for (let x = 0; x < lado; x++) {
        const srcX = (x + 0.5) * (lo / lado) - 0.5;
        const x0 = Math.max(0, Math.min(lo - 1, Math.floor(srcX)));
        const x1 = Math.max(0, Math.min(lo - 1, x0 + 1));
        const dx = Math.max(0, Math.min(1, srcX - x0));

        const idx00 = (y0 * lo + x0) * 4;
        const idx10 = (y0 * lo + x1) * 4;
        const idx01 = (y1 * lo + x0) * 4;
        const idx11 = (y1 * lo + x1) * 4;

        const w00 = (1 - dx) * (1 - dy);
        const w10 = dx * (1 - dy);
        const w01 = (1 - dx) * dy;
        const w11 = dx * dy;

        const d = (y * lado + x) * 4;
        for (let c = 0; c < 4; c++) {
          saida[d + c] = Math.round(
            p[idx00 + c] * w00 +
            p[idx10 + c] * w10 +
            p[idx01 + c] * w01 +
            p[idx11 + c] * w11
          );
        }
      }
    }
    return { largura: lado, altura: lado, pixels: saida };
  }

  for (let y = 0; y < lado; y++) {
    const y0 = Math.floor((y * la) / lado);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * la) / lado));

    for (let x = 0; x < lado; x++) {
      const x0 = Math.floor((x * lo) / lado);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * lo) / lado));

      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const o = (sy * lo + sx) * 4;
          const alfa = p[o + 3];
          r += p[o] * alfa;
          g += p[o + 1] * alfa;
          b += p[o + 2] * alfa;
          a += alfa;
          n++;
        }
      }

      const d = (y * lado + x) * 4;
      if (a === 0) {
        saida[d] = saida[d + 1] = saida[d + 2] = saida[d + 3] = 0;
      } else {
        saida[d] = Math.round(r / a);
        saida[d + 1] = Math.round(g / a);
        saida[d + 2] = Math.round(b / a);
        saida[d + 3] = Math.round(a / n);
      }
    }
  }

  return { largura: lado, altura: lado, pixels: saida };
}

/* ---------- escrever ---------- */
function pedaco(tipo, dados) {
  const t = Buffer.from(tipo, 'ascii');
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, dados])), 0);
  return Buffer.concat([tamanho, t, dados, crc]);
}

/** Escreve RGBA de 8 bits como PNG. Filtro 0 em toda linha: o ganho de
 *  escolher filtro por linha não paga a complexidade num ícone de 256px. */
function escreverPng(img) {
  const { largura, altura, pixels } = img;
  const passo = largura * 4;
  const cru = Buffer.alloc(altura * (passo + 1));
  for (let y = 0; y < altura; y++) {
    cru[y * (passo + 1)] = 0;
    pixels.copy(cru, y * (passo + 1) + 1, y * passo, (y + 1) * passo);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8;        // bits por canal
  ihdr[9] = 6;        // RGBA
  ihdr[10] = 0;       // compressão
  ihdr[11] = 0;       // filtro
  ihdr[12] = 0;       // sem entrelaçamento

  return Buffer.concat([
    ASSINATURA,
    pedaco('IHDR', ihdr),
    pedaco('IDAT', zlib.deflateSync(cru, { level: 9 })),
    pedaco('IEND', Buffer.alloc(0))
  ]);
}

module.exports = { lerPng, redimensionar, escreverPng };
