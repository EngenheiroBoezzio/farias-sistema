/* A moldura do sistema: barra lateral esquerda + área de conteúdo.
 *
 * A barra fica ABERTA, sempre. Ela abria no hover, e isso custava caro: cada
 * rótulo, badge e separador precisava existir em dois estados, o que rendeu
 * seis blocos de :hover no CSS, o "Operaçã" cortado e um alfinete para fixar.
 * Aberta, nada disso é necessário — e cabe a busca de placa, que é o que mais
 * se faz no balcão. Em monitor abaixo de 1280px o CSS recolhe para os ícones.
 */
import { Component, ElementRef, HostListener, OnDestroy, OnInit, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../nucleo/auth.service';
import { ConfigService } from '../../nucleo/config.service';
import { DadosService } from '../../nucleo/dados.service';

/* De quanto em quanto tempo perguntar ao servidor se ele está vivo. Um minuto
   é curto o bastante para o balcão notar a queda e longo o bastante para não
   virar ruído no log da API. */
const INTERVALO_ESTADO = 60_000;

@Component({
  selector: 'app-moldura',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule],
  templateUrl: './moldura.component.html'
})
export class MolduraComponent implements OnInit, OnDestroy {
  private dados = inject(DadosService);
  private router = inject(Router);
  auth = inject(AuthService);
  cfg = inject(ConfigService);

  private campoBusca = viewChild<ElementRef<HTMLInputElement>>('campoBusca');

  termo = '';
  bdClientes = signal<string>('—');
  bdVencidos = signal<string>('—');
  bdFiltros = signal<string>('—');
  temVencido = signal(false);
  fotoErro = signal(false);

  servidorOk = signal(true);
  horaResposta = signal('—');
  tituloEstado = signal('Verificando o servidor…');
  private relogio?: ReturnType<typeof setInterval>;

  novaSenha = '';
  confirmaSenha = '';
  salvandoSenha = signal(false);
  erroSenha = signal<string | null>(null);

  onErroFoto(): void { this.fotoErro.set(true); }

  ngOnInit(): void {
    /* Os contadores da barra: se falharem, a barra continua utilizável. */
    this.dados.painel().subscribe({
      next: p => {
        this.bdClientes.set(this.curto(p.resumo.clientes));
        this.bdVencidos.set(this.curto(p.resumo.vencido));
        this.temVencido.set(p.resumo.vencido > 0);
      },
      error: () => { /* fica "—", e a navegação segue */ }
    });
    this.dados.filaFiltros({ limite: 1 }).subscribe({
      next: r => this.bdFiltros.set(this.curto(r.total)),
      error: () => {}
    });

    this.conferirServidor();
    this.relogio = setInterval(() => this.conferirServidor(), INTERVALO_ESTADO);
  }

  ngOnDestroy(): void {
    if (this.relogio) clearInterval(this.relogio);
  }

  /* Ctrl+B põe o cursor na busca de qualquer tela. É o atalho que aparece
     escrito no próprio campo — atalho que não se anuncia ninguém usa. */
  @HostListener('document:keydown', ['$event'])
  atalho(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      this.campoBusca()?.nativeElement.focus();
      this.campoBusca()?.nativeElement.select();
    }
  }

  buscar(): void {
    const t = this.termo.trim();
    if (!t) return;
    /* A tela de Consulta resolve os dois casos — placa ou nome do cliente —,
       então a barra não precisa adivinhar qual é. */
    this.router.navigate(['/placa', t]);
    this.termo = '';
  }

  /* Pergunta ao /health. O que vai para a tela é a HORA da última resposta,
     não um "conectado" fixo: assim a informação continua verdadeira mesmo
     quando o servidor cai e ninguém está olhando. */
  private async conferirServidor(): Promise<void> {
    try {
      const r = await this.cfg.testar();
      if (r.ok) {
        this.servidorOk.set(true);
        this.horaResposta.set(this.agora());
        this.tituloEstado.set('O servidor respondeu agora há pouco.');
      } else {
        this.servidorOk.set(false);
        this.tituloEstado.set('O servidor parou de responder. Os dados na tela podem estar velhos.');
      }
    } catch {
      this.servidorOk.set(false);
      this.tituloEstado.set('O servidor parou de responder. Os dados na tela podem estar velhos.');
    }
  }

  private agora(): string {
    return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  async salvarSenha(): Promise<void> {
    this.erroSenha.set(null);
    if (!this.novaSenha || this.novaSenha.length < 4) {
      this.erroSenha.set('A senha precisa de pelo menos 4 caracteres.');
      return;
    }
    if (this.novaSenha !== this.confirmaSenha) {
      this.erroSenha.set('As duas senhas não são iguais.');
      return;
    }
    this.salvandoSenha.set(true);
    try {
      const r = await this.auth.definirSenha(this.novaSenha);
      if (!r.ok) this.erroSenha.set(r.mensagem || 'Não consegui salvar a senha.');
    } catch {
      this.erroSenha.set('Não consegui falar com o servidor.');
    } finally {
      this.salvandoSenha.set(false);
    }
  }

  /** 1124 -> "1,1k", para caber na barra sem quebrar linha. */
  private curto(n: number): string {
    /* Sem a guarda, uma resposta sem o campo vira "NaNk" na barra — e um
       número absurdo na tela é pior do que não ter número nenhum. */
    if (!Number.isFinite(n)) return '—';
    if (n < 1000) return String(n);
    return (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k';
  }

  sair(): void { this.auth.sair(); }
}
