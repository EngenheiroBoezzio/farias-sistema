/* Integração com a API Google Gemini (Google AI Studio).
 * Utiliza o modelo rápido e gratuito (gemini-1.5-flash / gemini-2.0-flash).
 * Zero dependências externas: usa o fetch nativo do Node.js 18+.
 */
'use strict';
const { q, um } = require('../db');

const GEMINI_API_KEY = () => (process.env.GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = () => (process.env.GEMINI_MODEL || 'gemini-1.5-flash').trim();

// Cache em memória para evitar chamadas repetidas
const cacheMemoria = new Map();

function estaConfigurado() {
  return Boolean(GEMINI_API_KEY());
}

/** Executa chamada direta à API REST do Google Gemini */
async function chamarGemini(prompt, { systemInstruction, json = true, timeoutMs = 20000 } = {}) {
  const chave = GEMINI_API_KEY();
  if (!chave) {
    throw new Error('Chave do Google Gemini não configurada. Defina GEMINI_API_KEY no arquivo .env da API.');
  }

  const modelo = GEMINI_MODEL();
  /* A chave vai no CABECALHO, nao na URL.
     Com ?key= na querystring, a chave aparece inteira em qualquer log que
     registre a URL — proxy da rede, log do Google, um man-in-the-middle de
     empresa. No cabecalho x-goog-api-key (forma documentada pelo Google) ela
     fica fora do caminho que os logs guardam. */
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`;

  const bodyReq = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048
    }
  };

  if (systemInstruction) {
    bodyReq.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  if (json) {
    bodyReq.generationConfig.responseMimeType = 'application/json';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
      body: JSON.stringify(bodyReq),
      signal: controller.signal
    });

    clearTimeout(timer);

    if (!res.ok) {
      const errTexto = await res.text().catch(() => '');
      let detalhe = '';
      try {
        const parsed = JSON.parse(errTexto);
        detalhe = parsed?.error?.message || errTexto;
      } catch {
        detalhe = errTexto;
      }
      throw new Error(`Erro na API do Gemini (${res.status}): ${detalhe}`);
    }

    const jsonRes = await res.json();
    const textoSaida = jsonRes?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!textoSaida) {
      throw new Error('O Gemini não retornou resposta.');
    }

    if (json) {
      try {
        return JSON.parse(textoSaida);
      } catch {
        // Tenta extrair json de bloco markdown ```json ... ```
        const match = textoSaida.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (match) return JSON.parse(match[1]);
        throw new Error('Falha ao interpretar resposta estruturada da IA.');
      }
    }

    return textoSaida;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error('A consulta ao Google Gemini excedeu o tempo limite (timeout).');
    }
    throw err;
  }
}

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
  consultarCapacidadeOleo,
  identificarFiltrosVeiculo,
  gerarMensagemComunidade,
  chamarGemini
};
