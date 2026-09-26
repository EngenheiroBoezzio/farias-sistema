/* Ficha do veículo, com a subseção de filtros que o cliente pediu.
   É aqui que a Raíssa preenche o código da peça uma vez por carro. */
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DadosService } from '../../nucleo/dados.service';
import { Servico, Veiculo } from '../../nucleo/tipos';
import { ErroApi } from '../../nucleo/api.service';
import { data, dataHora, dinheiro, km, litros, placa as fPlaca,
         telefone, rotuloSituacao, haQuanto, trocouFiltroAr } from '../../nucleo/formato';
import { SeloComponent } from '../../partes/selo/selo.component';
import { SinoComponent } from '../../partes/sino/sino.component';
import { ModalServicoComponent } from '../../partes/modal-servico/modal-servico.component';
import { PlacaMercosulComponent } from '../../partes/placa-mercosul/placa-mercosul.component';
import { EtiquetaService, INTERVALOS_COMUNS } from '../../nucleo/etiqueta.service';

@Component({
  selector: 'app-ficha',
  standalone: true,
  imports: [FormsModule, RouterLink, SeloComponent, SinoComponent, ModalServicoComponent, PlacaMercosulComponent],
  templateUrl: './ficha.component.html'
})
export class FichaComponent implements OnInit {
  private dados = inject(DadosService);
  private rota = inject(ActivatedRoute);
  private etiquetaService = inject(EtiquetaService);

  id = 0;
  carregando = signal(true);
  erro = signal<ErroApi | null>(null);
  v = signal<Veiculo | null>(null);
  historico = signal<Servico[]>([]);
  gravando = signal(false);
  selo = signal<string | null>(null);
  servicoParaEditar = signal<Servico | null>(null);

  readonly intervalosComuns = INTERVALOS_COMUNS;
  intervaloVeiculo = signal<number>(7000);

  f = { filtro_oleo: '', filtro_ar: '', filtro_cabine: '', filtro_combustivel: '' };

  data = data; dataHora = dataHora; dinheiro = dinheiro; km = km; litros = litros;
  fPlaca = fPlaca; telefone = telefone;
  rotuloSituacao = rotuloSituacao; haQuanto = haQuanto; trocouFiltroAr = trocouFiltroAr;

  proximaTrocaKm(): number | null {
    const veic = this.v();
    const kmUltimo = veic?.ultimo_km ?? this.historico()?.[0]?.km;
    return this.etiquetaService.calcularProximaTroca(kmUltimo, this.intervaloVeiculo());
  }

  definirIntervalo(v: number): void {
    this.intervaloVeiculo.set(v);
    const veic = this.v();
    this.etiquetaService.salvarIntervalo(v, veic?.cliente_id, veic?.placa);
    this.selo.set(`Intervalo de ${this.km(v)} salvo para a etiqueta`);
  }

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
        const int = this.etiquetaService.obterIntervalo(r.veiculo.cliente_id, r.veiculo.placa, r.veiculo.ultimo_oleo);
        this.intervaloVeiculo.set(int);
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

  abrirEdicao(s: Servico): void {
    this.servicoParaEditar.set(s);
  }

  aoSalvarServico(atualizado: Servico): void {
    this.historico.update(lista =>
      lista.map(item => item.id === atualizado.id ? atualizado : item)
    );
    // Se o serviço editado for o primeiro (mais recente), atualiza último km e data no cabeçalho do veículo
    const lista = this.historico();
    if (lista.length && lista[0].id === atualizado.id) {
      this.v.update(veic => veic ? {
        ...veic,
        ultimo_km: atualizado.km ?? veic.ultimo_km,
        ultima_troca: atualizado.data ?? veic.ultima_troca,
        ultimo_oleo: atualizado.oleo ?? veic.ultimo_oleo
      } : veic);
    }
    this.selo.set('Atendimento atualizado com sucesso');
  }

  /* O histórico com o intervalo até a troca anterior.

     Era uma tabela de datas e valores, e faltava o número que torna a etiqueta
     confiável: QUANTOS KM esse motorista roda entre uma troca e outra. Com
     três ou quatro trocas registradas dá para dizer "roda 8.400 km por troca"
     em vez de chutar 10 mil para todo mundo — quem roda 6 mil não é quem roda
     15 mil, e o adesivo do vidro devia saber disso.

     Só calcula quando as DUAS pontas têm km anotado: metade dos registros
     antigos veio da planilha sem quilometragem, e inventar a diferença seria
     pior do que deixar em branco. */
  historicoComIntervalo = computed(() => {
    const lista = this.historico();
    return lista.map((h, i) => {
      const anterior = lista[i + 1];
      const podeCalcular = h.km != null && anterior?.km != null && h.km > anterior.km;
      return {
        ...h,
        rodou: podeCalcular ? h.km! - anterior.km! : null,
        meses: this.mesesEntre(anterior?.data, h.data)
      };
    });
  });

  /** A média de km por troca deste motorista, quando dá para medir. */
  mediaPorTroca = computed(() => {
    const vals = this.historicoComIntervalo()
      .map(h => h.rodou).filter((v): v is number => v != null);
    if (vals.length === 0) return null;
    return { media: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), amostra: vals.length };
  });

  private mesesEntre(de?: string | null, ate?: string | null): number | null {
    if (!de || !ate) return null;
    const a = new Date(de).getTime(), b = new Date(ate).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
    return Math.round((b - a) / (1000 * 60 * 60 * 24 * 30.4));
  }

  ultimoServico(): Servico | null {
    const h = this.historico();
    return h.length > 0 ? h[0] : null;
  }
}
