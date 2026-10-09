/* Utilitários compartilhados do Comprovante de Serviço e Envio WhatsApp.
 *
 * Gera o texto do WhatsApp e desenha a imagem do recibo em canvas para que
 * possa ser copiada diretamente para a área de transferência ou baixada.
 */
import { dinheiro, km as fKm, data as fData, placa as fPlaca } from './formato';

export interface ItemComprovante {
  nome: string;
  detalhe?: string;
  valor: number | null;
}

export interface DadosComprovante {
  loja: string;
  numero: number | null;
  data: string;
  placa: string;
  modelo: string | null;
  cliente: string;
  telefone: string | null;
  km: number | null;
  itens: ItemComprovante[];
  maoDeObra: number;
  total: number;
  proximaTroca: number | null;
}

export const CORES_COMPROVANTE = {
  papel: '#FFFFFF',
  faixa: '#8E0A10',
  faixaTx: '#FDF4F4',
  tinta: '#1A1512',
  tinta2: '#5C534D',
  tinta3: '#8A817B',
  linha: '#E7E2DC',
  realce: '#FCE3E4',
  realceBd: '#F2C4C6',
  verde: '#0F6B45'
};

const L = 860;
const M = 56;

export function desenharComprovanteCanvas(cv: HTMLCanvasElement, d: DadosComprovante): void {
  const alturaItens = d.itens.length * 46;
  const alturaProxima = d.proximaTroca ? 108 : 0;
  const H = 232 + alturaItens + 150 + alturaProxima + 118;

  const escala = 2;
  cv.width = L * escala;
  cv.height = H * escala;
  cv.style.width = L + 'px';
  cv.style.height = H + 'px';

  const g = cv.getContext('2d')!;
  g.scale(escala, escala);
  g.textBaseline = 'alphabetic';

  const ui = '"Schibsted Grotesk", system-ui, sans-serif';
  const mono = '"IBM Plex Mono", ui-monospace, monospace';

  g.fillStyle = CORES_COMPROVANTE.papel;
  g.fillRect(0, 0, L, H);

  // Faixa da marca
  g.fillStyle = CORES_COMPROVANTE.faixa;
  g.fillRect(0, 0, L, 116);
  g.fillStyle = CORES_COMPROVANTE.faixaTx;
  g.font = `700 34px ${ui}`;
  g.fillText(d.loja, M, 54);
  g.font = `400 18px ${ui}`;
  g.fillText('Comprovante de troca de óleo', M, 84);

  if (d.numero != null) {
    g.font = `500 16px ${mono}`;
    const rot = `Nº ${String(d.numero).padStart(5, '0')}`;
    g.fillText(rot, L - M - g.measureText(rot).width, 54);
  }
  g.font = `400 16px ${ui}`;
  const dt = fData(d.data);
  g.fillText(dt, L - M - g.measureText(dt).width, 84);

  let y = 168;

  // Carro e cliente
  g.fillStyle = CORES_COMPROVANTE.tinta;
  g.font = `700 30px ${mono}`;
  g.fillText(fPlaca(d.placa), M, y);

  g.font = `400 18px ${ui}`;
  g.fillStyle = CORES_COMPROVANTE.tinta2;
  const dirCarro = [d.modelo, d.km != null ? fKm(d.km) : null].filter(Boolean).join(' · ');
  if (dirCarro) g.fillText(dirCarro, M + 210, y - 2);

  y += 30;
  g.fillStyle = CORES_COMPROVANTE.tinta;
  g.font = `600 19px ${ui}`;
  g.fillText(d.cliente, M, y);

  y += 34;
  desenharLinha(g, y);
  y += 36;

  // Itens
  for (const it of d.itens) {
    g.fillStyle = CORES_COMPROVANTE.tinta;
    g.font = `500 19px ${ui}`;
    g.fillText(it.nome, M, y);
    const larguraNome = g.measureText(it.nome).width;
    if (it.detalhe) {
      g.fillStyle = CORES_COMPROVANTE.tinta3;
      g.font = `400 15px ${mono}`;
      g.fillText(it.detalhe, M + larguraNome + 14, y);
    }
    g.fillStyle = it.valor != null ? CORES_COMPROVANTE.tinta : CORES_COMPROVANTE.tinta3;
    g.font = `500 19px ${ui}`;
    const v = it.valor != null ? dinheiro(it.valor) : '—';
    g.fillText(v, L - M - g.measureText(v).width, y);
    y += 46;
  }

  if (d.maoDeObra > 0) {
    g.fillStyle = CORES_COMPROVANTE.tinta2;
    g.font = `400 19px ${ui}`;
    g.fillText('Serviço', M, y);
    const v = dinheiro(d.maoDeObra);
    g.fillText(v, L - M - g.measureText(v).width, y);
    y += 46;
  }

  y += 4;
  desenharLinha(g, y);
  y += 52;

  // Total
  g.fillStyle = CORES_COMPROVANTE.tinta2;
  g.font = `500 20px ${ui}`;
  g.fillText('Total pago', M, y);
  g.fillStyle = CORES_COMPROVANTE.tinta;
  g.font = `700 40px ${ui}`;
  const t = dinheiro(d.total);
  g.fillText(t, L - M - g.measureText(t).width, y + 6);
  y += 62;

  // Próxima troca
  if (d.proximaTroca != null) {
    const alt = 82;
    desenharCaixa(g, M, y, L - M * 2, alt, CORES_COMPROVANTE.realce, CORES_COMPROVANTE.realceBd);
    g.fillStyle = CORES_COMPROVANTE.faixa;
    g.font = `600 17px ${ui}`;
    g.fillText('Próxima troca', M + 24, y + 32);
    g.font = `700 32px ${ui}`;
    g.fillText(fKm(d.proximaTroca), M + 24, y + 66);
    y += alt + 26;
  }

  // Rodapé
  y += 12;
  g.fillStyle = CORES_COMPROVANTE.tinta3;
  g.font = `400 15px ${ui}`;
  g.fillText('Guarde este comprovante. Qualquer dúvida, é só chamar.', M, y);
  y += 24;
  g.fillStyle = CORES_COMPROVANTE.tinta2;
  g.font = `600 15px ${ui}`;
  g.fillText(d.loja, M, y);
}

function desenharLinha(g: CanvasRenderingContext2D, y: number): void {
  g.strokeStyle = CORES_COMPROVANTE.linha;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(M, y + .5);
  g.lineTo(L - M, y + .5);
  g.stroke();
}

function desenharCaixa(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
                       fundo: string, borda: string): void {
  const r = 10;
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  g.fillStyle = fundo;
  g.fill();
  g.strokeStyle = borda;
  g.lineWidth = 1;
  g.stroke();
}

export async function gerarBlobComprovante(d: DadosComprovante): Promise<Blob> {
  try { await (document as any).fonts?.ready; } catch { /* segue */ }
  const cv = document.createElement('canvas');
  desenharComprovanteCanvas(cv, d);
  return new Promise((ok, falha) => {
    cv.toBlob(b => b ? ok(b) : falha(new Error('Erro ao gerar imagem')), 'image/png');
  });
}

export async function copiarImagemComprovante(d: DadosComprovante): Promise<boolean> {
  try {
    const blob = await gerarBlobComprovante(d);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch (err) {
    console.warn('Não foi possível copiar comprovante direto para a área de transferência', err);
    return false;
  }
}

export function limparTelefoneWhatsapp(tel: string): string {
  let limpo = (tel || '').replace(/\D/g, '');
  if (limpo.startsWith('0')) limpo = limpo.substring(1);
  if (limpo.length === 10 || limpo.length === 11) {
    limpo = '55' + limpo;
  }
  return limpo;
}

export function formatarTelefoneVisual(tel: string): string {
  const limpo = (tel || '').replace(/\D/g, '');
  if (!limpo) return '';
  const s = (limpo.startsWith('55') && limpo.length >= 12) ? limpo.substring(2) : limpo;
  if (s.length === 11) {
    return `(${s.slice(0, 2)}) ${s.slice(2, 7)}-${s.slice(7)}`;
  }
  if (s.length === 10) {
    return `(${s.slice(0, 2)}) ${s.slice(2, 6)}-${s.slice(6)}`;
  }
  return tel;
}

export function gerarTextoWhatsappComprovante(d: DadosComprovante): string {
  const primeiroNome = (d.cliente || 'Cliente').trim().split(' ')[0];
  const placaFmt = fPlaca(d.placa);
  const dataFmt = fData(d.data);
  const modeloStr = d.modelo ? `${d.modelo} (${placaFmt})` : placaFmt;

  let msg = `*COMPROVANTE DE TROCA DE ÓLEO*\n`;
  msg += `*${d.loja.toUpperCase()}*\n\n`;
  msg += `Olá, ${primeiroNome}! Aqui está o resumo do serviço realizado no seu veículo:\n\n`;
  msg += `🚗 *Veículo:* ${modeloStr}\n`;
  msg += `📅 *Data:* ${dataFmt}`;
  if (d.km != null) msg += ` | *Km:* ${fKm(d.km)}`;
  msg += `\n`;
  if (d.numero != null) msg += `📋 *Ordem nº:* ${String(d.numero).padStart(5, '0')}\n`;
  msg += `\n*Peças e Serviços:*\n`;

  for (const it of d.itens) {
    const detalhe = it.detalhe ? ` (${it.detalhe})` : '';
    const valor = it.valor != null ? ` — ${dinheiro(it.valor)}` : '';
    msg += `• ${it.nome}${detalhe}${valor}\n`;
  }

  if (d.maoDeObra > 0) {
    msg += `• Mão de obra / Serviço — ${dinheiro(d.maoDeObra)}\n`;
  }

  msg += `\n💰 *Total pago:* ${dinheiro(d.total)}\n`;

  if (d.proximaTroca != null) {
    msg += `\n📍 *Próxima troca recomendada:* *${fKm(d.proximaTroca)}*\n`;
  }

  msg += `\nObrigado pela preferência! Guarde este comprovante para seu controle. Qualquer dúvida, conte conosco!`;
  return msg;
}
