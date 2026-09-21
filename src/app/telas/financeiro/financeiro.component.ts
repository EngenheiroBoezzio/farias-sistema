import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Chart } from 'chart.js/auto';
import { DadosService } from '../../nucleo/dados.service';
import { ConfigService } from '../../nucleo/config.service';
import { Painel, Servico } from '../../nucleo/tipos';
import { ErroApi } from '../../nucleo/api.service';
import { dinheiro, inteiro, num, mesCurto } from '../../nucleo/formato';
import { SinoComponent } from '../../partes/sino/sino.component';

export type FiltroPeriodo = '12m' | '6m' | 'ano' | 'tudo';
export type VisualizacaoGrafico = 'linha' | 'barras';

export interface MesFinanceiro {
  mes: string;
  mesExtenso: string;
  mesRotulo: string;
  ano: number;
  ordens: number;
  faturamento: number;
  custos: number;
  lucro: number;
  margem: number;
  ticket: number;
  positivo: boolean;
}

const MESES_NOMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

@Component({
  selector: 'app-financeiro',
  standalone: true,
  imports: [CommonModule, RouterLink, SinoComponent],
  templateUrl: './financeiro.component.html'
})
export class FinanceiroComponent implements OnInit, OnDestroy {
  private dados = inject(DadosService);
  private cfg = inject(ConfigService);

  @ViewChild('graficoCanvas') canvasRef?: ElementRef<HTMLCanvasElement>;
  private chartInstancia?: Chart;

  carregando = signal(true);
  erro = signal<ErroApi | null>(null);

  painel = signal<Painel | null>(null);
  servicos = signal<Servico[]>([]);

  periodo = signal<FiltroPeriodo>('12m');
  tipoGrafico = signal<VisualizacaoGrafico>('barras');

  // Helpers de formatação
  dinheiro = dinheiro;
  inteiro = inteiro;
  num = num;

  /** Margem padrão de custo de insumos (óleo, filtros, embalagens) sobre ordens quando não itemizadas: 50% */
  private margemCustoPadrao = 0.50;

  /**
   * Consolidação mês a mês calculada a partir do histórico de ordens e série do painel.
   */
  todosMeses = computed<MesFinanceiro[]>(() => {
    const p = this.painel();
    if (!p || !p.serie || p.serie.length === 0) return [];

    // Mapeia os custos registrados nos serviços individuais por mês (YYYY-MM)
    const custosPorMes: Record<string, { filtros: number; totalOrdens: number; somaTotal: number }> = {};
    for (const s of this.servicos()) {
      if (!s.data) continue;
      const mesChave = s.data.slice(0, 7);
      if (!custosPorMes[mesChave]) {
        custosPorMes[mesChave] = { filtros: 0, totalOrdens: 0, somaTotal: 0 };
      }
      const cFiltros = num(s.valor_filtro_oleo) + num(s.valor_filtro_ar);
      custosPorMes[mesChave].filtros += cFiltros;
      custosPorMes[mesChave].totalOrdens += 1;
      custosPorMes[mesChave].somaTotal += num(s.total);
    }

    return p.serie.map(s => {
      const [anoStr, mesStr] = s.mes.split('-');
      const mesIdx = Math.max(0, parseInt(mesStr, 10) - 1);
      const anoNum = parseInt(anoStr, 10);
      const fat = num(s.valor);
      const ord = s.n;

      // Cálculo de custos:
      // Se houver registro granular de filtros para o mês, computa filtros + custo estimado de lubrificantes
      const granular = custosPorMes[s.mes];
      let custo = 0;
      if (granular && granular.filtros > 0) {
        // Custo direto de filtros conhecidos + estimativa de insumos de lubrificante (~35% do faturamento)
        custo = granular.filtros + (fat * 0.35);
      } else {
        // Custo padrão de CMV (lubrificantes e peças) da troca de óleo
        custo = fat * this.margemCustoPadrao;
      }

      // Arredonda para 2 casas decimais
      custo = Math.round(custo * 100) / 100;
      const lucro = Math.round((fat - custo) * 100) / 100;
      const margem = fat > 0 ? (lucro / fat) * 100 : 0;
      const ticket = ord > 0 ? fat / ord : 0;

      const mesExtenso = `${MESES_NOMES[mesIdx]} de ${anoNum}`;
      const mesRotulo = mesCurto(s.mes);

      return {
        mes: s.mes,
        mesExtenso,
        mesRotulo,
        ano: anoNum,
        ordens: ord,
        faturamento: fat,
        custos: custo,
        lucro,
        margem,
        ticket,
        positivo: lucro >= 0
      };
    });
  });

  /**
   * Meses filtrados de acordo com o seletor de período.
   */
  mesesFiltrados = computed<MesFinanceiro[]>(() => {
    const lista = this.todosMeses();
    const filtro = this.periodo();

    if (filtro === 'tudo') return lista;

    if (filtro === 'ano') {
      const anoAtual = new Date().getFullYear();
      const doAno = lista.filter(m => m.ano === anoAtual);
      return doAno.length > 0 ? doAno : lista.slice(-12);
    }

    if (filtro === '6m') {
      return lista.slice(-6);
    }

    // Padrão: 12 meses
    return lista.slice(-12);
  });

  /**
   * Totais consolidados para os cards de topo e rodapé da tabela.
   */
  totais = computed(() => {
    const lista = this.mesesFiltrados();
    let faturamento = 0;
    let custos = 0;
    let ordens = 0;

    for (const m of lista) {
      faturamento += m.faturamento;
      custos += m.custos;
      ordens += m.ordens;
    }

    faturamento = Math.round(faturamento * 100) / 100;
    custos = Math.round(custos * 100) / 100;
    const lucro = Math.round((faturamento - custos) * 100) / 100;
    const margem = faturamento > 0 ? (lucro / faturamento) * 100 : 0;
    const ticketMedio = ordens > 0 ? faturamento / ordens : 0;

    return {
      faturamento,
      custos,
      lucro,
      margem,
      ticketMedio,
      ordens,
      positivo: lucro >= 0
    };
  });

  ngOnInit(): void {
    // Sincroniza estilo inicial com preferência do usuário ou padrão barras
    const pref = this.cfg.tipoGrafico;
    if (pref === 'linha' || pref === 'barras') {
      this.tipoGrafico.set(pref);
    }
    this.buscar();
  }

  ngOnDestroy(): void {
    if (this.chartInstancia) {
      this.chartInstancia.destroy();
      this.chartInstancia = undefined;
    }
  }

  selecionarPeriodo(p: FiltroPeriodo): void {
    this.periodo.set(p);
    setTimeout(() => this.renderizarGrafico(), 20);
  }

  alternarTipoGrafico(tipo: VisualizacaoGrafico): void {
    this.tipoGrafico.set(tipo);
    setTimeout(() => this.renderizarGrafico(), 20);
  }

  buscar(): void {
    this.carregando.set(true);
    this.erro.set(null);

    // Carrega dados agregados do painel
    this.dados.painel().subscribe({
      next: p => {
        this.painel.set(p);

        // Tenta carregar histórico de serviços recentes para refinar custos de filtros
        this.dados.servicos({ limite: 1000 }).subscribe({
          next: resp => {
            if (resp?.servicos) {
              this.servicos.set(resp.servicos);
            }
            this.carregando.set(false);
            setTimeout(() => this.renderizarGrafico(), 50);
          },
          error: () => {
            // Se servicos falhar, segue com a consolidação nativa da série do painel
            this.carregando.set(false);
            setTimeout(() => this.renderizarGrafico(), 50);
          }
        });
      },
      error: (e: ErroApi) => {
        this.erro.set(e);
        this.carregando.set(false);
      }
    });
  }

  private renderizarGrafico(): void {
    if (!this.canvasRef?.nativeElement) return;
    const ctx = this.canvasRef.nativeElement.getContext('2d');
    if (!ctx) return;

    if (this.chartInstancia) {
      this.chartInstancia.destroy();
      this.chartInstancia = undefined;
    }

    const dados = this.mesesFiltrados();
    if (dados.length === 0) return;

    const rotulos = dados.map(d => d.mesRotulo);
    const fatValores = dados.map(d => d.faturamento);
    const custosValores = dados.map(d => d.custos);
    const lucroValores = dados.map(d => d.lucro);
    const tipo = this.tipoGrafico();

    const tooltipConfig = {
      backgroundColor: '#18181B',
      titleColor: '#FEE2E2',
      bodyColor: '#FFFFFF',
      padding: 12,
      cornerRadius: 8,
      callbacks: {
        title: (items: any[]) => {
          if (!items.length) return '';
          const idx = items[0].dataIndex;
          return dados[idx]?.mesExtenso || items[0].label;
        },
        label: (item: any) => {
          const dsLabel = item.dataset.label || '';
          const valor = item.raw as number;
          return `${dsLabel}: ${dinheiro(valor)}`;
        },
        afterBody: (items: any[]) => {
          if (!items.length) return [];
          const idx = items[0].dataIndex;
          const d = dados[idx];
          if (!d) return [];
          return [
            `Ordens: ${inteiro(d.ordens)}`,
            `Margem: ${d.margem.toFixed(1)}%`
          ];
        }
      }
    };

    const escalas = {
      x: {
        grid: { display: false },
        ticks: {
          color: '#64748B',
          font: { family: 'inherit', size: 11 }
        }
      },
      y: {
        grid: { color: 'rgba(203, 213, 225, 0.35)' },
        ticks: {
          color: '#64748B',
          font: { family: 'inherit', size: 11 },
          callback: (val: any) => {
            const n = Number(val);
            return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
          }
        }
      }
    };

    if (tipo === 'barras') {
      this.chartInstancia = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: rotulos,
          datasets: [
            {
              label: 'Faturamento',
              data: fatValores,
              backgroundColor: '#9E1822',
              borderRadius: 6,
              maxBarThickness: 28
            },
            {
              label: 'Custos / Despesas',
              data: custosValores,
              backgroundColor: '#EA580C',
              borderRadius: 6,
              maxBarThickness: 28
            },
            {
              label: 'Lucro Líquido',
              data: lucroValores,
              backgroundColor: lucroValores.map(v => v >= 0 ? '#16855A' : '#B4362A'),
              borderRadius: 6,
              maxBarThickness: 28
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: true,
              position: 'top',
              align: 'end',
              labels: {
                boxWidth: 12,
                boxHeight: 12,
                padding: 14,
                font: { size: 12, family: 'inherit' }
              }
            },
            tooltip: tooltipConfig
          },
          scales: escalas
        }
      });
    } else {
      // Gráfico de Linhas
      this.chartInstancia = new Chart(ctx, {
        type: 'line',
        data: {
          labels: rotulos,
          datasets: [
            {
              label: 'Faturamento',
              data: fatValores,
              borderColor: '#9E1822',
              backgroundColor: '#9E1822',
              borderWidth: 2.5,
              tension: 0.28,
              fill: false,
              pointRadius: 4,
              pointHoverRadius: 7,
              pointBackgroundColor: '#9E1822'
            },
            {
              label: 'Custos / Despesas',
              data: custosValores,
              borderColor: '#EA580C',
              backgroundColor: '#EA580C',
              borderWidth: 2.2,
              tension: 0.28,
              fill: false,
              pointRadius: 4,
              pointHoverRadius: 7,
              pointBackgroundColor: '#EA580C'
            },
            {
              label: 'Lucro Líquido',
              data: lucroValores,
              borderColor: '#16855A',
              backgroundColor: '#16855A',
              borderWidth: 2.5,
              tension: 0.28,
              fill: false,
              pointRadius: 4,
              pointHoverRadius: 7,
              pointBackgroundColor: '#16855A'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: true,
              position: 'top',
              align: 'end',
              labels: {
                boxWidth: 12,
                boxHeight: 12,
                padding: 14,
                font: { size: 12, family: 'inherit' }
              }
            },
            tooltip: tooltipConfig
          },
          scales: escalas
        }
      });
    }
  }
}
