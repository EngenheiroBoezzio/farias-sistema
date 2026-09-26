/* Serviço de cálculo da etiqueta de troca de óleo e preferências de intervalo por cliente/veículo.
 *
 * Fórmula da oficina:
 *   Km da Próxima Troca (Etiqueta) = Km Atual + Margem (+5.000 km, +7.000 km, +10.000 km ou customizado).
 *
 * Guarda preferências por cliente e por veículo no localStorage do terminal,
 * com dedução inteligente a partir da viscosidade do óleo caso não haja preferência salva.
 */
import { Injectable } from '@angular/core';
import { num } from './formato';

const CHAVE_CLIENTES = 'farias.intervalos_clientes';
const CHAVE_VEICULOS = 'farias.intervalos_veiculos';
export const INTERVALO_PADRAO = 7000;
export const INTERVALOS_COMUNS = [5000, 7000, 10000];

@Injectable({ providedIn: 'root' })
export class EtiquetaService {

  /** Calcula a quilometragem da próxima troca para anotação na etiqueta. */
  calcularProximaTroca(kmAtual: number | null | undefined, intervaloKm: number): number | null {
    const k = num(kmAtual as any);
    if (!k || k <= 0) return null;
    const int = intervaloKm > 0 ? intervaloKm : INTERVALO_PADRAO;
    return Math.round(k + int);
  }

  /** Sugere intervalo baseado no óleo caso o cliente/carro ainda não tenha preferência salva:
   *  - Óleos 100% sintéticos (0W..., 5W...) -> 10.000 km
   *  - Semi-sintéticos (10W..., 15W...) -> 7.000 km
   *  - Minerais (20W...) -> 5.000 km
   *  - Padrão geral -> 7.000 km
   */
  deduzirPorOleo(oleo?: string | null): number {
    if (!oleo) return INTERVALO_PADRAO;
    const txt = oleo.toUpperCase();
    if (txt.includes('0W') || txt.includes('5W') || txt.includes('SINT')) {
      return 10000;
    }
    if (txt.includes('20W') || txt.includes('MINERAL')) {
      return 5000;
    }
    if (txt.includes('10W') || txt.includes('15W') || txt.includes('SEMI')) {
      return 7000;
    }
    return INTERVALO_PADRAO;
  }

  /** Obtém o intervalo preferido com cascata:
   *  1. Preferência do cliente
   *  2. Preferência da placa
   *  3. Deduzido pelo tipo de óleo
   *  4. Padrão geral da loja (7.000 km)
   */
  obterIntervalo(clienteId?: number | null, placa?: string | null, oleo?: string | null): number {
    if (clienteId) {
      const mapaClientes = this.lerMapa(CHAVE_CLIENTES);
      const salvo = mapaClientes[String(clienteId)];
      if (salvo && Number(salvo) > 0) return Number(salvo);
    }

    if (placa) {
      const limpa = placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const mapaVeiculos = this.lerMapa(CHAVE_VEICULOS);
      const salvo = mapaVeiculos[limpa];
      if (salvo && Number(salvo) > 0) return Number(salvo);
    }

    return this.deduzirPorOleo(oleo);
  }

  /** Salva a preferência de intervalo para o cliente e/ou veículo. */
  salvarIntervalo(intervalo: number, clienteId?: number | null, placa?: string | null): void {
    if (!intervalo || intervalo <= 0) return;

    if (clienteId) {
      const mapa = this.lerMapa(CHAVE_CLIENTES);
      mapa[String(clienteId)] = intervalo;
      this.gravarMapa(CHAVE_CLIENTES, mapa);
    }

    if (placa) {
      const limpa = placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const mapa = this.lerMapa(CHAVE_VEICULOS);
      mapa[limpa] = intervalo;
      this.gravarMapa(CHAVE_VEICULOS, mapa);
    }
  }

  private lerMapa(chave: string): Record<string, number> {
    try {
      const s = localStorage.getItem(chave);
      return s ? JSON.parse(s) : {};
    } catch {
      return {};
    }
  }

  private gravarMapa(chave: string, mapa: Record<string, number>): void {
    try {
      localStorage.setItem(chave, JSON.stringify(mapa));
    } catch (e) {
      console.warn('Não foi possível gravar preferências de etiqueta no localStorage:', e);
    }
  }
}
