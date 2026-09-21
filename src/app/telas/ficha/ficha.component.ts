/* Ficha do veículo, com a subseção de filtros que o cliente pediu.
   É aqui que a Raíssa preenche o código da peça uma vez por carro. */
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DadosService } from '../../nucleo/dados.service';
import { Servico, Veiculo } from '../../nucleo/tipos';
import { ErroApi } from '../../nucleo/api.service';
import { data, dataHora, dinheiro, km, litros, placa as fPlaca,
         telefone, rotuloSituacao, haQuanto } from '../../nucleo/formato';
import { SeloComponent } from '../../partes/selo/selo.component';
import { SinoComponent } from '../../partes/sino/sino.component';

@Component({
  selector: 'app-ficha',
  standalone: true,
  imports: [FormsModule, RouterLink, SeloComponent, SinoComponent],
  templateUrl: './ficha.component.html'
})
export class FichaComponent implements OnInit {
  private dados = inject(DadosService);
  private rota = inject(ActivatedRoute);

  id = 0;
  carregando = signal(true);
  erro = signal<ErroApi | null>(null);
  v = signal<Veiculo | null>(null);
  historico = signal<Servico[]>([]);
  gravando = signal(false);
  selo = signal<string | null>(null);

  f = { filtro_oleo: '', filtro_ar: '', filtro_cabine: '', filtro_combustivel: '' };

  data = data; dataHora = dataHora; dinheiro = dinheiro; km = km; litros = litros;
  fPlaca = fPlaca; telefone = telefone;
  rotuloSituacao = rotuloSituacao; haQuanto = haQuanto;

  ngOnInit(): void {
    this.id = Number(this.rota.snapshot.paramMap.get('id'));
    this.buscar();
  }

  buscar(): void {
    this.carregando.set(true); this.erro.set(null);
    this.dados.veiculo(this.id).subscribe({
      next: r => {
        this.v.set(r.veiculo);
        this.historico.set(r.historico);
        this.f = {
          filtro_oleo: r.veiculo.filtro_oleo ?? '',
          filtro_ar: r.veiculo.filtro_ar ?? '',
          filtro_cabine: r.veiculo.filtro_cabine ?? '',
          filtro_combustivel: r.veiculo.filtro_combustivel ?? ''
        };
        this.carregando.set(false);
      },
      error: (e: ErroApi) => { this.erro.set(e); this.carregando.set(false); }
    });
  }

  gravarFiltros(): void {
    if (this.gravando()) return;
    const corpo: any = {};
    for (const k of Object.keys(this.f) as (keyof typeof this.f)[]) {
      const val = this.f[k].trim();
      if (val) corpo[k] = val.toUpperCase();
    }
    if (!Object.keys(corpo).length) {
      this.erro.set({ status: 400, mensagem: 'Informe ao menos um filtro.' });
      return;
    }
    this.gravando.set(true);
    this.erro.set(null);
    this.dados.gravarFiltros(this.id, corpo).subscribe({
      next: r => {
        this.gravando.set(false);
        this.v.update(v => v ? { ...v, ...r.veiculo } : v);
        this.selo.set('Filtros gravados');
      },
      error: (e: ErroApi) => { this.gravando.set(false); this.erro.set(e); }
    });
  }
}
