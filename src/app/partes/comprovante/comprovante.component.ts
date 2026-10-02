/* O comprovante que vai para o WhatsApp do cliente.
 *
 * É uma IMAGEM desenhada em canvas, não um HTML bonito. A razão é prática: o
 * que sai daqui vai ser encaminhado, salvo na galeria e visto meses depois,
 * numa conversa onde ninguém abre link. Imagem sobrevive a isso; página não.
 *
 * O WhatsApp não tem como receber uma foto de fora — nem o canal, nem a
 * conversa. O `wa.me` abre o chat com um texto, e só. Então o caminho honesto
 * é o mesmo da Comunidade: copiar a imagem, abrir a conversa, colar. A tela
 * diz isso em vez de fingir um envio que não existe.
 *
 * As cores aqui são fixas e claras de propósito. O comprovante é lido fora do
 * aplicativo, no celular de outra pessoa: se seguisse o tema escuro da
 * oficina, sairia um retângulo preto no meio da conversa de quem trocou óleo.
 */
import { Component, ElementRef, OnInit, inject, input, output, signal, viewChild } from '@angular/core';
import { dinheiro, km as fKm, data as fData, placa as fPlaca, telefone as fTel } from '../../nucleo/formato';

export interface ItemComprovante { nome: string; detalhe?: string; valor: number | null; }

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

/* Papel, tinta e marca. Uma constante só para não haver cor solta no desenho. */
const C = {
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

const L = 860;                 // largura fixa: 860 px cai bem no WhatsApp
const M = 56;                  // margem lateral

@Component({
  selector: 'app-comprovante',
  standalone: true,
  templateUrl: './comprovante.component.html'
})
export class ComprovanteComponent implements OnInit {
  dados = input.required<DadosComprovante>();
  fechou = output<void>();

  private tela = viewChild<ElementRef<HTMLCanvasElement>>('tela');

  gerando = signal(true);
  copiado = signal(false);
  erroCopia = signal<string | null>(null);
  urlPng = signal<string | null>(null);

  fTel = fTel;

  async ngOnInit(): Promise<void> {
    /* Sem esperar as fontes, o primeiro desenho sai em Times New Roman —
       e o comprovante é a cara da oficina na conversa do cliente. */
    try { await (document as any).fonts?.ready; } catch { /* segue com o padrão */ }
    setTimeout(() => this.desenhar(), 0);
  }

  private desenhar(): void {
    const cv = this.tela()?.nativeElement;
    if (!cv) return;
    const d = this.dados();

    /* Altura calculada antes de desenhar: o comprovante de uma troca só de
       óleo é bem menor que o de uma com quatro filtros, e sobra de papel
       branco embaixo da assinatura fica com cara de erro. */
    const alturaItens = d.itens.length * 46;
    const alturaProxima = d.proximaTroca ? 108 : 0;
    const H = 232 + alturaItens + 150 + alturaProxima + 118;

    const escala = 2;                       // 2x: nítido no celular
    cv.width = L * escala;
    cv.height = H * escala;
    cv.style.width = L + 'px';
    cv.style.height = H + 'px';

    const g = cv.getContext('2d')!;
    g.scale(escala, escala);
    g.textBaseline = 'alphabetic';

    const ui = '"Schibsted Grotesk", system-ui, sans-serif';
    const mono = '"IBM Plex Mono", ui-monospace, monospace';

    g.fillStyle = C.papel;
    g.fillRect(0, 0, L, H);

    /* faixa da marca */
    g.fillStyle = C.faixa;
    g.fillRect(0, 0, L, 116);
    g.fillStyle = C.faixaTx;
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

    /* carro e cliente */
    g.fillStyle = C.tinta;
    g.font = `700 30px ${mono}`;
    g.fillText(fPlaca(d.placa), M, y);

    g.font = `400 18px ${ui}`;
    g.fillStyle = C.tinta2;
    const dirCarro = [d.modelo, d.km != null ? fKm(d.km) : null].filter(Boolean).join(' · ');
    if (dirCarro) g.fillText(dirCarro, M + 210, y - 2);

    y += 30;
    g.fillStyle = C.tinta;
    g.font = `600 19px ${ui}`;
    g.fillText(d.cliente, M, y);

    y += 34;
    this.linha(g, y);
    y += 36;

    /* itens */
    for (const it of d.itens) {
      g.fillStyle = C.tinta;
      g.font = `500 19px ${ui}`;
      g.fillText(it.nome, M, y);
      /* A largura do nome tem que ser medida ANTES de trocar a fonte: medindo
         depois, o canvas mede o texto de 19px com a régua da de 15px
         monoespaçada, devolve menos do que ele ocupa, e o detalhe é desenhado
         por cima do nome. */
      const larguraNome = g.measureText(it.nome).width;
      if (it.detalhe) {
        g.fillStyle = C.tinta3;
        g.font = `400 15px ${mono}`;
        g.fillText(it.detalhe, M + larguraNome + 14, y);
      }
      g.fillStyle = it.valor != null ? C.tinta : C.tinta3;
      g.font = `500 19px ${ui}`;
      const v = it.valor != null ? dinheiro(it.valor) : '—';
      g.fillText(v, L - M - g.measureText(v).width, y);
      y += 46;
    }

    if (d.maoDeObra > 0) {
      g.fillStyle = C.tinta2;
      g.font = `400 19px ${ui}`;
      g.fillText('Serviço', M, y);
      const v = dinheiro(d.maoDeObra);
      g.fillText(v, L - M - g.measureText(v).width, y);
      y += 46;
    }

    y += 4;
    this.linha(g, y);
    y += 52;

    /* total */
    g.fillStyle = C.tinta2;
    g.font = `500 20px ${ui}`;
    g.fillText('Total pago', M, y);
    g.fillStyle = C.tinta;
    g.font = `700 40px ${ui}`;
    const t = dinheiro(d.total);
    g.fillText(t, L - M - g.measureText(t).width, y + 6);
    y += 62;

    /* próxima troca: é o que o cliente vai procurar daqui a meio ano */
    if (d.proximaTroca != null) {
      const alt = 82;
      this.caixa(g, M, y, L - M * 2, alt, C.realce, C.realceBd);
      g.fillStyle = C.faixa;
      g.font = `600 17px ${ui}`;
      g.fillText('Próxima troca', M + 24, y + 32);
      g.font = `700 32px ${ui}`;
      g.fillText(fKm(d.proximaTroca), M + 24, y + 66);
      y += alt + 26;
    }

    /* rodapé */
    y += 12;
    g.fillStyle = C.tinta3;
    g.font = `400 15px ${ui}`;
    g.fillText('Guarde este comprovante. Qualquer dúvida, é só chamar.', M, y);
    y += 24;
    g.fillStyle = C.tinta2;
    g.font = `600 15px ${ui}`;
    g.fillText(d.loja, M, y);

    try { this.urlPng.set(cv.toDataURL('image/png')); } catch { /* segue */ }
    this.gerando.set(false);
  }

  private linha(g: CanvasRenderingContext2D, y: number): void {
    g.strokeStyle = C.linha;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(M, y + .5);
    g.lineTo(L - M, y + .5);
    g.stroke();
  }

  private caixa(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
                fundo: string, borda: string): void {
    const r = 10;
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
    g.fillStyle = fundo; g.fill();
    g.strokeStyle = borda; g.lineWidth = 1; g.stroke();
  }

  async copiarImagem(): Promise<void> {
    this.erroCopia.set(null);
    const cv = this.tela()?.nativeElement;
    if (!cv) return;
    try {
      const blob: Blob = await new Promise((ok, falha) =>
        cv.toBlob(b => b ? ok(b) : falha(new Error('sem imagem')), 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      this.copiado.set(true);
      setTimeout(() => this.copiado.set(false), 4000);
    } catch {
      /* Copiar imagem não funciona em todo lugar (fora de https, e em algumas
         versões do Electron). Baixar sempre funciona, então a tela manda a
         pessoa por ali em vez de deixar o botão falhando em silêncio. */
      this.erroCopia.set('Não consegui copiar a imagem aqui. Use "Baixar" e anexe o arquivo.');
    }
  }

  baixar(): void {
    const url = this.urlPng();
    if (!url) return;
    const d = this.dados();
    const a = document.createElement('a');
    a.href = url;
    a.download = `comprovante-${d.placa}-${d.data}.png`;
    a.click();
  }

  /** Abre a conversa do cliente com um texto curto. A imagem vai colada. */
  abrirWhatsapp(): void {
    const d = this.dados();
    const tel = (d.telefone || '').replace(/\D/g, '');
    if (!tel) return;
    const txt = encodeURIComponent(
      `Olá, ${d.cliente.split(' ')[0]}! Segue o comprovante da troca de óleo do ` +
      `${fPlaca(d.placa)} de ${fData(d.data)}. Obrigado pela preferência! — ${d.loja}`);
    window.open(`https://wa.me/${tel}?text=${txt}`, '_blank', 'noopener');
  }
}
