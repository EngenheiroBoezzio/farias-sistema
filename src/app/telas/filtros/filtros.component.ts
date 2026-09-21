/* A fila de trabalho dos filtros: 1.124 carros ativos sem peça definida.
   Vem com a sugestão do catálogo ao lado — é para CONFERIR e aceitar, não
   para digitar do zero. Ordenada por quem mais visita a loja, para o esforço
   da Raíssa render mais rápido. */
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DadosService } from '../../nucleo/dados.service';
import { PendenteFiltro } from '../../nucleo/tipos';
import { ErroApi } from '../../nucleo/api.service';
import { placa as fPlaca, rotuloSituacao } from '../../nucleo/formato';
import { SeloComponent } from '../../partes/selo/selo.component';
import { SinoComponent } from '../../partes/sino/sino.component';

@Component({
  selector: 'app-filtros',
  standalone: true,
  imports: [RouterLink, SeloComponent, SinoComponent],
  templateUrl: './filtros.component.html'
})
export class FiltrosComponent implements OnInit {
  private dados = inject(DadosService);

  carregando = signal(true);
  erro = signal<ErroApi | null>(null);
  lista = signal<PendenteFiltro[]>([]);
  total = signal(0);
  pagina = signal(1);
  gravando = signal<number | null>(null);
  selo = signal<{ titulo: string; linha: string } | null>(null);
  duvida = signal<{ v: PendenteFiltro; motivo: string } | null>(null);

  fPlaca = fPlaca; rotuloSituacao = rotuloSituacao;

  ngOnInit(): void { this.buscar(); }

  buscar(): void {
    this.carregando.set(true); this.erro.set(null);
    this.dados.filaFiltros({ pagina: this.pagina(), limite: 25 }).subscribe({
      next: r => { this.lista.set(r.veiculos); this.total.set(r.total); this.carregando.set(false); },
      error: (e: ErroApi) => { this.erro.set(e); this.carregando.set(false); }
    });
  }

  tom(c?: number): string {
    if (c == null) return 'p-mute';
    return c >= 75 ? 'p-pos' : c >= 45 ? 'p-warn' : 'p-crit';
  }

  aceitar(v: PendenteFiltro, mesmoAssim = false): void {
    this.gravando.set(v.id);
    this.dados.aceitarSugestao(v.id, mesmoAssim).subscribe({
      next: () => {
        this.gravando.set(null);
        this.duvida.set(null);
        this.selo.set({
          titulo: 'Filtros gravados',
          linha: `${fPlaca(v.placa)} · ${v.modelo || 'veículo'}`
        });
        // some da fila: ela mostra só quem ainda não tem filtro
        this.lista.update(l => l.filter(x => x.id !== v.id));
        this.total.update(t => Math.max(0, t - 1));
      },
      error: (e: ErroApi) => {
        this.gravando.set(null);
        // 409 = confiança baixa; o servidor quer confirmação explícita
        if (e.status === 409) this.duvida.set({ v, motivo: e.mensagem });
        else this.erro.set(e);
      }
    });
  }

  proxima(): void { this.pagina.update(p => p + 1); this.buscar(); }
  anterior(): void { this.pagina.update(p => Math.max(1, p - 1)); this.buscar(); }
}
