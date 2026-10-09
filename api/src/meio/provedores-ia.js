/* Revezamento de IAs: tenta um provedor; se ele falhar, passa para o próximo.
 *
 * Só provedores com CHAVE OFICIAL de API. Nada de conta pessoal, cookie de
 * assinatura ou "proxy para driblar bloqueio": isso derruba a conta e a IA
 * da oficina junto.
 *
 * Configuração (tudo no .env, nada no banco — chave é segredo):
 *   IA_ORDEM=gemini,groq,cerebras,mistral,openrouter,deepseek,openai,anthropic
 *   <PROVEDOR>_API_KEY=...       só entra no revezamento quem tiver chave
 *   <PROVEDOR>_MODEL=...         opcional; troca o modelo daquele provedor
 *
 * Quando um provedor falha, ele fica "de molho" por um tempo para não fazer o
 * balcão esperar por ele em toda consulta:
 *   chave recusada / modelo inexistente -> 10 min (é configuração, não passa sozinho)
 *   limite de uso (429)                 -> 1 min
 *   fora do ar / demorou / resposta ruim -> 30 s
 *
 * Zero dependências: fetch nativo do Node 18+.
 */
'use strict';

/* ---------- erros que podem ir para a tela ---------- */
function erroIa(status, mensagem, detalheLog) {
  if (detalheLog) console.error('[ia]', detalheLog);
  const e = new Error(mensagem);
  e.status = status;
  e.publico = true;
  return e;
}

/* Falha de UM provedor: carrega quanto tempo ele fica de molho e um resumo
   curto para a mensagem final (sem chave, sem detalhe técnico). */
class FalhaProvedor extends Error {
  constructor(resumo, molhoMs, log) { super(resumo); this.molhoMs = molhoMs; this.log = log; }
}
const MOLHO_CONFIG = 10 * 60 * 1000;
const MOLHO_LIMITE = 60 * 1000;
const MOLHO_INSTAVEL = 30 * 1000;

function falhaPorStatus(status, detalhe) {
  const d = String(detalhe || '').slice(0, 400);
  if (status === 401 || status === 403 || (status === 400 && /api[ _-]?key|unauthori[sz]ed|invalid.*key/i.test(d)))
    return new FalhaProvedor('chave recusada', MOLHO_CONFIG, d);
  if (status === 404 || (status === 400 && /model/i.test(d) && /not.*(found|exist|support)|invalid model|unknown model|does not exist|decommission|deprecat/i.test(d)))
    return new FalhaProvedor('modelo não existe mais', MOLHO_CONFIG, d);
  if (status === 402) return new FalhaProvedor('sem crédito', MOLHO_CONFIG, d);
  if (status === 429) return new FalhaProvedor('limite de uso atingido', MOLHO_LIMITE, d);
  return new FalhaProvedor(`erro ${status}`, MOLHO_INSTAVEL, d);
}

/* ---------- modelo do Gemini (com proteção contra .env velho) ---------- */
const GEMINI_PADRAO = 'gemini-2.5-flash';
const GEMINI_APOSENTADO = /^gemini-(1\.0|1\.5|2\.0)(-|$)|^gemini-pro$/i;
let avisouGeminiVelho = false;
function modeloGemini() {
  const pedido = (process.env.GEMINI_MODEL || '').trim();
  if (!pedido) return GEMINI_PADRAO;
  if (GEMINI_APOSENTADO.test(pedido)) {
    if (!avisouGeminiVelho) {
      avisouGeminiVelho = true;
      console.warn(`[ia] GEMINI_MODEL=${pedido} foi desligado pelo Google; usando ${GEMINI_PADRAO}. Atualize o .env.`);
    }
    return GEMINI_PADRAO;
  }
  return pedido;
}

/* ---------- catálogo ----------
   Os modelos padrão foram conferidos na documentação de cada um em out/2026.
   Provedor troca nome de modelo com frequência: se um sair do ar, o revezamento
   pula para o próximo e o log avisa qual <PROVEDOR>_MODEL ajustar. */
const PROVEDORES = {
  gemini:     { nome: 'Gemini',     tipo: 'gemini',    padrao: null /* ver modeloGemini() */ },
  groq:       { nome: 'Groq',       tipo: 'openai', url: 'https://api.groq.com/openai/v1/chat/completions', padrao: 'openai/gpt-oss-120b' },
  cerebras:   { nome: 'Cerebras',   tipo: 'openai', url: 'https://api.cerebras.ai/v1/chat/completions',     padrao: 'gpt-oss-120b' },
  mistral:    { nome: 'Mistral',    tipo: 'openai', url: 'https://api.mistral.ai/v1/chat/completions',      padrao: 'mistral-small-latest' },
  openrouter: { nome: 'OpenRouter', tipo: 'openai', url: 'https://openrouter.ai/api/v1/chat/completions',   padrao: 'openrouter/auto' },
  deepseek:   { nome: 'DeepSeek',   tipo: 'openai', url: 'https://api.deepseek.com/chat/completions',       padrao: 'deepseek-flash' },
  openai:     { nome: 'OpenAI',     tipo: 'openai', url: 'https://api.openai.com/v1/chat/completions',      padrao: 'gpt-6-luna' },
  anthropic:  { nome: 'Claude',     tipo: 'anthropic', url: 'https://api.anthropic.com/v1/messages',        padrao: 'claude-haiku-4-5-20251001' }
};
const ORDEM_PADRAO = 'gemini,groq,cerebras,mistral,openrouter,deepseek,openai,anthropic';

const chaveDe = id => (process.env[`${id.toUpperCase()}_API_KEY`] || '').trim();
const modeloDe = id => id === 'gemini'
  ? modeloGemini()
  : ((process.env[`${id.toUpperCase()}_MODEL`] || '').trim() || PROVEDORES[id].padrao);

function ordem() {
  const lista = (process.env.IA_ORDEM || ORDEM_PADRAO).split(',')
    .map(s => s.trim().toLowerCase()).filter(Boolean);
  const vistos = new Set();
  return lista.filter(id => {
    if (!PROVEDORES[id] || vistos.has(id)) {
      if (!PROVEDORES[id]) console.warn(`[ia] IA_ORDEM tem "${id}", que não conheço. Ignorado.`);
      return false;
    }
    vistos.add(id);
    return true;
  });
}

/** Os provedores que vão ser tentados, na ordem: só quem tem chave. */
const ativos = () => ordem().filter(id => chaveDe(id));

/* ---------- molho (circuit breaker simples, em memória) ---------- */
const molho = new Map(); // id -> { ate: timestamp, motivo }
function deMolho(id) {
  const m = molho.get(id);
  if (!m) return null;
  if (Date.now() >= m.ate) { molho.delete(id); return null; }
  return m;
}

/* ---------- chamadas por tipo ---------- */
async function postJson(url, headers, corpo, timeoutMs) {
  const controller = new AbortController();
  let timer;
  /* Trava dupla: o abort cancela o fetch; a corrida garante que, mesmo se
     algo ignorar o abort, a espera termina no tempo-limite. */
  const estourou = new Promise((_, rej) => {
    timer = setTimeout(() => { controller.abort(); rej(Object.assign(new Error('timeout'), { name: 'AbortError' })); }, timeoutMs);
  });
  try {
    const res = await Promise.race([fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(corpo),
      signal: controller.signal
    }), estourou]);
    const texto = await Promise.race([res.text().catch(() => ''), estourou]);
    let json = null;
    try { json = JSON.parse(texto); } catch { /* fica null */ }
    if (!res.ok) {
      const det = json?.error?.message || json?.message || json?.detail || texto;
      throw falhaPorStatus(res.status, typeof det === 'string' ? det : JSON.stringify(det));
    }
    if (!json) throw new FalhaProvedor('resposta ilegível', MOLHO_INSTAVEL, texto.slice(0, 300));
    return json;
  } catch (e) {
    if (e instanceof FalhaProvedor) throw e;
    if (e.name === 'AbortError') throw new FalhaProvedor('demorou demais', MOLHO_INSTAVEL);
    throw new FalhaProvedor('sem conexão', MOLHO_INSTAVEL, e.message);
  } finally {
    clearTimeout(timer);
  }
}

async function chamarTipoGemini(chave, modelo, { prompt, systemInstruction, json, timeoutMs }) {
  /* Chave no cabeçalho, nunca na URL (URL vai parar em log de proxy). */
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`;
  const corpo = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 4096 }
  };
  if (systemInstruction) corpo.systemInstruction = { parts: [{ text: systemInstruction }] };
  if (json) corpo.generationConfig.responseMimeType = 'application/json';
  /* O 2.5 "pensa" e esse pensamento gasta o mesmo limite da resposta. */
  if (/^gemini-2\.5-flash/i.test(modelo)) corpo.generationConfig.thinkingConfig = { thinkingBudget: 0 };

  const r = await postJson(url, { 'x-goog-api-key': chave }, corpo, timeoutMs);
  const partes = r?.candidates?.[0]?.content?.parts || [];
  return partes.filter(p => p && !p.thought && typeof p.text === 'string').map(p => p.text).join('');
}

async function chamarTipoOpenai(id, chave, modelo, { prompt, systemInstruction, json, timeoutMs }) {
  const p = PROVEDORES[id];
  const msgs = [];
  if (systemInstruction) msgs.push({ role: 'system', content: systemInstruction });
  msgs.push({ role: 'user', content: prompt });
  const corpo = { model: modelo, messages: msgs, temperature: 0.2, max_tokens: 4096 };
  if (json) corpo.response_format = { type: 'json_object' };
  /* Modelos gpt-oss pensam antes de responder; para dado simples, pouco basta. */
  if (/gpt-oss/i.test(modelo) && (id === 'groq' || id === 'cerebras')) corpo.reasoning_effort = 'low';

  const headers = { Authorization: `Bearer ${chave}` };
  if (id === 'openrouter') { headers['HTTP-Referer'] = 'https://farias.app'; headers['X-Title'] = 'Farias Troca de Oleo'; }

  let r;
  try {
    r = await postJson(p.url, headers, corpo, timeoutMs);
  } catch (e) {
    /* Alguns modelos não aceitam o modo JSON. Tenta uma vez sem ele: o texto
       já pede JSON, e o leitor abaixo extrai de dentro de ```json. */
    if (json && e instanceof FalhaProvedor && /response_format|json_object|json mode/i.test(e.log || '')) {
      delete corpo.response_format;
      r = await postJson(p.url, headers, corpo, timeoutMs);
    } else throw e;
  }
  const c = r?.choices?.[0]?.message?.content;
  return Array.isArray(c) ? c.map(x => x?.text || '').join('') : (c || '');
}

async function chamarTipoAnthropic(chave, modelo, { prompt, systemInstruction, json, timeoutMs }) {
  const sistema = [systemInstruction, json ? 'Responda somente com o JSON pedido, sem texto antes ou depois.' : '']
    .filter(Boolean).join('\n\n');
  const corpo = { model: modelo, max_tokens: 4096, temperature: 0.2, messages: [{ role: 'user', content: prompt }] };
  if (sistema) corpo.system = sistema;
  const r = await postJson(PROVEDORES.anthropic.url,
    { 'x-api-key': chave, 'anthropic-version': '2023-06-01' }, corpo, timeoutMs);
  return (r?.content || []).filter(b => b?.type === 'text').map(b => b.text).join('');
}

/* ---------- leitura da resposta ---------- */
function lerJson(texto) {
  const t = String(texto || '').trim();
  try { return JSON.parse(t); } catch { /* tenta extrair */ }
  const bloco = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (bloco) { try { return JSON.parse(bloco[1]); } catch { /* segue */ } }
  const ini = t.indexOf('{'), fim = t.lastIndexOf('}');
  if (ini >= 0 && fim > ini) { try { return JSON.parse(t.slice(ini, fim + 1)); } catch { /* segue */ } }
  throw new FalhaProvedor('formato inesperado', MOLHO_INSTAVEL, t.slice(0, 300));
}

/* ---------- o revezamento ---------- */
/**
 * Pergunta para a primeira IA que responder.
 * @returns o JSON (json = true) ou o texto da resposta.
 */
async function chamarIA(prompt, { systemInstruction, json = true, timeoutMs = 20000, totalMs = 45000 } = {}) {
  const lista = ativos();
  if (!lista.length)
    throw erroIa(503, 'A IA não está configurada no servidor (nenhuma chave de IA no .env).');

  const inicio = Date.now();
  const falhas = [];
  let tentou = 0;

  /* Se todo mundo estiver de molho, tenta mesmo assim o que volta primeiro:
     melhor arriscar do que negar na hora. */
  const livres = lista.filter(id => !deMolho(id));
  const fila = livres.length ? livres
    : [...lista].sort((a, b) => deMolho(a).ate - deMolho(b).ate).slice(0, 1);
  for (const id of lista) if (!fila.includes(id)) falhas.push(`${PROVEDORES[id].nome}: ${deMolho(id).motivo} (pausado)`);

  for (const id of fila) {
    const resta = totalMs - (Date.now() - inicio);
    if (resta < 3000) { falhas.push(`${PROVEDORES[id].nome}: sem tempo`); break; }
    const p = PROVEDORES[id];
    const modelo = modeloDe(id);
    const opc = { prompt, systemInstruction, json, timeoutMs: Math.min(timeoutMs, resta) };
    tentou++;
    try {
      let texto;
      if (p.tipo === 'gemini') texto = await chamarTipoGemini(chaveDe(id), modelo, opc);
      else if (p.tipo === 'anthropic') texto = await chamarTipoAnthropic(chaveDe(id), modelo, opc);
      else texto = await chamarTipoOpenai(id, chaveDe(id), modelo, opc);

      if (!String(texto || '').trim()) throw new FalhaProvedor('resposta vazia', MOLHO_INSTAVEL);
      const saida = json ? lerJson(texto) : String(texto).trim();
      molho.delete(id);
      if (falhas.length) console.warn(`[ia] respondeu ${p.nome} (${modelo}) depois de: ${falhas.join('; ')}`);
      return saida;
    } catch (e) {
      const f = e instanceof FalhaProvedor ? e : new FalhaProvedor('erro inesperado', MOLHO_INSTAVEL, e && e.message);
      molho.set(id, { ate: Date.now() + f.molhoMs, motivo: f.message });
      falhas.push(`${p.nome}: ${f.message}`);
      console.warn(`[ia] ${p.nome} (${modelo}) falhou: ${f.message}${f.log ? ' — ' + String(f.log).slice(0, 300) : ''}`);
    }
  }

  throw erroIa(503,
    `Nenhuma IA conseguiu responder agora (${falhas.join('; ')}). Tente de novo em instantes.`,
    `todas falharam depois de ${tentou} tentativa(s)`);
}

/** Para a tela de status: quem está no revezamento e quem está de molho.
    Nunca devolve chave. */
function situacao() {
  return ordem().map(id => {
    const m = deMolho(id);
    return {
      id, nome: PROVEDORES[id].nome, modelo: modeloDe(id),
      configurado: !!chaveDe(id),
      pausado: m ? { motivo: m.motivo, volta_em_s: Math.ceil((m.ate - Date.now()) / 1000) } : null
    };
  });
}

module.exports = { chamarIA, situacao, ativos, erroIa, modeloGemini, PROVEDORES, _molho: molho };
