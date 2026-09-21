import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Chart } from 'chart.js/auto';
import { DadosService } from '../../nucleo/dados.service';
import { ConfigService, TipoGrafico } from '../../nucleo/config.service';
import { Painel } from '../../nucleo/tipos';
import { ErroApi } from '../../nucleo/api.service';
import { dinheiro, inteiro, num, data, mesCurto, placa } from '../../nucleo/formato';
import { SinoComponent } from '../../partes/sino/sino.component';

@Component({
  selector: 'app-painel',
  standalone: true,
  imports: [RouterLink, SinoComponent],
  templateUrl: './painel.component.html'
})
export class PainelComponent implements OnInit, OnDestroy {
  private dados = inject(DadosService);
  private cfg = inject(ConfigService);

  @ViewChild('graficoCanvas') canvasRef?: ElementRef<HTMLCanvasElement>;
  private chartInstancia?: Chart;

  tipoGrafico = signal<TipoGrafico>('linha');
  carregando = signal(true);
  erro = signal<ErroApi | null>(null);
  p = signal<Painel | null>(null);

  dinheiro = dinheiro; inteiro = inteiro; data = data;
  mesCurto = mesCurto; placa = placa; num = num;

  /** Fatia de cada situação, para a barra de composição. */
  situacoes = computed(() => {
    const r = this.p()?.resumo;
    if (!r) return [];
    const tot = Math.max(1, r.em_dia + r.vencido + r.parado + r.frio);
    const def = [
      { chave: 'em_dia',  rotulo: 'Em dia',  ajuda: 'dentro do intervalo', n: r.em_dia,  cor: 'var(--pos)' },
      { chave: 'vencido', rotulo: 'Vencido', ajuda: 'passou da hora',      n: r.vencido, cor: 'var(--warn)' },
      { chave: 'parado',  rotulo: 'Parado',  ajuda: 'mais de um ano',      n: r.parado,  cor: 'var(--crit)' },
      { chave: 'frio',    rotulo: 'Frio',    ajuda: 'mais de dois anos',   n: r.frio,    cor: 'var(--n-300)' }
    ];
    return def.map(d => ({ ...d, pc: d.n / tot * 100, pcTexto: Math.round(d.n / tot * 100) + '%' }));
  });

  maiorOleo = computed(() => Math.max(1, ...(this.p()?.oleos ?? []).map(o => o.n)));

  ngOnInit(): void {
    this.tipoGrafico.set(this.cfg.tipoGrafico);
    this.buscar();
  }

  ngOnDestroy(): void {
    if (this.chartInstancia) {
      this.chartInstancia.destroy();
      this.chartInstancia = undefined;
    }
  }

  selecionarTipoGrafico(tipo: TipoGrafico): void {
    this.tipoGrafico.set(tipo);
    this.cfg.salvar({ tipoGrafico: tipo });
    const p = this.p();
    if (p) {
      setTimeout(() => this.renderizarGrafico(p), 10);
    }
  }

  buscar(): void {
    this.carregando.set(true);
    this.erro.set(null);
    this.dados.painel().subscribe({
      next: p => {
        this.p.set(p);
        this.carregando.set(false);
        setTimeout(() => this.renderizarGrafico(p), 50);
      },
      error: (e: ErroApi) => { this.erro.set(e); this.carregando.set(false); }
    });
  }

  private renderizarGrafico(painel: Painel): void {
    if (!this.canvasRef?.nativeElement) return;
    const ctx = this.canvasRef.nativeElement.getContext('2d');
    if (!ctx) return;

    if (this.chartInstancia) {
      this.chartInstancia.destroy();
      this.chartInstancia = undefined;
    }

    const serie = painel.serie || [];
    if (serie.length === 0) return;

    const rotulos = serie.map(s => {
      const parts = mesCurto(s.mes).split('/');
      return parts[0] + (parts[1] ? `/${parts[1].slice(-2)}` : '');
    });
    const valores = serie.map(s => num(s.valor));
    const ordens = serie.map(s => s.n);
    const tipo = this.tipoGrafico();

    const gradiente = ctx.createLinearGradient(0, 0, 0, 220);
    gradiente.addColorStop(0, 'rgba(185, 28, 28, 0.32)');
    gradiente.addColorStop(1, 'rgba(185, 28, 28, 0.01)');

    const tooltipConfig = {
      backgroundColor: '#18181B',
      titleColor: '#FEE2E2',
      bodyColor: '#FFFFFF',
      padding: 10,
      cornerRadius: 8,
      displayColors: tipo === 'pizza',
      callbacks: {
        label: (item: any) => {
          const idx = item.dataIndex;
          const v = item.raw as number;
          return [
            `Faturamento: ${dinheiro(v)}`,
            `Ordens: ${ordens[idx] || 0}`
          ];
        }
      }
    };

    const escalasPadrao = {
      x: {
        grid: { display: false },
        ticks: {
          color: '#64748B',
          font: { family: 'inherit', size: 11 },
          maxRotation: 0
        }
      },
      y: {
        grid: { color: 'rgba(203, 213, 225, 0.4)' },
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
          datasets: [{
            label: 'Entrada (R$)',
            data: valores,
            backgroundColor: serie.map((_, idx) => idx === serie.length - 1 ? '#F59E0B' : '#B91C1C'),
            borderRadius: 6,
            borderSkipped: false,
            maxBarThickness: 38
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: tooltipConfig
          },
          scales: escalasPadrao
        }
      });
    } else if (tipo === 'pizza') {
      const paleta = [
        '#9E1822', '#B91C1C', '#DC2626', '#EF4444',
        '#F59E0B', '#16855A', '#2563EB', '#7C3AED',
        '#DB2777', '#EA580C', '#475569', '#0D9488'
      ];
      this.chartInstancia = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: rotulos,
          datasets: [{
            label: 'Entrada (R$)',
            data: valores,
            backgroundColor: paleta.slice(0, rotulos.length),
            borderWidth: 2,
            borderColor: '#FFFFFF'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '58%',
          plugins: {
            legend: {
              display: true,
              position: 'right',
              labels: { boxWidth: 12, padding: 8, font: { size: 11 } }
            },
            tooltip: tooltipConfig
          }
        }
      });
    } else if (tipo === 'area') {
      this.chartInstancia = new Chart(ctx, {
        type: 'line',
        data: {
          labels: rotulos,
          datasets: [{
            label: 'Entrada (R$)',
            data: valores,
            borderColor: '#9E1822',
            backgroundColor: gradiente,
            borderWidth: 2.5,
            fill: true,
            tension: 0.38,
            pointBackgroundColor: '#9E1822',
            pointBorderColor: '#FFFFFF',
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 7
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: tooltipConfig
          },
          scales: escalasPadrao
        }
      });
    } else {
      // Linha (padrão)
      this.chartInstancia = new Chart(ctx, {
        type: 'line',
        data: {
          labels: rotulos,
          datasets: [{
            label: 'Entrada (R$)',
            data: valores,
            borderColor: '#B91C1C',
            backgroundColor: '#B91C1C',
            borderWidth: 2.5,
            fill: false,
            tension: 0.32,
            pointBackgroundColor: '#B91C1C',
            pointBorderColor: '#FFFFFF',
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 7
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: tooltipConfig
          },
          scales: escalasPadrao
        }
      });
    }
  }
}
