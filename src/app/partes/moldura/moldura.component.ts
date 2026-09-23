/* A moldura do sistema: barra lateral esquerda + área de conteúdo.
 *
 * A barra é de ícones (62px) e abre no hover ou quando o foco entra por
 * teclado — `:focus-within` no CSS. Quem navega por Tab enxerga os rótulos
 * igual a quem usa o mouse. */
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../nucleo/auth.service';
import { ConfigService } from '../../nucleo/config.service';
import { DadosService } from '../../nucleo/dados.service';
import { SinoComponent } from '../sino/sino.component';

@Component({
  selector: 'app-moldura',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, SinoComponent, FormsModule],
  templateUrl: './moldura.component.html'
})
export class MolduraComponent implements OnInit {
  private dados = inject(DadosService);
  auth = inject(AuthService);
  cfg = inject(ConfigService);

  bdClientes = signal<string>('—');
  bdVencidos = signal<string>('—');
  bdFiltros = signal<string>('—');
  temVencido = signal(false);
  railFixada = signal(false);
  fotoErro = signal(false);

  novaSenha = '';
  confirmaSenha = '';
  salvandoSenha = signal(false);
  erroSenha = signal<string | null>(null);

  onErroFoto(): void {
    this.fotoErro.set(true);
  }

  ngOnInit(): void {
    try {
      const fix = localStorage.getItem('farias.rail_fixada');
      if (fix === 'true') this.railFixada.set(true);
    } catch {}

    // os contadores da barra: se falharem, a barra continua utilizável
    this.dados.painel().subscribe({
      next: p => {
        this.bdClientes.set(this.curto(p.resumo.clientes));
        this.bdVencidos.set(this.curto(p.resumo.vencido));
        this.temVencido.set(p.resumo.vencido > 0);
      },
      error: () => { /* badge fica "—", e a navegação segue */ }
    });
    this.dados.filaFiltros({ limite: 1 }).subscribe({
      next: r => this.bdFiltros.set(this.curto(r.total)),
      error: () => {}
    });
  }

  alternarFixacao(): void {
    const novo = !this.railFixada();
    this.railFixada.set(novo);
    try { localStorage.setItem('farias.rail_fixada', String(novo)); } catch {}
  }

  async salvarSenha(): Promise<void> {
    this.erroSenha.set(null);
    if (!this.novaSenha || this.novaSenha.length < 4) {
      this.erroSenha.set('A senha deve ter pelo menos 4 caracteres.');
      return;
    }
    if (this.novaSenha !== this.confirmaSenha) {
      this.erroSenha.set('As senhas digitadas não conferem.');
      return;
    }
    this.salvandoSenha.set(true);
    try {
      const r = await this.auth.definirSenha(this.novaSenha);
      if (!r.ok) this.erroSenha.set(r.mensagem || 'Não foi possível salvar a senha.');
    } catch (e: any) {
      this.erroSenha.set('Erro ao conectar com o servidor.');
    } finally {
      this.salvandoSenha.set(false);
    }
  }

  /** 1124 -> "1,1k", para caber na barra sem quebrar linha */
  private curto(n: number): string {
    if (n < 1000) return String(n);
    return (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k';
  }

  sair(): void { this.auth.sair(); }
}
