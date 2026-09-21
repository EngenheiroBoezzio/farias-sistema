/* Configuração lida em TEMPO DE EXECUÇÃO.
 *
 * A URL da API não pode ficar compilada dentro do bundle: o app é instalado na
 * máquina do cliente, e o endereço interno pode mudar. Se estivesse em
 * environment.ts, cada mudança de endereço exigiria gerar um instalador novo.
 *
 * Ordem de precedência, da mais forte para a mais fraca:
 *   1. o que o usuário salvou na tela de configuração (localStorage)
 *   2. o que o Electron passou (arquivo de config ao lado do executável)
 *   3. public/config.json, que vai junto no pacote
 *   4. localhost:3001, para o desenvolvimento
 *
 * O valor especial "mesma-origem" faz o app falar com quem serviu a página.
 * É o que o instalador grava quando a própria API entrega o front: aí não há
 * endereço para errar, não há CORS, e mudar a máquina de lugar não quebra nada.
 */
import { Injectable, signal } from '@angular/core';

export type TamanhoFonte = 'normal' | 'media' | 'grande';
export type TemaApp = 'claro' | 'escuro' | 'adaptativo';
export type FrequenciaAtualizacao = 'semanal' | 'tres_dias' | 'diaria' | 'manual';
export type TipoGrafico = 'linha' | 'barras' | 'pizza' | 'area';

export interface Config {
  apiUrl: string;
  nomeLoja: string;
  canalWhatsapp: string;
  tamanhoFonte?: TamanhoFonte;
  tema?: TemaApp;
  frequenciaAtualizacao?: FrequenciaAtualizacao;
  tipoGrafico?: TipoGrafico;
  ultimaVerificacaoAtualizacao?: string;
  /* Gravado por quem COMPILA, não por quem usa. Com true, o endereço da API
     vem do pacote e nada no computador da oficina muda isso: nem a tela de
     configuração, nem localStorage, nem um config.json plantado na pasta de
     dados do usuário. É o modo de quem hospeda a API para o cliente. */
  travado?: boolean;
}

const PADRAO: Config = {
  apiUrl: 'http://localhost:3001',
  nomeLoja: 'Farias Troca de Óleo',
  canalWhatsapp: '',
  tamanhoFonte: 'normal',
  tema: 'adaptativo',
  frequenciaAtualizacao: 'semanal',
  tipoGrafico: 'linha',
  travado: false
};

const CHAVE = 'farias.config';
/* Sentinela: a API é quem serviu esta página. */
export const MESMA_ORIGEM = 'mesma-origem';

declare global {
  interface Window {
    farias?: {
      lerConfig?(): Promise<Partial<Config> | null>;
      salvarConfig?(c: Partial<Config>): Promise<boolean>;
      versao?(): Promise<string>;
      origem?(): Promise<string>;
      verificarAtualizacao?(): Promise<{ disponivel: boolean; versao?: string; motivo?: string }>;
    };
  }
}

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private _config = signal<Config>(PADRAO);
  readonly config = this._config.asReadonly();

  /** Vazio quer dizer "mesma origem": as chamadas saem como /api/... */
  get apiUrl(): string {
    const u = this._config().apiUrl;
    if (u === MESMA_ORIGEM) return '';
    return u.replace(/\/+$/, '');
  }
  get nomeLoja(): string { return this._config().nomeLoja; }
  get canalWhatsapp(): string { return this._config().canalWhatsapp; }
  get tamanhoFonte(): TamanhoFonte { return this._config().tamanhoFonte || 'normal'; }
  get tema(): TemaApp { return this._config().tema || 'adaptativo'; }
  get frequenciaAtualizacao(): FrequenciaAtualizacao { return this._config().frequenciaAtualizacao || 'semanal'; }
  get tipoGrafico(): TipoGrafico {
    if (typeof localStorage !== 'undefined') {
      const d = localStorage.getItem('farias.tipoGrafico') as TipoGrafico;
      if (d && (d === 'linha' || d === 'barras' || d === 'pizza' || d === 'area')) return d;
    }
    return this._config().tipoGrafico || 'linha';
  }

  /** Chamado pelo APP_INITIALIZER: o app não sobe antes disto terminar. */
  async carregar(): Promise<void> {
    let c: Config = { ...PADRAO };

    // 3. o arquivo que vai junto no pacote, gravado antes de compilar
    try {
      const r = await fetch('config.json', { cache: 'no-store' });
      if (r.ok) c = { ...c, ...(await r.json()) };
    } catch {
      // sem config.json o app ainda sobe, com o padrão
    }

    /* Ponto de corte. Travado, o que veio do pacote (servidor, loja) é a palavra final.
       No entanto, as preferências do usuário (tipo de gráfico, tema, tamanho da fonte)
       devem ser sempre preservadas e lidas do localStorage! */
    if (c.travado) {
      try {
        const salvo = localStorage.getItem(CHAVE);
        if (salvo) {
          const s = JSON.parse(salvo);
          if (s.tipoGrafico) c.tipoGrafico = s.tipoGrafico;
          if (s.tema) c.tema = s.tema;
          if (s.tamanhoFonte) c.tamanhoFonte = s.tamanhoFonte;
          if (s.frequenciaAtualizacao) c.frequenciaAtualizacao = s.frequenciaAtualizacao;
        }
        const tgDireto = localStorage.getItem('farias.tipoGrafico') as TipoGrafico;
        if (tgDireto) c.tipoGrafico = tgDireto;
      } catch { /* segue */ }

      this._config.set(this.limpar(c));
      this.aplicarAparencia();
      return;
    }

    // 2. o que o Electron leu do disco, na pasta de dados do usuário
    try {
      if (window.farias?.lerConfig) {
        const doElectron = await window.farias.lerConfig();
        if (doElectron) c = { ...c, ...doElectron };
      }
    } catch { /* fora do Electron, ignora */ }

    // 1. o que o usuário digitou na tela de configuração
    try {
      const salvo = localStorage.getItem(CHAVE);
      if (salvo) c = { ...c, ...JSON.parse(salvo) };
    } catch { /* localStorage bloqueado: segue com o resto */ }

    this._config.set(this.limpar(c));
    this.aplicarAparencia();
  }

  /** Aplica o tema e tamanho de fonte diretamente nas raízes HTML/BODY */
  aplicarAparencia(): void {
    if (typeof document === 'undefined') return;
    const doc = document.documentElement;
    const tf = this.tamanhoFonte;
    doc.setAttribute('data-font-size', tf);

    const t = this.tema;
    let temaEfetivo: 'light' | 'dark' = 'light';
    if (t === 'escuro') {
      temaEfetivo = 'dark';
    } else if (t === 'claro') {
      temaEfetivo = 'light';
    } else {
      // Adaptativo: baseado no sistema operacional ou horário (noite = dark)
      const prefereEscuro = typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-color-scheme: dark)').matches;
      const hora = new Date().getHours();
      const ehNoite = hora < 6 || hora >= 18;
      temaEfetivo = (prefereEscuro || ehNoite) ? 'dark' : 'light';
    }
    doc.setAttribute('data-theme', temaEfetivo);
  }

  /** Determina se deve rodar a verificação de atualização periódica */
  deveVerificarAtualizacao(): boolean {
    const freq = this.frequenciaAtualizacao;
    if (freq === 'manual') return false;
    const ultima = this._config().ultimaVerificacaoAtualizacao;
    if (!ultima) return true;
    const diffHoras = (Date.now() - new Date(ultima).getTime()) / (1000 * 60 * 60);
    if (freq === 'diaria') return diffHoras >= 24;
    if (freq === 'tres_dias') return diffHoras >= 72;
    if (freq === 'semanal') return diffHoras >= 168;
    return false;
  }

  /** Registra que a checagem automática foi realizada */
  registrarChecagemAtualizacao(): void {
    this.salvar({ ultimaVerificacaoAtualizacao: new Date().toISOString() });
  }

  /** A tela de configuração pergunta isto antes de mostrar os campos. */
  get travado(): boolean { return this._config().travado === true; }

  /** Salva o que o usuário digitou. Volta true se conseguiu guardar. */
  async salvar(parcial: Partial<Config>): Promise<boolean> {
    const novo = this.limpar({ ...this._config(), ...parcial });
    this._config.set(novo);
    this.aplicarAparencia();
    let ok = false;
    try {
      localStorage.setItem(CHAVE, JSON.stringify(novo));
      if (novo.tipoGrafico) {
        localStorage.setItem('farias.tipoGrafico', novo.tipoGrafico);
      }
      ok = true;
    } catch { /* modo privado, disco cheio */ }
    try {
      if (window.farias?.salvarConfig) ok = await window.farias.salvarConfig(novo) || ok;
    } catch { /* fora do Electron */ }
    return ok;
  }

  private limpar(c: Config): Config {
    const nomeLoja = String(c.nomeLoja || PADRAO.nomeLoja).trim();
    const canalWhatsapp = String(c.canalWhatsapp || '').trim();
    const travado = c.travado === true;
    const tamanhoFonte: TamanhoFonte =
      c.tamanhoFonte === 'media' || c.tamanhoFonte === 'grande' ? c.tamanhoFonte : 'normal';
    const tema: TemaApp =
      c.tema === 'claro' || c.tema === 'escuro' ? c.tema : 'adaptativo';
    const frequenciaAtualizacao: FrequenciaAtualizacao =
      c.frequenciaAtualizacao === 'diaria' || c.frequenciaAtualizacao === 'tres_dias' || c.frequenciaAtualizacao === 'manual'
        ? c.frequenciaAtualizacao : 'semanal';
    const tipoGrafico: TipoGrafico =
      c.tipoGrafico === 'barras' || c.tipoGrafico === 'pizza' || c.tipoGrafico === 'area' ? c.tipoGrafico : 'linha';
    const ultimaVerificacaoAtualizacao = c.ultimaVerificacaoAtualizacao;

    const bruto = String(c.apiUrl ?? '').trim();
    /* Nada preenchido cai no padrão de desenvolvimento, como sempre foi. */
    if (!bruto) return {
      apiUrl: PADRAO.apiUrl, nomeLoja, canalWhatsapp, travado,
      tamanhoFonte, tema, frequenciaAtualizacao, tipoGrafico, ultimaVerificacaoAtualizacao
    };

    /* As formas que uma pessoa escreveria para dizer "é quem serviu a página".
       Aceitar as três evita que o instalador e a tela de configuração
       discordem por causa de um hífen. */
    if (/^(mesma[- ]origem|same[- ]origin|\.|\/)$/i.test(bruto))
      return {
        apiUrl: MESMA_ORIGEM, nomeLoja, canalWhatsapp, travado,
        tamanhoFonte, tema, frequenciaAtualizacao, tipoGrafico, ultimaVerificacaoAtualizacao
      };

    const url = /^https?:\/\//i.test(bruto) ? bruto : 'http://' + bruto;
    return {
      apiUrl: url.replace(/\/+$/, '') || PADRAO.apiUrl, nomeLoja, canalWhatsapp, travado,
      tamanhoFonte, tema, frequenciaAtualizacao, tipoGrafico, ultimaVerificacaoAtualizacao
    };
  }

  /** Testa se a API responde no endereço informado, sem precisar logar. */
  async testar(url?: string): Promise<{ ok: boolean; ms?: number; erro?: string }> {
    const bruto = url ?? this.apiUrl;
    const alvo = (bruto === MESMA_ORIGEM ? '' : bruto).replace(/\/+$/, '');
    const t0 = performance.now();
    try {
      const ctrl = new AbortController();
      const prazo = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(alvo + '/health', { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(prazo);
      if (!r.ok) return { ok: false, erro: `O servidor respondeu ${r.status}.` };
      const corpo = await r.json();
      if (!corpo?.ok) return { ok: false, erro: 'O servidor respondeu, mas o banco não.' };
      return { ok: true, ms: Math.round(performance.now() - t0) };
    } catch (e: any) {
      return {
        ok: false,
        erro: e?.name === 'AbortError'
          ? 'O servidor não respondeu em 5 segundos.'
          : 'Não consegui falar com o servidor neste endereço.'
      };
    }
  }
}
