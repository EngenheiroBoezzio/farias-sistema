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
import { Component, ElementRef, OnInit, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { telefone as fTel } from '../../nucleo/formato';
import {
  DadosComprovante,
  ItemComprovante,
  desenharComprovanteCanvas,
  gerarTextoWhatsappComprovante,
  limparTelefoneWhatsapp,
  formatarTelefoneVisual
} from '../../nucleo/comprovante.util';

export type { DadosComprovante, ItemComprovante };

@Component({
  selector: 'app-comprovante',
  standalone: true,
  imports: [FormsModule],
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

  telefoneManual = signal<string>('');
  fTel = fTel;

  async ngOnInit(): Promise<void> {
    const tel = this.dados().telefone || '';
    if (tel) {
      this.telefoneManual.set(formatarTelefoneVisual(tel));
    }
    try { await (document as any).fonts?.ready; } catch { /* segue com o padrão */ }
    setTimeout(() => this.desenhar(), 0);
  }

  private desenhar(): void {
    const cv = this.tela()?.nativeElement;
    if (!cv) return;
    desenharComprovanteCanvas(cv, this.dados());
    try { this.urlPng.set(cv.toDataURL('image/png')); } catch { /* segue */ }
    this.gerando.set(false);
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

  /** Abre a conversa do cliente com o texto completo formatado. A imagem vai copiada. */
  abrirWhatsapp(): void {
    const d = this.dados();
    const telAlvo = this.telefoneManual() || d.telefone || '';
    const limpo = limparTelefoneWhatsapp(telAlvo);
    if (!limpo || limpo.length < 10) {
      this.erroCopia.set('Informe um telefone de WhatsApp válido com DDD.');
      return;
    }
    const txt = encodeURIComponent(gerarTextoWhatsappComprovante(d));
    window.open(`https://wa.me/${limpo}?text=${txt}`, '_blank', 'noopener');
  }

  onTelefoneInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.telefoneManual.set(formatarTelefoneVisual(val));
  }
}
