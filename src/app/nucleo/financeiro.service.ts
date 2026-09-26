/* Gestão financeira real: custos, despesas fixas/variáveis e DRE ("O que realmente sobra").
 *
 * Permite cadastrar despesas da oficina (aluguel, folha, energia, insumos/óleos, taxas),
 * calcular o lucro líquido real e o ponto de equilíbrio (break-even).
 */
import { Injectable } from '@angular/core';

export type CategoriaDespesa = 'fixa' | 'pessoal' | 'insumos' | 'operacional' | 'impostos' | 'outros';
export type StatusDespesa = 'pago' | 'pendente';

export interface Despesa {
  id: string;
  descricao: string;
  valor: number;
  categoria: CategoriaDespesa;
  dataVencimento: string; // YYYY-MM-DD
  dataPagamento?: string | null;
  status: StatusDespesa;
  recorrente: boolean; // se repete todo mês
  obs?: string;
  criadaEm: string;
}

export interface ConsolidadoMes {
  mes: string; // YYYY-MM
  faturamentoOrdens: number;
  receitasExtras: number;
  faturamentoTotal: number;
  custoInsumos: number; // Peças e lubrificantes comprados
  despesasFixas: number; // Aluguel, luz, água, internet
  despesasPessoal: number; // Salários e encargos
  despesasOperacionais: number; // Taxas de cartão, manutenção
  despesasTotais: number;
  lucroLiquido: number; // O QUE REALMENTE SOBRA
  margemLiquida: number; // %
  pontoEquilibrio: number; // Break-even (custos fixos mínimos)
  contasPendentes: number;
  ordens: number;
  ticketMedio: number;
  positivo: boolean;
}

const CHAVE_DESPESAS = 'farias.financeiro_despesas';

/* O rótulo curto é o que aparece na pílula da tabela; a ajuda é o que aparece
   no seletor, onde há espaço para explicar. Antes os dois viviam na mesma
   string — "Insumos & Peças (Tambores de Óleo, Filtros)" numa pílula de
   tabela —, e as seis cores eram hexadecimais do Tailwind escritas à mão:
   azul, violeta, laranja, âmbar, rosa e slate, nenhuma delas da paleta.
   Agora saem das séries do :root, que variam em tom e não só em matiz. */
export const ROTULOS_CATEGORIAS: Record<CategoriaDespesa, { rotulo: string; ajuda: string; icone: string; cor: string }> = {
  fixa:        { rotulo: 'Contas fixas', ajuda: 'aluguel, luz, água',            icone: 'bi-building',        cor: 'var(--c1)' },
  pessoal:     { rotulo: 'Pessoal',      ajuda: 'salários e pró-labore',         icone: 'bi-people-fill',     cor: 'var(--c3)' },
  insumos:     { rotulo: 'Insumos',      ajuda: 'óleo, filtros e peças',         icone: 'bi-fuel-pump-fill',  cor: 'var(--c5)' },
  operacional: { rotulo: 'Operacional',  ajuda: 'cartão, manutenção, entregas',  icone: 'bi-credit-card-fill', cor: 'var(--c4)' },
  impostos:    { rotulo: 'Impostos',     ajuda: 'Simples e taxas',               icone: 'bi-receipt',         cor: 'var(--c2)' },
  outros:      { rotulo: 'Outros',       ajuda: 'o que não cabe acima',          icone: 'bi-three-dots',      cor: 'var(--c6)' }
};

@Injectable({ providedIn: 'root' })
export class FinanceiroService {

  /** Retorna todas as despesas cadastradas pela oficina */
  obterDespesas(): Despesa[] {
    try {
      const s = localStorage.getItem(CHAVE_DESPESAS);
      if (s) {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) {
          // Remove mocks automáticos antigos (desp_1 a desp_9) para não poluir os dados reais da oficina
          const idsMocks = new Set(['desp_1', 'desp_2', 'desp_3', 'desp_4', 'desp_5', 'desp_6', 'desp_7', 'desp_8', 'desp_9']);
          const reais = parsed.filter(d => !idsMocks.has(d.id));
          if (reais.length !== parsed.length) {
            this.salvarDespesas(reais);
          }
          return reais;
        }
      }
    } catch {}
    return [];
  }

  /** Retorna as despesas aplicáveis a um mês específico (incluindo recorrentes) */
  obterDespesasMes(anoMes: string): Despesa[] {
    const todas = this.obterDespesas();
    return todas.filter(d => {
      // Se for pontual daquele mês
      if (d.dataVencimento.startsWith(anoMes)) return true;
      // Se for recorrente e foi criada antes ou durante o mês consultado
      if (d.recorrente) {
        const mesCriacao = d.dataVencimento.slice(0, 7);
        return mesCriacao <= anoMes;
      }
      return false;
    });
  }

  /** Adiciona uma nova despesa */
  adicionarDespesa(d: Omit<Despesa, 'id' | 'criadaEm'>): Despesa {
    const nova: Despesa = {
      ...d,
      id: 'desp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      valor: Math.round(Number(d.valor) * 100) / 100,
      criadaEm: new Date().toISOString()
    };
    const lista = this.obterDespesas();
    lista.unshift(nova);
    this.salvarDespesas(lista);
    return nova;
  }

  /** Atualiza uma despesa existente */
  editarDespesa(id: string, atualizacao: Partial<Despesa>): void {
    const lista = this.obterDespesas().map(d => {
      if (d.id === id) {
        return {
          ...d,
          ...atualizacao,
          valor: atualizacao.valor !== undefined ? Math.round(Number(atualizacao.valor) * 100) / 100 : d.valor
        };
      }
      return d;
    });
    this.salvarDespesas(lista);
  }

  /** Exclui uma despesa pelo ID */
  excluirDespesa(id: string): void {
    const lista = this.obterDespesas().filter(d => d.id !== id);
    this.salvarDespesas(lista);
  }

  /**
   * Consolida os números reais de um mês combinando o faturamento do banco de dados
   * com todas as despesas reais lançadas.
   */
  consolidarMes(anoMes: string, faturamentoOrdens: number, numOrdens: number): ConsolidadoMes {
    const despesas = this.obterDespesasMes(anoMes);

    let custoInsumos = 0;
    let despesasFixas = 0;
    let despesasPessoal = 0;
    let despesasOperacionais = 0;
    let contasPendentes = 0;

    for (const d of despesas) {
      const v = Number(d.valor) || 0;
      if (d.categoria === 'insumos') {
        custoInsumos += v;
      } else if (d.categoria === 'fixa') {
        despesasFixas += v;
      } else if (d.categoria === 'pessoal') {
        despesasPessoal += v;
      } else {
        despesasOperacionais += v;
      }

      if (d.status === 'pendente') {
        contasPendentes += v;
      }
    }

    const faturamentoTotal = Math.round(Number(faturamentoOrdens) * 100) / 100;
    const despesasTotais = Math.round((custoInsumos + despesasFixas + despesasPessoal + despesasOperacionais) * 100) / 100;
    const lucroLiquido = Math.round((faturamentoTotal - despesasTotais) * 100) / 100;
    const margemLiquida = faturamentoTotal > 0 ? (lucroLiquido / faturamentoTotal) * 100 : 0;
    const pontoEquilibrio = Math.round((despesasFixas + despesasPessoal + despesasOperacionais) * 100) / 100;
    const ticketMedio = numOrdens > 0 ? faturamentoTotal / numOrdens : 0;

    return {
      mes: anoMes,
      faturamentoOrdens: faturamentoTotal,
      receitasExtras: 0,
      faturamentoTotal,
      custoInsumos: Math.round(custoInsumos * 100) / 100,
      despesasFixas: Math.round(despesasFixas * 100) / 100,
      despesasPessoal: Math.round(despesasPessoal * 100) / 100,
      despesasOperacionais: Math.round(despesasOperacionais * 100) / 100,
      despesasTotais,
      lucroLiquido,
      margemLiquida,
      pontoEquilibrio,
      contasPendentes: Math.round(contasPendentes * 100) / 100,
      ordens: numOrdens,
      ticketMedio,
      positivo: lucroLiquido >= 0
    };
  }

  private salvarDespesas(lista: Despesa[]): void {
    try {
      localStorage.setItem(CHAVE_DESPESAS, JSON.stringify(lista));
    } catch (e) {
      console.warn('Erro ao salvar despesas no localStorage:', e);
    }
  }
}
