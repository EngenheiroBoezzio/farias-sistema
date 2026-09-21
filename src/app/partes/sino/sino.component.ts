/* O sino de notificações — é por onde o backup avisa que falhou.
   Consulta ao abrir e a cada 5 minutos: o backup roda de hora em hora, então
   perguntar mais que isso é só gastar chamada. */
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DadosService } from '../../nucleo/dados.service';
import { Notificacao } from '../../nucleo/tipos';
import { dataHora } from '../../nucleo/formato';

@Component({
  selector: 'app-sino',
  standalone: true,
  templateUrl: './sino.component.html',
  styleUrl: './sino.component.css'
})
export class SinoComponent implements OnInit, OnDestroy {
  private dados = inject(DadosService);
  private timer?: any;

  aberto = signal(false);
  naoLidas = signal(0);
  erros = signal(0);
  lista = signal<Notificacao[]>([]);

  dataHora = dataHora;

  ngOnInit(): void {
    this.buscar();
    this.timer = setInterval(() => this.buscar(), 5 * 60 * 1000);
  }
  ngOnDestroy(): void { clearInterval(this.timer); }

  buscar(): void {
    this.dados.notificacoes().subscribe({
      next: r => {
        this.naoLidas.set(r.nao_lidas);
        this.erros.set(r.erros);
        this.lista.set(r.notificacoes);
      },
      error: () => { /* sino sem número é melhor que tela com erro */ }
    });
  }

  alternar(): void {
    this.aberto.update(v => !v);
    if (this.aberto() && this.naoLidas() > 0) {
      this.dados.marcarTodasLidas().subscribe({
        next: () => { this.naoLidas.set(0); this.erros.set(0); },
        error: () => {}
      });
    }
  }
}
