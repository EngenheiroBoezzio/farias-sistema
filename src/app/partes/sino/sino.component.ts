/* O sino de notificações — é por onde o backup avisa que falhou.
   Consulta ao abrir e a cada 5 minutos: o backup roda de hora em hora, então
   perguntar mais que isso é só gastar chamada. */
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DadosService } from '../../nucleo/dados.service';
import { Notificacao, Novidade } from '../../nucleo/tipos';
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
  naoLidas = signal(0);        // notificações de sistema (backup) não lidas
  erros = signal(0);
  lista = signal<Notificacao[]>([]);
  novidades = signal<Novidade[]>([]);
  novidadesNaoLidas = signal(0);  // novidades que ESTA pessoa ainda não viu

  /* A bolinha soma as duas coisas: alerta de sistema e novidade. Para quem
     olha, é só "tem N coisas novas"; de onde vêm é problema da tela, não da
     bolinha. */
  total = computed(() => this.naoLidas() + this.novidadesNaoLidas());

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
        this.novidades.set(r.novidades ?? []);
        this.novidadesNaoLidas.set(r.novidades_nao_lidas ?? 0);
      },
      error: () => { /* sino sem número é melhor que tela com erro */ }
    });
  }

  alternar(): void {
    this.aberto.update(v => !v);
    if (!this.aberto()) return;

    // notificações de sistema: "lida" é global (é alerta de backup da casa)
    if (this.naoLidas() > 0) {
      this.dados.marcarTodasLidas().subscribe({
        next: () => { this.naoLidas.set(0); this.erros.set(0); },
        error: () => {}
      });
    }
    // novidades: "visto" é SÓ desta pessoa, por isso é outra chamada
    if (this.novidadesNaoLidas() > 0) {
      this.dados.marcarNovidadesVistas().subscribe({
        next: () => {
          this.novidadesNaoLidas.set(0);
          this.novidades.update(l => l.map(n => ({ ...n, nova: false })));
        },
        error: () => {}
      });
    }
  }
}
