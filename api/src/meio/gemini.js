/* Perguntas de IA do sistema (litragem, filtros, mensagens da Comunidade).
 * Quem chama a IA de fato é o revezamento em provedores-ia.js.
 */
'use strict';

const ia = require('./provedores-ia');

// Cache em memória para evitar chamadas repetidas
const cacheMemoria = new Map();

/* As chamadas agora passam pelo REVEZAMENTO (provedores-ia.js): o Gemini é o
   primeiro da fila, e se ele falhar a mesma pergunta vai para o próximo
   provedor configurado no .env. O nome do arquivo ficou "gemini.js" para não
   mexer em quem já importa daqui. */
function estaConfigurado() {
  return ia.ativos().length > 0;
}

/** Texto curto para a tela: "Gemini (gemini-3.6-flash) + 2 reservas". */
function modeloAtual() {
  const s = ia.situacao().filter(p => p.configurado);
  if (!s.length) return 'nenhuma IA configurada';
  const extra = s.length > 1 ? ` + ${s.length - 1} reserva${s.length > 2 ? 's' : ''}` : '';
  return `${s[0].nome} (${s[0].modelo})${extra}`;
}

const chamarGemini = (prompt, opc) => ia.chamarIA(prompt, opc);

/**
 * Consulta a capacidade exata do cárter em litros e viscosidade recomendada
 * para um veículo usando o Google Gemini.
 */
async function consultarCapacidadeOleo({ marca, modelo, motor, ano }) {
  const chaveCache = `oleo:${(marca || '').toLowerCase()}:${(modelo || '').toLowerCase()}:${(motor || '').toLowerCase()}:${ano || ''}`;
  if (cacheMemoria.has(chaveCache)) {
    return cacheMemoria.get(chaveCache);
  }

  const system = `Você é um engenheiro automotivo especialista em lubrificação e especificações de motores no mercado brasileiro.
Sua tarefa é retornar com rigor técnico os dados de troca de óleo para o veículo informado.
Responda ESTRITAMENTE em formato JSON com o seguinte schema:
{
  "litros": number (capacidade com troca do filtro de óleo em litros, ex: 3.5, 4.0, 4.3),
  "litros_sem_filtro": number ou null,
  "viscosidade_principal": string (ex: "5W-30", "0W-20", "5W-40"),
  "viscosidades_alternativas": string[] (outras viscosidades aceitas no manual),
  "norma_especificacao": string (ex: "API SP, Dexos 1 Gen 3, ACEA A5/B5, VW 508.88"),
  "tipo_oleo": string (ex: "100% Sintético", "Semissintético"),
  "observacoes": string (dica técnica sobre bujão, anel ou dreno, se houver)
}`;

  const prompt = `Veículo:
Marca: ${marca || 'Não informada'}
Modelo / Versão: ${modelo}
Motorização / Cilindrada: ${motor || 'Padrão da linha'}
Ano / Modelo: ${ano || 'Recente'}

Qual é a capacidade de óleo do motor com troca de filtro em litros e a viscosidade original homologada pela montadora?`;

  const resultado = await chamarGemini(prompt, { systemInstruction: system, json: true });

  if (resultado && typeof resultado.litros === 'number') {
    cacheMemoria.set(chaveCache, resultado);
  }
  return resultado;
}

/**
 * Identifica os códigos de filtros recomendados (Wega / OEM / Fram / Tecfil)
 * para um veículo pendente.
 */
async function identificarFiltrosVeiculo({ marca, modelo, motor, ano, combustivel }) {
  const chaveCache = `filtro:${(marca || '').toLowerCase()}:${(modelo || '').toLowerCase()}:${ano || ''}`;
  if (cacheMemoria.has(chaveCache)) {
    return cacheMemoria.get(chaveCache);
  }

  const system = `Você é um especialista em catálogo de filtros automotivos no Brasil (Wega, Tecfil, Fram, Mann, Mahle).
Identifique os códigos de filtros correspondentes ao veículo solicitado, priorizando códigos padrão de mercado brasileiro (como a linha Wega: WO para óleo, FAP/FAPL para ar, AKX para cabine, FCI/FCD para combustível).
Responda estritamente em JSON:
{
  "filtro_oleo": string ou null (código do filtro de óleo),
  "filtro_ar": string ou null (código do filtro de ar motor),
  "filtro_cabine": string ou null (código do filtro de cabine / ar-condicionado),
  "filtro_combustivel": string ou null (código do filtro de combustível),
  "confianca": number (de 50 a 100),
  "observacao": string
}`;

  const prompt = `Identifique os filtros para o veículo:
Marca: ${marca || ''}
Modelo: ${modelo}
Motor / Versão: ${motor || ''}
Ano: ${ano || ''}
Combustível: ${combustivel || ''}`;

  const resultado = await chamarGemini(prompt, { systemInstruction: system, json: true });
  if (resultado) {
    cacheMemoria.set(chaveCache, resultado);
  }
  return resultado;
}

/**
 * Gera mensagem atrativa para o canal do WhatsApp ou comunicação com clientes.
 */
async function gerarMensagemComunidade({ tema, tipo, nomeLoja }) {
  const system = `Você é um copywriter automotivo profissional para oficinas mecânicas e centros de troca de óleo de alto padrão no Brasil.
Crie mensagens diretas, agradáveis, com emojis elegantes e chamadas de ação para o WhatsApp.
Responda em formato JSON:
{
  "titulo": string (título curto da postagem ou tema),
  "texto": string (o corpo completo da mensagem para copiar e colar no WhatsApp)
}`;

  const prompt = `Oficina: ${nomeLoja || 'Farias Troca de Óleo'}
Tipo de mensagem: ${tipo || 'campanha'}
Tema / Assunto desejado: ${tema || 'A importância de trocar o óleo e os filtros no prazo correto'}`;

  return await chamarGemini(prompt, { systemInstruction: system, json: true });
}

module.exports = {
  estaConfigurado,
  modeloAtual,
  situacaoIA: ia.situacao,
  consultarCapacidadeOleo,
  identificarFiltrosVeiculo,
  gerarMensagemComunidade,
  chamarGemini
};
