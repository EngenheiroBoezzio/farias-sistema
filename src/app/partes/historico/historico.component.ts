/* HISTÓRICO DO CARRO — linha do tempo.

   Substitui as duas tabelas que existiam (ficha do carro e consulta de placa).
   A da ficha tinha sete colunas e só mostrava o filtro de ar; a da consulta
   ficava espremida em meia tela e cortava o Total e o Editar para fora.

   Cada passagem do carro é uma linha:
     data grande ("11 ago") + há quanto tempo
     o km, e quanto rodou desde a troca anterior ("+6.600 km em 8 meses")
     o que foi feito, em etiquetas: óleo, filtro de óleo, de ar, de cabine,
     de combustível — com o código da peça
     o valor e o botão de editar

   Separado por ano, porque é assim que o balcão conversa ("ano passado ele
   veio duas vezes"). Usa container query: na meia coluna da consulta a linha
   se reorganiza sozinha em vez de cortar. */
import { Component, computed, input, output } from '@angular/core';
import { Servico } from '../../nucleo/tipos';
import { dinheiro, km, litros, trocouFiltroAr, num } from '../../nucleo/formato';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export interface ItemFeito { rotulo: string; codigo?: string | null; valor?: number | null; destaque?: boolean; }

export interface LinhaHistorico {
  s: Servico;
  dia: string;           // "11"
  mes: string;           // "ago"
  ano: number;
  novoAno: boolean;      // primeira linha daquele ano → mostra o separador
  haQuanto: string;      // "há 2 meses"
  rodou: number | null;  // km desde a troca anterior (só se as duas pontas têm km)
  meses: number | null;
  kmEstranho: boolean;   // km MENOR que o da troca anterior: provável erro de digitação
  itens: ItemFeito[];
  semFiltroAr: boolean;
}

@Component({
  selector: 'app-historico',
  standalone: true,
  templateUrl: './historico.component.html'
})
export class HistoricoComponent {
  historico = input.required<Servico[]>();
  /** quantos a API manda no máximo (para avisar que tem mais antigo) */
  limite = input<number>(20);
  editar = output<Servico>();

  km = km; dinheiro = dinheiro;

  private hoje = new Date();

  linhas = computed<LinhaHistorico[]>(() => {
    const lista = this.historico();
    let anoAnterior: number | null = null;
    return lista.map((s, i) => {
      const d = this.parse(s.data);
      const ano = d ? d.getFullYear() : 0;
      const anterior = lista[i + 1];
      const temAsDuas = s.km != null && anterior?.km != null;
      const linha: LinhaHistorico = {
        s,
        dia: d ? String(d.getDate()).padStart(2, '0') : '—',
        mes: d ? MESES[d.getMonth()] : '',
        ano,
        novoAno: ano !== anoAnterior,
        haQuanto: this.haQuantoTexto(d),
        rodou: temAsDuas && s.km! > anterior.km! ? s.km! - anterior.km! : null,
        meses: this.mesesEntre(anterior?.data, s.data),
        kmEstranho: temAsDuas && s.km! < anterior.km!,
        itens: this.itens(s),
        semFiltroAr: !trocouFiltroAr(s)
      };
      anoAnterior = ano;
      return linha;
    });
  });

  /* Resumo do topo: o que o balcão quer saber de relance. */
  resumo = computed(() => {
    const ls = this.linhas();
    if (!ls.length) return null;
    const intervalos = ls.map(l => l.rodou).filter((v): v is number => v != null);
    const meses = ls.map(l => l.meses).filter((v): v is number => v != null && v > 0);
    const totais = ls.map(l => num(l.s.total)).filter(v => v > 0);
    const primeira = ls[ls.length - 1];
    return {
      trocas: ls.length,
      desde: primeira.mes && primeira.ano ? `${primeira.mes}/${primeira.ano}` : null,
      kmMedio: intervalos.length ? Math.round(intervalos.reduce((a, b) => a + b, 0) / intervalos.length / 100) * 100 : null,
      amostraKm: intervalos.length,
      mesesMedio: meses.length ? Math.round(meses.reduce((a, b) => a + b, 0) / meses.length) : null,
      ticket: totais.length ? totais.reduce((a, b) => a + b, 0) / totais.length : null
    };
  });

  private itens(s: Servico): ItemFeito[] {
    const it: ItemFeito[] = [];
    if (s.oleo || num(s.litros) > 0) {
      const l = num(s.litros) > 0 ? ` · ${litros(s.litros)}` : '';
      it.push({ rotulo: `Óleo ${s.oleo || ''}${l}`.trim(), valor: this.valor(s.valor_oleo) });
    }
    const filtros: [string, Servico[keyof Servico], string | null | undefined, boolean][] = [
      ['Filtro de óleo', s.valor_filtro_oleo, s.cod_filtro_oleo, false],
      ['Filtro de ar', s.valor_filtro_ar, s.cod_filtro_ar, true],
      ['Filtro de cabine', s.valor_filtro_cabine, s.cod_filtro_cabine, false],
      ['Filtro de combustível', s.valor_filtro_combustivel, s.cod_filtro_combustivel, false]
    ];
    for (const [rotulo, valor, codigo, destaque] of filtros) {
      /* Conta como trocado se cobrou algo OU se o código da peça foi anotado
         na ordem (ordens antigas da planilha têm o código e não o valor). */
      const v = this.valor(valor as any);
      if (v != null || codigo) it.push({ rotulo, codigo: codigo || null, valor: v, destaque });
    }
    return it;
  }

  private valor(v: any): number | null { const n = num(v); return n > 0 ? n : null; }

  private parse(v: string | null | undefined): Date | null {
    if (!v) return null;
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }

  private haQuantoTexto(d: Date | null): string {
    if (!d) return '';
    const dias = Math.floor((this.hoje.getTime() - d.getTime()) / 86400000);
    if (dias <= 0) return 'hoje';
    if (dias === 1) return 'ontem';
    if (dias < 30) return `há ${dias} dias`;
    const meses = Math.round(dias / 30.4);
    if (meses < 12) return `há ${meses} ${meses === 1 ? 'mês' : 'meses'}`;
    /* Acima de um ano, o mês a mais só ocupa espaço: "há 1 ano e meio"
       basta para o balcão. */
    const anos = Math.floor(meses / 12), resto = meses % 12;
    const meio = resto >= 5 && resto <= 8;
    const total = resto > 8 ? anos + 1 : anos;
    if (meio) return `há ${anos} ${anos === 1 ? 'ano' : 'anos'} e meio`;
    return `há ${total} ${total === 1 ? 'ano' : 'anos'}`;
  }

  private mesesEntre(de?: string | null, ate?: string | null): number | null {
    const a = this.parse(de), b = this.parse(ate);
    if (!a || !b || b <= a) return null;
    return Math.max(1, Math.round((b.getTime() - a.getTime()) / (86400000 * 30.4)));
  }
}
