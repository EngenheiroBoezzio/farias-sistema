/* Fila de recuperação: quem está com a troca vencida.
   O link do WhatsApp vem pronto do servidor, com o texto montado a partir do
   carro. Quem clica e envia é o atendente — envio automático em massa derruba
   o número da oficina. */
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DadosService } from '../../nucleo/dados.service';
import { ItemFila, ResultadoAvisos } from '../../nucleo/tipos';
import { ErroApi } from '../../nucleo/api.service';
import { data, km, placa as fPlaca, telefone, haQuanto } from '../../nucleo/formato';
import { SinoComponent } from '../../partes/sino/sino.component';

@Component({
  selector: 'app-vencidos',
  standalone: true,
  imports: [RouterLink, SinoComponent],
  templateUrl: './vencidos.component.html'
})
export class VencidosComponent implements OnInit {
  private dados = inject(DadosService);

  carregando = signal(true);
  erro = signal<ErroApi | null>(null);
  fila = signal<ItemFila[]>([]);
  total = signal(0);
  carencia = signal(30);
  pagina = signal(1);
  resultado = signal<ResultadoAvisos | null>(null);
  avisados = signal<Set<number>>(new Set());

  data = data; km = km; fPlaca = fPlaca; telefone = telefone; haQuanto = haQuanto;

  ngOnInit(): void {
    this.buscar();
    this.dados.resultadoAvisos(90).subscribe({
      next: r => this.resultado.set(r),
      error: () => {}
    });
  }

  buscar(): void {
    this.carregando.set(true); this.erro.set(null);
    this.dados.fila({ tipo: 'vencido', pagina: this.pagina(), limite: 25 }).subscribe({
      next: r => {
        this.fila.set(r.fila);
        this.total.set(r.total);
        this.carencia.set(r.carencia_dias);
        this.carregando.set(false);
      },
      error: (e: ErroApi) => { this.erro.set(e); this.carregando.set(false); }
    });
  }

  /* Abre o WhatsApp e registra o contato. Registrar é o que impede a mesma
     pessoa de ser chamada de novo na semana seguinte. */
  chamar(i: ItemFila): void {
    if (i.whatsapp) window.open(i.whatsapp, '_blank');
    this.dados.registrarAviso(i.veiculo_id, 'vencido').subscribe({
      next: () => this.avisados.update(s => new Set(s).add(i.veiculo_id)),
      error: () => { /* o link já abriu; não vale travar a tela por isso */ }
    });
  }

  proxima(): void { this.pagina.update(p => p + 1); this.buscar(); }
  anterior(): void { this.pagina.update(p => Math.max(1, p - 1)); this.buscar(); }
}
