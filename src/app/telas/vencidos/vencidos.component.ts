/* Fila de recuperação: quem está com a troca vencida.
   O link do WhatsApp vem pronto do servidor, com o texto montado a partir do
   carro. Quem clica e envia é o atendente — envio automático em massa derruba
   o número da oficina. */
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DadosService } from '../../nucleo/dados.service';
import { ItemFila, ResultadoAvisos } from '../../nucleo/tipos';
import { ErroApi } from '../../nucleo/api.service';
import { data, km, placa as fPlaca, telefone, haQuanto } from '../../nucleo/formato';
import { SinoComponent } from '../../partes/sino/sino.component';
import { PlacaMercosulComponent } from '../../partes/placa-mercosul/placa-mercosul.component';

@Component({
  selector: 'app-vencidos',
  standalone: true,
  imports: [RouterLink, SinoComponent, PlacaMercosulComponent],
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

  /* A fila agrupada por quanto tempo faz desde a última troca.

     Isto não é enfeite: quem venceu há pouco ainda lembra da oficina e volta
     muito mais do que quem sumiu há dois anos. Chamar na ordem certa é a
     diferença entre uma tarde bem gasta e uma lista de números frios. A API
     já devolve a fila ordenada, então aqui é só recortar em faixas.

     O recorte vale para a PÁGINA atual, não para os 211 da base — por isso o
     cabeçalho de cada faixa conta os itens que estão à vista, e não promete
     um total que ele não tem. */
  grupos = computed(() => {
    const faixas = [
      { chave: 'recente', ate: 365, rotulo: 'Última troca há menos de um ano',
        dica: 'é quem mais volta — comece por aqui' },
      { chave: 'meio',    ate: 730, rotulo: 'Entre um e dois anos', dica: '' },
      { chave: 'antigo',  ate: Infinity, rotulo: 'Mais de dois anos',
        dica: 'muitos já trocam em outro lugar' }
    ];
    return faixas
      .map(f => ({
        ...f,
        itens: this.fila().filter(i =>
          i.dias <= f.ate && i.dias > (faixas[faixas.indexOf(f) - 1]?.ate ?? -1))
      }))
      .filter(f => f.itens.length > 0);
  });

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
