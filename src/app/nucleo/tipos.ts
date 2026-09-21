/* Os formatos que a API devolve de verdade — conferidos chamando cada rota,
   não escritos de memória.
 *
 * ATENÇÃO aos DECIMAL: o driver do MariaDB devolve `total`, `litros`, `ticket`
 * e `valor` como STRING ("365.00"), não número. Somar isso direto concatena.
 * Use `num()` de `formato.ts` antes de qualquer conta. */

export type Situacao = 'em_dia' | 'vencido' | 'parado' | 'frio';
export type TipoFiltro = 'oleo' | 'ar' | 'combustivel' | 'cabine';
/** DECIMAL do banco chega como string */
export type Dec = string | number | null;

export interface Paginado {
  total: number;
  pagina: number;
  limite: number;
}

/* ---------- autenticação ---------- */
export interface Usuario {
  id: number;
  username: string;
  nome: string;
  papel: 'admin' | 'atendente';
}
export interface RespostaLogin { usuario: Usuario; token: string; }

/* ---------- painel ---------- */
export interface Painel {
  resumo: {
    clientes: number; veiculos: number; servicos: number;
    em_dia: number; vencido: number; parado: number; frio: number;
    com_telefone: number; com_nascimento: number;
    ticket: Dec;
  };
  serie: { mes: string; n: number; valor: Dec }[];
  oleos: { nome: string; n: number }[];
  ultimas: {
    data: string; total: Dec; oleo: string | null;
    placa: string; modelo: string | null; cliente: string;
  }[];
  _cache?: boolean;
}

export interface Vencido {
  id: number; placa: string; modelo: string | null;
  ultimo_oleo: string | null; ultimo_km: number | null;
  ultima_troca: string | null; dias: number;
  cliente: string; telefone: string | null;
  tel_inferido: 0 | 1; aceita_aviso: 0 | 1;
  ultimo_aviso: string | null;
}
export interface RespostaVencidos extends Paginado { vencidos: Vencido[]; }

export interface Aniversariante {
  id: number; nome: string; telefone: string | null; nascimento: string;
}
export interface RespostaAniversarios { total: number; aniversariantes: Aniversariante[]; }

/* ---------- clientes ---------- */
export interface Cliente {
  id: number;
  nome: string;
  telefone: string | null;
  tel_inferido: 0 | 1;
  nascimento: string | null;
  aceita_aviso: 0 | 1;
  obs: string | null;
  /** na LISTA vem a quantidade; na FICHA vem o array */
  veiculos?: number | Veiculo[];
}
export interface RespostaClientes extends Paginado { clientes: Cliente[]; }

/* ---------- veículos ---------- */
export interface Veiculo {
  id: number;
  placa: string;
  marca: string | null;
  modelo: string | null;
  cilindrada: string | null;
  ano: number | null;
  ultima_troca: string | null;
  ultimo_km: number | null;
  ultimo_oleo: string | null;
  visitas: number;
  situacao: Situacao;
  dias: number | null;
  obs?: string | null;
  filtro_oleo: string | null;
  filtro_ar: string | null;
  filtro_cabine: string | null;
  filtro_combustivel: string | null;
  filtros_por: string | null;
  filtros_em: string | null;
  cliente_id?: number;
  cliente?: string;
  telefone?: string | null;
  tel_inferido?: 0 | 1;
}
export interface RespostaVeiculos extends Paginado { veiculos: Veiculo[]; }

/* ---------- filtros ---------- */
export interface ItemFiltro {
  tipo: TipoFiltro;
  rotulo: string;
  codigo: string;
  alternativo: string | null;
  nota: string | null;
}

export type StatusFiltro =
  | 'cadastrado' | 'sugerido' | 'ambiguo' | 'precisa_confirmar'
  | 'sem_catalogo' | 'sem_modelo';

export interface Filtros {
  status: StatusFiltro;
  itens: ItemFiltro[];
  confianca?: number;
  origem?: string;
  porque?: string;
  pagina_pdf?: number;
  linha_pdf?: string;
  alternativas?: string[] | null;
  acao?: string;
  /** quando a loja já confirmou */
  confirmado_por?: string;
  confirmado_em?: string;
  /** o catálogo completando o que a loja não preencheu */
  sugeridos?: ItemFiltro[];
  origem_sugestao?: string;
  confianca_sugestao?: number;
  /** o que a própria oficina já pôs em carros iguais */
  na_casa?: NaCasaFiltros | null;
  confere_com_a_casa?: boolean;
  divergencia?: string;
}

/* ---------- o histórico da própria oficina ----------
   Sem consulta de placa paga, esta é a fonte que mais acerta: o que a Farias
   já pôs em carros do mesmo modelo e da mesma época. */
export interface NaCasaOleo {
  itens: { viscosidade: string | null; rotulo: string; vezes: number; parte: number;
           ultima: string | null; marca_usual: string | null;
           marcas: { marca: string; vezes: number }[] }[];
  viscosidade: string | null;
  marca_usual: string | null;
  parte: number;
  confianca: number;
  total: number;
  carros: number;
  criterio: 'exato' | 'aproximado' | null;
  janela: number | null;
  ano: number | null;
}

export interface NaCasaFiltros {
  itens: { tipo: string; rotulo: string; codigo: string; vezes: number;
           parte: number; confianca: number;
           outros: { codigo: string; vezes: number }[] }[];
  carros: number;
  criterio: 'exato' | 'aproximado' | null;
  janela: number | null;
  ano: number | null;
}

/** A linha única que a tela mostra grande. */
export interface RecomendacaoOleo {
  texto: string;
  marca_usual?: string | null;
  fonte: 'este carro' | 'histórico da oficina' | 'catálogo';
  confianca: number | null;
  porque: string | null;
  forca: 'alta' | 'media' | 'baixa';
}

/** Um modelo oferecido no campo de digitar. */
export interface ModeloSugerido {
  modelo: string;
  marca: string | null;
  carros: number;
  de: 'oficina' | 'catalogo' | 'oficina+catalogo';
}

export interface PendenteFiltro {
  id: number;
  placa: string;
  marca: string | null;
  modelo: string | null;
  cilindrada: string | null;
  ano: number | null;
  visitas: number;
  situacao: Situacao;
  cliente: string;
  sugestao: Filtros;
}
export interface RespostaPendencias extends Paginado {
  veiculos: PendenteFiltro[];
  nota: string;
}

/* ---------- serviços ---------- */
export interface Servico {
  id: number;
  data: string;
  km: number | null;
  oleo: string | null;
  litros: Dec;
  total: Dec;
  placa?: string;
  modelo?: string | null;
  cliente?: string;
  veiculo_id?: number;
  cliente_id?: number;
  valor_filtro_oleo?: Dec;
  valor_filtro_ar?: Dec;
  cod_filtro_oleo?: string | null;
  cod_filtro_ar?: string | null;
  cod_filtro_cabine?: string | null;
  cod_filtro_combustivel?: string | null;
}
export interface RespostaServicos extends Paginado { servicos: Servico[]; }
export interface ItemServico { id: number; descricao: string; valor: Dec; }

/** POST /api/servicos devolve isto; `aviso` aparece quando o km anda para trás */
export interface RespostaNovoServico {
  id: number;
  servico: Servico;
  aviso: string | null;
}

/* ---------- consulta de placa ---------- */
/* Placa que a oficina não conhece. NÃO é erro: é o começo de um atendimento.
   A API responde 200 com isto e a tela pede o modelo. */
export interface PrecisaModelo {
  placa: string;
  encontrado: false;
  precisa_modelo: true;
  motivo: string;
  acao: string;
  modelos_comuns: ModeloSugerido[];
  ms: number;
}

export interface ConsultaPlaca {
  placa: string;
  encontrado: boolean;
  origem_veiculo: string | null;
  veiculo: {
    marca: string | null; modelo: string | null; versao: string | null;
    cilindrada: string | null; ano: number | null; cor: string | null;
    combustivel?: string | null; carroceria?: string | null;
  };
  cadastro: {
    id: number; cliente_id: number; cliente: string; telefone: string | null;
    aceita_aviso: boolean; visitas: number; situacao: Situacao; dias: number | null;
    ultima_troca: string | null; ultimo_km: number | null;
  } | null;
  oleo: {
    status: string;
    viscosidades?: string[];
    preferida?: string | null;
    litros?: number | null;
    confianca?: number;
    origem?: string;
    porque?: string;
    palpite?: string[];
    na_casa?: NaCasaOleo | null;
    recomendado?: RecomendacaoOleo | null;
    confere_com_a_casa?: boolean;
    divergencia?: string;
  };
  filtros: Filtros;
  historico: Servico[];
  /** quando o modelo digitado não casou com nada */
  parecidos?: ModeloSugerido[] | null;
  confirmar: boolean;
  passos: { passo: string; achou?: boolean; ms?: number; erro?: string; pulado?: string }[];
  ms: number;
}

/* ---------- avisos ---------- */
export type TipoAviso = 'vencido' | 'aniversario' | 'campanha';
export type Desfecho = 'sem_resposta' | 'respondeu' | 'voltou' | 'pediu_sair';

export interface ItemFila {
  veiculo_id: number;
  placa: string;
  marca: string | null;
  modelo: string | null;
  ultima_troca: string | null;
  ultimo_km: number | null;
  ultimo_oleo: string | null;
  dias: number;
  cliente_id: number;
  cliente: string;
  telefone: string | null;
  tel_inferido: 0 | 1;
  ultimo_aviso: string | null;
  whatsapp: string | null;
}
export interface RespostaFila extends Paginado {
  tipo: TipoAviso;
  carencia_dias: number;
  fila: ItemFila[];
}

export interface ResultadoAvisos {
  periodo_dias: number;
  enviados: number;
  retornaram: number;
  taxa_retorno: number | null;
  responderam: number;
  pediram_sair: number;
  sem_desfecho: number;
  nota: string;
}

/* ---------- notificações ---------- */
export interface Notificacao {
  id: number;
  nivel: 'ok' | 'erro' | 'aviso';
  titulo: string;
  detalhe: string | null;
  origem: string;
  criada_em: string;
  lida_em: string | null;
}
export interface RespostaNotificacoes {
  nao_lidas: number;
  erros: number;
  notificacoes: Notificacao[];
}
