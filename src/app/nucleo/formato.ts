/* Formatação e conversão.
 *
 * `num()` existe por um motivo concreto: o driver do MariaDB devolve DECIMAL
 * como string. `"365.00" + "120.00"` em JavaScript dá "365.00120.00", e o erro
 * passa despercebido porque a tela mostra um número plausível. Toda conta
 * passa por aqui. */
import { Dec } from './tipos';

export function num(v: Dec | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export function dinheiro(v: Dec | undefined): string {
  return num(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function inteiro(v: number | null | undefined): string {
  return (v ?? 0).toLocaleString('pt-BR');
}

export function litros(v: Dec | undefined): string {
  const n = num(v);
  if (!n) return '—';
  // 4 e não 4,00; mas 4,25 mantém as casas
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' L';
}

export function km(v: number | null | undefined): string {
  return v == null ? '—' : v.toLocaleString('pt-BR') + ' km';
}

/** "2026-09-16" ou ISO -> "16/09/2026". Sem fuso: data pura não tem hora. */
export function data(v: string | null | undefined): string {
  if (!v) return '—';
  const so = String(v).slice(0, 10);
  const m = so.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : so;
}

export function dataHora(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(+d) ? '—'
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric',
                                  hour: '2-digit', minute: '2-digit' });
}

/** "2025-08" -> "ago/25" */
export function mesCurto(v: string): string {
  const [a, m] = String(v).split('-');
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
                 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${nomes[+m - 1] || m}/${a.slice(2)}`;
}

/** 5555999887766 -> (55) 99988-7766 */
export function telefone(v: string | null | undefined): string {
  const d = String(v || '').replace(/\D/g, '');
  const sem = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  if (sem.length === 11) return `(${sem.slice(0, 2)}) ${sem.slice(2, 7)}-${sem.slice(7)}`;
  if (sem.length === 10) return `(${sem.slice(0, 2)}) ${sem.slice(2, 6)}-${sem.slice(6)}`;
  return v || '—';
}

export function placa(v: string | null | undefined): string {
  const p = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return p.length === 7 ? `${p.slice(0, 3)}-${p.slice(3)}` : (v || '—');
}

const ROTULO_SITUACAO: Record<string, string> = {
  em_dia: 'Em dia', vencido: 'Vencido', parado: 'Parado', frio: 'Frio'
};
export const rotuloSituacao = (s: string) => ROTULO_SITUACAO[s] || s;

/** "há 3 dias", "há 2 meses" — para a coluna de atraso */
export function haQuanto(dias: number | null | undefined): string {
  if (dias == null) return '—';
  if (dias < 0) return 'hoje';
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  if (meses < 24) return `há ${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  return `há ${Math.floor(dias / 365)} anos`;
}
