/* Comunidade: o canal do WhatsApp da oficina.
 *
 * O canal do WhatsApp não tem API de publicação — não existe "postar daqui",
 * e qualquer tela que finja isso vai mentir na primeira vez que for usada. O
 * que esta tela faz é o caminho honesto e curto: escolhe a ideia, monta o
 * texto, copia, abre o canal e registra que foi publicado.
 *
 * O `canalWhatsapp` estava gravado na configuração e nada o usava. Agora usa.
 */
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ComunidadeService, Ideia, Publicacao } from '../../nucleo/comunidade.service';
import { ConfigService } from '../../nucleo/config.service';
import { ErroApi } from '../../nucleo/api.service';
import { dataHora } from '../../nucleo/formato';
import { SeloComponent } from '../../partes/selo/selo.component';

type AbaComunidade = 'escrever' | 'historico';

@Component({
  selector: 'app-comunidade',
  standalone: true,
  imports: [FormsModule, RouterLink, SeloComponent],
  templateUrl: './comunidade.component.html'
})
export class ComunidadeComponent implements OnInit {
  private com = inject(ComunidadeService);
  private cfg = inject(ConfigService);

  carregando = signal(true);
  erro = signal<ErroApi | null>(null);
  aba = signal<AbaComunidade>('escrever');

  ideias = signal<Ideia[]>([]);
  escolhida = signal<Ideia | null>(null);
  texto = signal('');
  copiado = signal(false);
  selo = signal<{ titulo: string; linha: string } | null>(null);

  dataHora = dataHora;

  historico = this.com.historico;
  temCanal = computed(() => this.com.temCanal);
  canal = computed(() => this.com.canal);
  nomeLoja = computed(() => this.cfg.nomeLoja);

  caracteres = computed(() => this.texto().trim().length);
  vazio = computed(() => this.texto().trim().length === 0);

  /* "Há 9 dias" só existe para o que foi registrado NESTE computador. A tela
     diz isso; prometer mais do que o dado sustenta é como se perde confiança
     num número. */
  desdeUltima = computed(() => {
    const d = this.com.diasDesdeUltima();
    if (d === null) return null;
    if (d === 0) return 'hoje';
    if (d === 1) return 'ontem';
    return `há ${d} dias`;
  });

  async ngOnInit(): Promise<void> {
    await this.buscar();
  }

  async buscar(): Promise<void> {
    this.carregando.set(true);
    this.erro.set(null);
    try {
      const lista = await this.com.ideias();
      this.ideias.set(lista);
      if (lista.length && !this.escolhida()) this.usar(lista[0]);
    } catch (e: any) {
      this.erro.set(e as ErroApi);
    } finally {
      this.carregando.set(false);
    }
  }

  usar(i: Ideia): void {
    this.escolhida.set(i);
    this.texto.set(i.texto);
    this.copiado.set(false);
    this.aba.set('escrever');
  }

  reusar(p: Publicacao): void {
    this.escolhida.set(null);
    this.texto.set(p.texto);
    this.copiado.set(false);
    this.aba.set('escrever');
  }

  async copiar(): Promise<void> {
    const t = this.texto().trim();
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
      this.copiado.set(true);
      setTimeout(() => this.copiado.set(false), 4000);
    } catch {
      /* Clipboard bloqueado (acontece fora de https e em alguns Electron).
         Selecionar o texto deixa o Ctrl C na mão de quem está ali. */
      const ta = document.getElementById('texto-post') as HTMLTextAreaElement | null;
      ta?.focus();
      ta?.select();
    }
  }

  abrirCanal(): void {
    if (!this.temCanal()) return;
    window.open(this.canal(), '_blank', 'noopener');
  }

  marcarPublicado(): void {
    const t = this.texto().trim();
    if (!t) return;
    this.com.registrar(t, this.escolhida()?.titulo);
    this.selo.set({
      titulo: 'Publicação registrada',
      linha: 'Fica no histórico deste computador.'
    });
  }

  remover(p: Publicacao): void { this.com.remover(p.id); }
}
