/* A tela de quem administra a oficina.
 *
 * Os comandos ficam todos numa barra no topo, em grupos nomeados, e as seções
 * viram abas no rodapé — a anatomia de uma planilha, que é o programa que a
 * pessoa que cuida das contas já sabe usar. Antes cada botão morava dentro da
 * aba a que servia, e lançar uma despesa exigia primeiro achar a aba certa.
 *
 * Um aviso que a tela precisa dar e dava: o "sobrou" só desconta o que foi
 * lançado à mão em Despesas. O óleo e o filtro que saem do estoque a cada
 * ordem não entram, porque a ordem de serviço grava o preço de venda e não o
 * custo da peça. Enquanto isso não existir no banco, o número é otimista — e
 * a tela diz isso em voz alta em vez de fingir que fecha.
 */
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Chart } from 'chart.js/auto';

import { DadosService } from '../../nucleo/dados.service';
import { ConfigService, TipoGrafico } from '../../nucleo/config.service';
import { FinanceiroService, Despesa, ConsolidadoMes, ROTULOS_CATEGORIAS } from '../../nucleo/financeiro.service';
import { Painel, Servico } from '../../nucleo/tipos';
import { ErroApi } from '../../nucleo/api.service';
import { dinheiro, inteiro, num, mesCurto, data, placa } from '../../nucleo/formato';
import { SinoComponent } from '../../partes/sino/sino.component';
import { SeloComponent } from '../../partes/selo/selo.component';
import { ModalDespesaComponent } from '../../partes/modal-despesa/modal-despesa.component';

export type FiltroPeriodo = '6m' | '12m' | 'ano' | 'tudo';
export type AbaFinanceiro = 'visao_geral' | 'ordens' | 'despesas' | 'dre';

const MESES_NOMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

@Component({
  selector: 'app-financeiro',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, SinoComponent, SeloComponent, ModalDespesaComponent],
  templateUrl: './financeiro.component.html'
})
export class FinanceiroComponent implements OnInit, OnDestroy {
  private dados = inject(DadosService);
  private cfg = inject(ConfigService);
  financeiroService = inject(FinanceiroService);

  @ViewChild('graficoCanvas') canvasRef?: ElementRef<HTMLCanvasElement>;
  private chartInstancia?: Chart;

  // Estados principais
  carregando = signal(true);
  erro = signal<ErroApi | null>(null);
  selo = signal<string | null>(null);

  painel = signal<Painel | null>(null);
  todasOrdens = signal<Servico[]>([]);

  // Filtros e Navegação
  periodo = signal<FiltroPeriodo>('12m');
  abaAtiva = signal<AbaFinanceiro>('visao_geral');
  tipoGrafico = signal<TipoGrafico>('barras');

  // Buscas
  buscaOrdens = signal('');
  buscaDespesas = signal('');
  categoriaFiltro = signal<string>('todas');

  // Despesas
  todasDespesas = signal<Despesa[]>([]);
  modalDespesaAberto = signal(false);
  despesaParaEditar = signal<Despesa | null>(null);

  // Formatadores
  dinheiro = dinheiro;
  inteiro = inteiro;

  /* As categorias como lista, para o seletor. O template montava as seis
     <option> à mão, com emoji dentro, e elas saíam de sincronia com o
     ROTULOS_CATEGORIAS toda vez que alguma mudava. */
  readonly categorias = (Object.keys(ROTULOS_CATEGORIAS) as (keyof typeof ROTULOS_CATEGORIAS)[])
    .map(chave => ({ chave, ...ROTULOS_CATEGORIAS[chave] }));

  /** O que sobra das saídas depois de insumos, pessoal e contas fixas. */
  outrasSaidas = computed(() => {
    const t = this.totais();
    const resto = t.despesasTotais - t.custosInsumos - t.despesasPessoal - t.despesasFixas;
    return Math.round(Math.max(0, resto) * 100) / 100;
  });

  somaOrdensFiltradas = computed(() =>
    this.ordensFiltradas().reduce((acc, o) => acc + num(o.total), 0));

  somaDespesasFiltradas = computed(() =>
    this.despesasFiltradas().reduce((acc, d) => acc + num(d.valor), 0));

  /** Quanto cada saída pesa sobre o faturamento. */
  fatia(valor: number): string {
    const f = this.totais().faturamento;
    if (!f) return '—';
    return (valor / f * 100).toFixed(1).replace('.', ',') + '%';
  }

  rotuloPeriodo(): string {
    switch (this.periodo()) {
      case '6m':  return 'últimos 6 meses';
      case '12m': return 'últimos 12 meses';
      case 'ano': return 'ano de ' + new Date().getFullYear();
      default:    return 'todo o histórico';
    }
  }
  num = num;
  data = data;
  placa = placa;
  mesCurto = mesCurto;
  readonly rotulosCategorias = ROTULOS_CATEGORIAS;

  /**
   * Consolidação mês a mês combinando o faturamento do banco de dados
   * com as despesas reais cadastradas.
   */
  todosMeses = computed<ConsolidadoMes[]>(() => {
    const p = this.painel();
    if (!p || !p.serie || p.serie.length === 0) return [];

    // Trigger reativo para quando despesas mudam
    const _ = this.todasDespesas();

    return p.serie.map(s => {
      const fat = num(s.valor);
      const ord = s.n;
      return this.financeiroService.consolidarMes(s.mes, fat, ord);
    });
  });

  /**
   * Meses filtrados pelo período selecionado.
   */
  mesesFiltrados = computed<ConsolidadoMes[]>(() => {
    const lista = this.todosMeses();
    const filtro = this.periodo();

    if (filtro === 'tudo') return lista;

    if (filtro === 'ano') {
      const anoAtual = new Date().getFullYear();
      const doAno = lista.filter(m => m.mes.startsWith(String(anoAtual)));
      return doAno.length > 0 ? doAno : lista.slice(-12);
    }

    if (filtro === '6m') return lista.slice(-6);

    return lista.slice(-12);
  });

  /**
   * Totais consolidados para os cards de topo.
   */
  totais = computed(() => {
    const lista = this.mesesFiltrados();
    let faturamento = 0;
    let custosInsumos = 0;
    let despesasFixas = 0;
    let despesasPessoal = 0;
    let despesasOperacionais = 0;
    let despesasTotais = 0;
    let contasPendentes = 0;
    let ordens = 0;

    for (const m of lista) {
      faturamento += m.faturamentoTotal;
      custosInsumos += m.custoInsumos;
      despesasFixas += m.despesasFixas;
      despesasPessoal += m.despesasPessoal;
      despesasOperacionais += m.despesasOperacionais;
      despesasTotais += m.despesasTotais;
      contasPendentes += m.contasPendentes;
      ordens += m.ordens;
    }

    faturamento = Math.round(faturamento * 100) / 100;
    despesasTotais = Math.round(despesasTotais * 100) / 100;
    const lucroLiquido = Math.round((faturamento - despesasTotais) * 100) / 100;
    const margemLiquida = faturamento > 0 ? (lucroLiquido / faturamento) * 100 : (despesasTotais > 0 ? -100 : 0);
    const ticketMedio = ordens > 0 ? faturamento / ordens : 0;

    return {
      faturamento,
      custosInsumos: Math.round(custosInsumos * 100) / 100,
      despesasFixas: Math.round(despesasFixas * 100) / 100,
      despesasPessoal: Math.round(despesasPessoal * 100) / 100,
      despesasOperacionais: Math.round(despesasOperacionais * 100) / 100,
      despesasTotais,
      lucroLiquido,
      margemLiquida,
      ticketMedio,
      contasPendentes: Math.round(contasPendentes * 100) / 100,
      ordens,
      positivo: lucroLiquido >= 0
    };
  });

  /**
   * Top óleos mais vendidos com percentual de participação.
   */
  topOleos = computed(() => {
    const p = this.painel();
    if (!p || !p.oleos || p.oleos.length === 0) return [];
    const totalVezes = p.oleos.reduce((acc, o) => acc + o.n, 0) || 1;
    return p.oleos.slice(0, 5).map(o => ({
      nome: o.nome,
      qtd: o.n,
      pct: Math.round((o.n / totalVezes) * 100)
    }));
  });

  /**
   * Ordens faturadas filtradas pela busca.
   */
  ordensFiltradas = computed(() => {
    const lista = this.todasOrdens();
    const termo = this.buscaOrdens().trim().toLowerCase();
    if (!termo) return lista;
    return lista.filter(o =>
      (o.placa && o.placa.toLowerCase().includes(termo)) ||
      (o.cliente && o.cliente.toLowerCase().includes(termo)) ||
      (o.modelo && o.modelo.toLowerCase().includes(termo)) ||
      (o.oleo && o.oleo.toLowerCase().includes(termo))
    );
  });

  /**
   * Despesas filtradas por termo e categoria.
   */
  despesasFiltradas = computed<Despesa[]>(() => {
    const lista = this.todasDespesas();
    const termo = this.buscaDespesas().trim().toLowerCase();
    const cat = this.categoriaFiltro();

    return lista.filter(d => {
      const casaTexto = !termo || d.descricao.toLowerCase().includes(termo) || (d.obs && d.obs.toLowerCase().includes(termo));
      const casaCat = cat === 'todas' || d.categoria === cat;
      return casaTexto && casaCat;
    });
  });

  ngOnInit(): void {
    this.carregarDespesasLocais();
    this.buscar();
  }

  ngOnDestroy(): void {
    this.destruirGraficos();
  }

  carregarDespesasLocais(): void {
    this.todasDespesas.set(this.financeiroService.obterDespesas());
  }

  buscar(): void {
    this.carregando.set(true);
    this.erro.set(null);

    // Carrega Painel (resumo + série mensal)
    this.dados.painel().subscribe({
      next: p => {
        this.painel.set(p);
        this.carregando.set(false);
        setTimeout(() => this.renderizarGraficos(), 50);

        // Carrega também as ordens de serviço faturadas
        this.carregarOrdensFaturadas();
      },
      error: (e: ErroApi) => {
        this.erro.set(e);
        this.carregando.set(false);
      }
    });
  }

  carregarOrdensFaturadas(): void {
    this.dados.servicos({ pagina: 1, limite: 100 }).subscribe({
      next: res => {
        if (res && res.servicos) {
          this.todasOrdens.set(res.servicos);
        } else if (this.painel()?.ultimas) {
          // Fallback para as últimas do painel caso rota paginada não retorne
          const ultimas = this.painel()!.ultimas.map((u, i) => ({
            id: i,
            data: u.data,
            km: null,
            oleo: u.oleo,
            litros: null,
            total: u.total,
            placa: u.placa,
            modelo: u.modelo,
            cliente: u.cliente
          }));
          this.todasOrdens.set(ultimas);
        }
      },
      error: () => {
        // Se a rota paginada falhar, usa as últimas do painel
        if (this.painel()?.ultimas) {
          const ultimas = this.painel()!.ultimas.map((u, i) => ({
            id: i,
            data: u.data,
            km: null,
            oleo: u.oleo,
            litros: null,
            total: u.total,
            placa: u.placa,
            modelo: u.modelo,
            cliente: u.cliente
          }));
          this.todasOrdens.set(ultimas);
        }
      }
    });
  }

  selecionarPeriodo(p: FiltroPeriodo): void {
    this.periodo.set(p);
    setTimeout(() => this.renderizarGraficos(), 30);
  }

  mudarAba(aba: AbaFinanceiro): void {
    this.abaAtiva.set(aba);
    if (aba === 'visao_geral') {
      setTimeout(() => this.renderizarGraficos(), 40);
    }
  }

  alternarTipoGrafico(tipo: TipoGrafico): void {
    this.tipoGrafico.set(tipo);
    this.cfg.salvar({ tipoGrafico: tipo });
    this.renderizarGraficos();
  }

  abrirNovaDespesa(): void {
    this.despesaParaEditar.set(null);
    this.modalDespesaAberto.set(true);
  }

  editarDespesa(d: Despesa): void {
    this.despesaParaEditar.set(d);
    this.modalDespesaAberto.set(true);
  }

  aoSalvarDespesa(dados: Omit<Despesa, 'id' | 'criadaEm'>): void {
    const ed = this.despesaParaEditar();
    if (ed) {
      this.financeiroService.editarDespesa(ed.id, dados);
      this.selo.set('Despesa atualizada com sucesso!');
    } else {
      this.financeiroService.adicionarDespesa(dados);
      this.selo.set('Despesa registrada com sucesso!');
    }
    this.modalDespesaAberto.set(false);
    this.despesaParaEditar.set(null);
    this.carregarDespesasLocais();
    setTimeout(() => this.renderizarGraficos(), 50);
  }

  alternarStatusDespesa(d: Despesa): void {
    const novoStatus = d.status === 'pago' ? 'pendente' : 'pago';
    this.financeiroService.editarDespesa(d.id, { status: novoStatus });
    this.carregarDespesasLocais();
    this.selo.set(`Despesa marcada como ${novoStatus === 'pago' ? 'Paga' : 'Pendente'}`);
  }

  excluirDespesa(d: Despesa): void {
    if (confirm(`Excluir a despesa "${d.descricao}" no valor de ${dinheiro(d.valor)}?`)) {
      this.financeiroService.excluirDespesa(d.id);
      this.carregarDespesasLocais();
      this.selo.set('Despesa excluída.');
      setTimeout(() => this.renderizarGraficos(), 50);
    }
  }

  imprimirRelatorio(): void {
    window.print();
  }

  private destruirGraficos(): void {
    if (this.chartInstancia) {
      this.chartInstancia.destroy();
      this.chartInstancia = undefined;
    }
  }

  private renderizarGraficos(): void {
    this.destruirGraficos();

    const dados = this.mesesFiltrados();
    if (dados.length === 0 || !this.canvasRef?.nativeElement) return;

    const ctx = this.canvasRef.nativeElement.getContext('2d');
    if (!ctx) return;

    const rotulos = dados.map(d => mesCurto(d.mes));
    const fatValores = dados.map(d => d.faturamentoTotal);
    const despValores = dados.map(d => d.despesasTotais);
    const lucroValores = dados.map(d => d.lucroLiquido);

    const temDespesas = despValores.some(v => v > 0);
    const tipo = this.tipoGrafico();

    if (tipo === 'barras') {
      const datasets: any[] = [
        {
          label: 'Faturamento',
          data: fatValores,
          backgroundColor: '#9E1822',
          borderRadius: 6,
          maxBarThickness: 28
        }
      ];

      if (temDespesas) {
        datasets.push({
          label: 'Despesas',
          data: despValores,
          backgroundColor: '#EA580C',
          borderRadius: 6,
          maxBarThickness: 28
        });
        datasets.push({
          type: 'line',
          label: 'Saldo Líquido',
          data: lucroValores,
          borderColor: '#10B981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          borderWidth: 3,
          tension: 0.3,
          fill: false,
          pointRadius: 4,
          pointBackgroundColor: '#10B981'
        });
      }

      this.chartInstancia = new Chart(ctx, {
        type: 'bar',
        data: { labels: rotulos, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: true,
              position: 'top',
              align: 'end',
              labels: { boxWidth: 12, font: { size: 12, weight: 'bold' } }
            },
            tooltip: {
              backgroundColor: '#1E1B1B',
              titleColor: '#FEE2E2',
              bodyColor: '#FFFFFF',
              padding: 12,
              cornerRadius: 8,
              callbacks: {
                label: (item: any) => ` ${item.dataset.label}: ${dinheiro(item.raw as number)}`
              }
            }
          },
          scales: {
            x: { grid: { display: false } },
            y: {
              grid: { color: 'rgba(203, 213, 225, 0.25)' },
              ticks: {
                callback: (val: any) => {
                  const n = Number(val);
                  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
                }
              }
            }
          }
        }
      });
    } else {
      // Gráfico de Linhas / Área Suave
      const datasets: any[] = [
        {
          label: 'Faturamento',
          data: fatValores,
          borderColor: '#9E1822',
          backgroundColor: 'rgba(158, 24, 34, 0.12)',
          borderWidth: 2.8,
          tension: 0.3,
          fill: true,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#9E1822'
        }
      ];

      if (temDespesas) {
        datasets.push({
          label: 'Despesas',
          data: despValores,
          borderColor: '#EA580C',
          backgroundColor: 'transparent',
          borderWidth: 2.2,
          tension: 0.3,
          fill: false,
          pointRadius: 3,
          pointBackgroundColor: '#EA580C'
        });
        datasets.push({
          label: 'Saldo Líquido',
          data: lucroValores,
          borderColor: '#10B981',
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          tension: 0.3,
          fill: false,
          pointRadius: 4,
          pointBackgroundColor: '#10B981'
        });
      }

      this.chartInstancia = new Chart(ctx, {
        type: 'line',
        data: { labels: rotulos, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: true,
              position: 'top',
              align: 'end',
              labels: { boxWidth: 12, font: { size: 12, weight: 'bold' } }
            },
            tooltip: {
              backgroundColor: '#1E1B1B',
              titleColor: '#FEE2E2',
              bodyColor: '#FFFFFF',
              padding: 12,
              cornerRadius: 8,
              callbacks: {
                label: (item: any) => ` ${item.dataset.label}: ${dinheiro(item.raw as number)}`
              }
            }
          },
          scales: {
            x: { grid: { display: false } },
            y: {
              grid: { color: 'rgba(203, 213, 225, 0.25)' },
              ticks: {
                callback: (val: any) => {
                  const n = Number(val);
                  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
                }
              }
            }
          }
        }
      });
    }
  }

  rotuloMes(anoMes: string): string {
    const [a, m] = anoMes.split('-');
    const idx = Math.max(0, parseInt(m, 10) - 1);
    return `${MESES_NOMES[idx]} de ${a}`;
  }
}
