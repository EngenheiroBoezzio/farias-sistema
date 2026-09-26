import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Chart } from 'chart.js/auto';
import { DadosService } from '../../nucleo/dados.service';
import { ConfigService, TipoGrafico } from '../../nucleo/config.service';
import { Painel } from '../../nucleo/tipos';
import { ErroApi } from '../../nucleo/api.service';
import { dinheiro, inteiro, num, data, mesCurto, placa } from '../../nucleo/formato';
import { SinoComponent } from '../../partes/sino/sino.component';
import { PlacaMercosulComponent } from '../../partes/placa-mercosul/placa-mercosul.component';

@Component({
  selector: 'app-painel',
  standalone: true,
  imports: [RouterLink, SinoComponent, PlacaMercosulComponent],
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

  /* A data por extenso no subtítulo. Parece detalhe, mas é o que faz a tela
     parecer de hoje: "Quinta, 24 de setembro" diz que o número é de agora,
     coisa que "Como a oficina está hoje" não dizia. */
  hoje = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long'
  }).replace(/^./, c => c.toUpperCase());

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

    /* As cores do gráfico saem do CSS, não ficam cravadas aqui.

       Estavam sete valores escritos à mão neste arquivo — #B91C1C, #F59E0B,
       #18181B, #FEE2E2, #64748B e dois rgba de slate. Dois problemas: eles
       não acompanhavam a paleta (o vermelho daqui era o do Tailwind, não o da
       logo) e no tema escuro o eixo ficava cinza-claro sobre fundo escuro.
       Lendo do :root, o gráfico segue o tema sozinho. */
    const tok = (nome: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
    const corMarca = tok('--b-700') || '#8E0A10';
    const corMarcaFraca = tok('--b-300') || '#EE8387';
    const corEixo = tok('--n-400') || '#8A817B';
    const corGrade = tok('--n-100') || '#E7E2DC';
    const corTinta = tok('--n-900') || '#1A1512';
    const corPapel = tok('--n-0') || '#FFFFFF';
    const paletaSerie = ['--c1','--c2','--c3','--c4','--c5','--c6'].map(v => tok(v));

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
    gradiente.addColorStop(0, corMarca + '55');
    gradiente.addColorStop(1, corMarca + '03');

    const tooltipConfig = {
      backgroundColor: corTinta,
      titleColor: corMarcaFraca,
      bodyColor: corPapel,
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
          color: corEixo,
          font: { family: 'inherit', size: 11 },
          maxRotation: 0
        }
      },
      y: {
        grid: { color: corGrade },
        ticks: {
          color: corEixo,
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
            /* O mês em aberto era uma barra DOURADA: 2,2:1 de contraste sobre
               branco, ou seja, o mês que mais importa era o que menos se
               enxergava. Agora ele é a mesma cor, mas vazado com contorno —
               que além de visível diz POR QUE ele é diferente. */
            backgroundColor: serie.map((_, idx) =>
              idx === serie.length - 1 ? corMarca + '33' : corMarca),
            borderColor: corMarca,
            borderWidth: serie.map((_, idx) => idx === serie.length - 1 ? 2 : 0),
            borderRadius: 4,
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
      const paleta = paletaSerie;
      this.chartInstancia = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: rotulos,
          datasets: [{
            label: 'Entrada (R$)',
            data: valores,
            backgroundColor: paleta.slice(0, rotulos.length),
            borderWidth: 2,
            borderColor: corPapel
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
            borderColor: corMarca,
            backgroundColor: gradiente,
            borderWidth: 2.5,
            fill: true,
            tension: 0.38,
            pointBackgroundColor: corMarca,
            pointBorderColor: corPapel,
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
            borderColor: corMarca,
            backgroundColor: corMarca,
            borderWidth: 2.5,
            fill: false,
            tension: 0.32,
            pointBackgroundColor: corMarca,
            pointBorderColor: corPapel,
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
