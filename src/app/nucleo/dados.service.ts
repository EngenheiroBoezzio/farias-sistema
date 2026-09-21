/* Um método por rota da API. Nada de URL solta dentro de componente. */
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import * as T from './tipos';

@Injectable({ providedIn: 'root' })
export class DadosService {
  private api = inject(ApiService);

  /* ---------- painel ---------- */
  painel() { return this.api.get<T.Painel>('/api/painel'); }
  vencidos(q?: { pagina?: number; limite?: number }) {
    return this.api.get<T.RespostaVencidos>('/api/painel/vencidos', q);
  }
  aniversariantes() {
    return this.api.get<T.RespostaAniversarios>('/api/painel/aniversariantes');
  }

  /* ---------- clientes ---------- */
  clientes(q?: { busca?: string; pagina?: number; limite?: number; ordenar?: string; dir?: string }) {
    return this.api.get<T.RespostaClientes>('/api/clientes', q);
  }
  cliente(id: number) {
    return this.api.get<{ cliente: T.Cliente }>(`/api/clientes/${id}`);
  }
  criarCliente(corpo: {
    nome: string; telefone?: string; nascimento?: string;
    aceita_aviso?: number; obs?: string;
    veiculo?: Partial<T.Veiculo> & { placa: string };
  }) {
    return this.api.post<{ cliente: T.Cliente; veiculo: { id: number; placa: string } | null; aviso: string | null }>(
      '/api/clientes', corpo);
  }
  editarCliente(id: number, corpo: Partial<T.Cliente>) {
    return this.api.patch<{ cliente: T.Cliente }>(`/api/clientes/${id}`, corpo);
  }
  /** O servidor devolve 409 na primeira chamada, dizendo o que vai junto. */
  excluirCliente(id: number, confirmar = false) {
    return this.api.delete<{ ok: boolean; removido: any }>(
      `/api/clientes/${id}`, confirmar ? { confirmar: 1 } : undefined);
  }

  /* ---------- veículos ---------- */
  veiculos(q?: { busca?: string; situacao?: string; pagina?: number; limite?: number;
                 ordenar?: string; dir?: string }) {
    return this.api.get<T.RespostaVeiculos>('/api/veiculos', q);
  }
  veiculo(id: number) {
    return this.api.get<{ veiculo: T.Veiculo; historico: T.Servico[] }>(`/api/veiculos/${id}`);
  }
  veiculoPorPlaca(placa: string) {
    return this.api.get<{ veiculo: T.Veiculo; historico: T.Servico[] }>(
      `/api/veiculos/placa/${encodeURIComponent(placa)}`);
  }
  criarVeiculo(corpo: Partial<T.Veiculo> & { cliente_id: number; placa: string }) {
    return this.api.post<{ veiculo: T.Veiculo }>('/api/veiculos', corpo);
  }
  editarVeiculo(id: number, corpo: Partial<T.Veiculo>) {
    return this.api.patch<{ veiculo: T.Veiculo }>(`/api/veiculos/${id}`, corpo);
  }

  /* ---------- a subseção de filtros ---------- */
  gravarFiltros(id: number, f: {
    filtro_oleo?: string; filtro_ar?: string;
    filtro_cabine?: string; filtro_combustivel?: string;
  }) {
    return this.api.put<{ veiculo: T.Veiculo }>(`/api/veiculos/${id}/filtros`, f);
  }
  /** Grava a sugestão do catálogo, registrando que foi aceita e por quem. */
  aceitarSugestao(id: number, mesmoAssim = false) {
    return this.api.post<{ veiculo: T.Veiculo; confianca: number; origem: string }>(
      `/api/veiculos/${id}/filtros/aceitar`, {}, mesmoAssim ? { mesmo_assim: 1 } : undefined);
  }
  filaFiltros(q?: { pagina?: number; limite?: number }) {
    return this.api.get<T.RespostaPendencias>('/api/veiculos/pendencias/sem-filtro', q);
  }

  /* ---------- serviços ---------- */
  servicos(q?: { de?: string; ate?: string; pagina?: number; limite?: number }) {
    return this.api.get<T.RespostaServicos>('/api/servicos', q);
  }
  servico(id: number) {
    return this.api.get<{ servico: T.Servico; itens: T.ItemServico[] }>(`/api/servicos/${id}`);
  }
  registrarServico(corpo: {
    placa: string; data?: string; km?: number; oleo?: string; litros?: number;
    total?: number; valor_filtro_oleo?: number; valor_filtro_ar?: number;
    cod_filtro_oleo?: string; cod_filtro_ar?: string;
    cod_filtro_cabine?: string; cod_filtro_combustivel?: string;
  }) {
    return this.api.post<T.RespostaNovoServico>('/api/servicos', corpo);
  }
  editarServico(id: number, corpo: Partial<T.Servico>) {
    return this.api.patch<{ servico: T.Servico }>(`/api/servicos/${id}`, corpo);
  }
  excluirServico(id: number, confirmar = false) {
    return this.api.delete<{ ok: boolean }>(
      `/api/servicos/${id}`, confirmar ? { confirmar: 1 } : undefined);
  }
  adicionarItem(servicoId: number, descricao: string, valor: number) {
    return this.api.post<{ item: T.ItemServico }>(
      `/api/servicos/${servicoId}/itens`, { descricao, valor });
  }

  /* ---------- consulta de placa ---------- */
  consultarPlaca(placa: string) {
    return this.api.get<T.ConsultaPlaca | T.PrecisaModelo>(
      `/api/placa/${encodeURIComponent(placa)}`);
  }

  /* O caminho sem consulta paga: o balcão digita o modelo e a API responde
     óleo e filtros pelo catálogo mais o histórico da própria oficina. */
  buscarModelos(busca: string) {
    return this.api.get<{ busca: string; modelos: T.ModeloSugerido[]; dica?: string }>(
      '/api/placa/modelos', { busca });
  }
  consultarPorModelo(p: { modelo: string; ano?: number | null; cilindrada?: string | null;
                          marca?: string | null; combustivel?: string | null }) {
    return this.api.get<T.ConsultaPlaca>('/api/placa/por-modelo', p as any);
  }

  /* ---------- avisos ---------- */
  fila(q?: { tipo?: T.TipoAviso; pagina?: number; limite?: number }) {
    return this.api.get<T.RespostaFila>('/api/avisos/fila', q);
  }
  registrarAviso(veiculo_id: number, tipo: T.TipoAviso = 'vencido') {
    return this.api.post<{ aviso: { id: number } }>('/api/avisos', { veiculo_id, tipo });
  }
  marcarDesfecho(id: number, desfecho: T.Desfecho) {
    return this.api.patch<{ ok: boolean }>(`/api/avisos/${id}`, { desfecho });
  }
  resultadoAvisos(dias = 90) {
    return this.api.get<T.ResultadoAvisos>('/api/avisos/resultado', { dias });
  }
  historicoAvisos(veiculo_id: number) {
    return this.api.get<{ avisos: any[] }>('/api/avisos', { veiculo_id });
  }

  /* ---------- notificações ---------- */
  notificacoes() {
    return this.api.get<T.RespostaNotificacoes>('/api/notificacoes');
  }
  marcarLida(id: number) { return this.api.post(`/api/notificacoes/${id}/lida`); }
  marcarTodasLidas() { return this.api.post('/api/notificacoes/lidas'); }
  backups() { return this.api.get<any>('/api/notificacoes/backups'); }
  recarregarCatalogo() {
    return this.api.post<{ ok: boolean; linhas: number; ms: number }>(
      '/api/notificacoes/recarregar-catalogo');
  }
}
