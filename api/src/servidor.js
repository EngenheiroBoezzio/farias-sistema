/* ===========================================================
   Farias — servidor da API
   Montado seguindo o playbook: defesa em camadas na borda,
   nada confiando no cliente, e tempo medido em toda resposta.
   =========================================================== */
'use strict';
require('./ambiente');

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const fs = require('fs');
const path = require('path');

const { pool } = require('./db');
const { handlerDeErro, rota } = require('./meio/erros');

/* A pasta do front compilado. Se existir, esta mesma porta entrega a tela —
   é o modo de instalação da oficina: um serviço só, um endereço só. Sem ela,
   a API segue sendo só API, que é como o `ng serve` e o Electron falam. */
const PUBLICO = process.env.PUBLICO_DIR || path.join(__dirname, '..', 'publico');
const SERVE_FRONT = fs.existsSync(path.join(PUBLICO, 'index.html'));

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);          // atrás de proxy: IP real para o rate limit

/* ---------- borda ---------- */
app.use(helmet({
  /* Só faz sentido quando há HTML para proteger. Servindo o front daqui, a
     política é fechada: script e estilo só deste servidor, nada de <iframe>,
     nada de conexão para fora. O 'unsafe-inline' em style é exigência do
     Angular, que injeta estilo de componente inline; em script NÃO entra, que
     é onde o XSS moraria. */
  contentSecurityPolicy: SERVE_FRONT ? {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  } : false,
  crossOriginResourcePolicy: { policy: 'same-site' }
}));

/* O aplicativo de balcão empacotado com Electron chega como `app://farias`:
   ele registra um esquema próprio justamente para ter uma origem de verdade,
   em vez de `file://`, que manda `Origin: null` e não tem como ser liberado
   sem abrir a porta para qualquer página em sandbox. Fica na lista por
   padrão, porque sem isso o executável instalado não fala com a API. */
const ORIGEM_APP = 'app://farias';

/* Normaliza antes de comparar. A comparação era byte a byte, e isso derrubava
   configuração correta por detalhe que ninguém enxerga:

   - MAIÚSCULA no domínio. O navegador SEMPRE manda o host em minúsculo, então
     `CORS_ORIGENS=http://Farias.exemplo.com` recusava toda chamada vinda de
     https://Farias.exemplo.com — o dono do servidor digitou certo e levou 500.
   - barra no fim. `http://x.com/` nunca casa com o Origin, que vem sem barra.
   - porta padrão escrita à mão: `http://x.com:80` e `https://x.com:443` são a
     mesma origem que sem porta, mas não como texto.

   Esquema e host são caixa-insensível por definição (RFC 3986); o resto da
   URL não entra numa origem. Então normalizar aqui é correto, não frouxo. */
function normalizarOrigem(v) {
  const t = String(v || '').trim();
  if (!t) return '';
  try {
    const u = new URL(t);
    const porta = (u.protocol === 'http:' && u.port === '80') ||
                  (u.protocol === 'https:' && u.port === '443') ? '' : u.port;
    return `${u.protocol.toLowerCase()}//${u.hostname.toLowerCase()}${porta ? ':' + porta : ''}`;
  } catch {
    return t.toLowerCase().replace(/\/+$/, '');   // esquemas que a URL não parseia
  }
}

const CONFIGURADAS = (process.env.CORS_ORIGENS || 'http://localhost:5173')
  .split(',').map(s => s.trim()).filter(Boolean);
const ORIGENS = [...CONFIGURADAS, ORIGEM_APP];
const ORIGENS_NORM = new Set(ORIGENS.map(normalizarOrigem));

/* Mesma origem NUNCA é "outra origem".
   Servindo o front daqui, o próprio navegador manda Origin nos <script
   crossorigin> que o Angular gera — e a lista branca derrubava o app com 500
   em cima do próprio bundle. CORS existe para barrar site de terceiro, não a
   página que este servidor acabou de entregar.

   O par Origin+Host é confiável para isto: uma página de outro site não
   consegue forjar o Origin dela, então "Origin igual ao Host que atendeu" só
   acontece quando é de fato a mesma origem. */
function mesmaOrigem(origem, req) {
  try {
    return new URL(origem).host.toLowerCase() ===
           String(req.headers.host || '').toLowerCase();
  } catch { return false; }
}

/* Forma delegada do cors: é a única que entrega o `req` para a decisão. */
app.use(cors((req, cb) => {
  const base = { credentials: true, maxAge: 86400 };  // some o OPTIONS a cada chamada
  const origem = req.headers.origin;
  if (!origem) return cb(null, { ...base, origin: true });        // curl, app nativo
  if (ORIGENS_NORM.has(normalizarOrigem(origem)))
    return cb(null, { ...base, origin: origem });
  if (SERVE_FRONT && mesmaOrigem(origem, req)) return cb(null, { ...base, origin: origem });

  /* Dizer QUAL origem foi recusada e quais valem. Antes o log só dizia
     "Origem não autorizada", e descobrir que faltava um https ou sobrava uma
     maiúscula virava caça ao fantasma. */
  console.warn(`[cors] recusei "${origem}" · liberadas: ${ORIGENS.join(', ')}` +
               `${SERVE_FRONT ? ' (e a própria origem que serviu a página)' : ''}`);
  const e = new Error('Origem não autorizada.');
  e.origemRecusada = origem;
  cb(e);
}));

app.use(compression());                               // JSON repetitivo encolhe ~90%
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

/* ---------- tempo em toda resposta ---------- */
/* Por padrão só o que demora aparece no log — registrar tudo numa oficina
   enche o disco sem ninguém ler. Com LOG_ACESSO=1 registra cada chamada, que
   é o que se quer na hora de descobrir por que o computador do balcão não
   conversa com o servidor: dá para ver se a chamada chega e com que origem. */
const LOG_ACESSO = process.env.LOG_ACESSO === '1';
app.use((req, res, next) => {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (LOG_ACESSO)
      console.log(`[acesso] ${res.statusCode} ${req.method} ${req.originalUrl}` +
                  ` ${ms.toFixed(1)}ms origem=${req.headers.origin || '(nenhuma)'}`);
    if (ms > 200) console.warn(`[lento] ${req.method} ${req.originalUrl} ${ms.toFixed(1)}ms`);
  });
  res.setHeader('X-Tempo-Inicio', Date.now());
  const json = res.json.bind(res);
  res.json = corpo => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    res.setHeader('X-Tempo-ms', ms.toFixed(1));
    return json(corpo && typeof corpo === 'object' && !Array.isArray(corpo)
      ? { ...corpo, _ms: +ms.toFixed(1) } : corpo);
  };
  next();
});

/* ---------- rate limit em camadas ---------- */
/* Teto geral por IP. Ele existe contra script desgovernado, não contra o
   balcão: a oficina inteira sai por um IP só na rede local, e com o campo de
   modelo autocompletando a cada tecla, 600 por 15 minutos (40 por minuto,
   divididos por todos os computadores) começava a apertar num dia cheio.
   2.000 continua cortando abuso e nunca encosta em três atendentes. */
const limiteGeral = rateLimit({
  windowMs: 15 * 60 * 1000, max: 2000,
  standardHeaders: true, legacyHeaders: false,
  message: { erro: 'Muitas requisições. Aguarde alguns minutos.' }
});
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000, max: 8,
  skipSuccessfulRequests: true,
  message: { erro: 'Muitas tentativas de login. Aguarde 15 minutos.' }
});
/* Este limite existe para proteger DINHEIRO: cada consulta de placa que sai
   para fora é paga. Por isso ele é apertado. */
const limiteCaro = rateLimit({
  windowMs: 60 * 1000, max: 15,
  message: { erro: 'Muitas consultas externas em pouco tempo. Aguarde um minuto.' },
  /* ...e por isso ele NÃO pode valer para /modelos e /por-modelo, que só
     leem o banco daqui e não custam nada. /modelos é autocompletar: dispara
     a cada tecla, e 15 por minuto travaria a tela no meio de "Corolla". */
  skip: req => /^\/(modelos|por-modelo)\b/.test(req.path)
});
/* Limite próprio do autocompletar: solto o bastante para digitar à vontade,
   apertado o bastante para não virar varredura do catálogo inteiro. */
const limiteDigitacao = rateLimit({
  windowMs: 60 * 1000, max: 180,
  message: { erro: 'Muitas buscas em pouco tempo. Aguarde um minuto.' }
});

app.use('/api', limiteGeral);
app.use('/api/auth/login', limiteLogin);
app.use('/api/placa', limiteCaro);                    // consulta externa que custa
app.use('/api/placa/modelos', limiteDigitacao);       // autocompletar, de graça

/* ---------- health (público, sem limite) ---------- */
app.get('/health', rota(async (_req, res) => {
  const t0 = Date.now();
  await pool.query('SELECT 1');
  res.json({ ok: true, banco_ms: Date.now() - t0, versao: process.version });
}));

/* ---------- rotas ---------- */
app.use('/api/auth', require('./rotas/auth'));
app.use('/api/clientes', require('./rotas/clientes'));
app.use('/api/veiculos', require('./rotas/veiculos'));
app.use('/api/servicos', require('./rotas/servicos'));
app.use('/api/placa', require('./rotas/placa'));
app.use('/api/avisos', require('./rotas/avisos'));
app.use('/api/painel', require('./rotas/painel'));
app.use('/api/notificacoes', require('./rotas/notificacoes'));
app.use('/api/config', require('./rotas/config'));
app.use('/api/precos', require('./rotas/precos').rotas);

/* ---------- o front, quando ele mora aqui dentro ----------
   Se a pasta publico/ existir, esta mesma porta entrega a tela. É o modo de
   instalação padrão na oficina: um serviço só, um endereço só, e o navegador
   abre em http://a-maquina:3001. Some o CORS (mesma origem) e some o passo de
   "configurar o endereço da API", que é onde uma instalação costuma emperrar.

   Fica opcional de propósito: sem a pasta, a API segue sendo só API, que é
   como o app Electron e o `ng serve` do desenvolvimento falam com ela. */
if (SERVE_FRONT) {
  /* Os arquivos com hash no nome nunca mudam de conteúdo — podem ficar no
     cache por um ano. index.html e config.json mudam, e cache neles faria a
     oficina continuar vendo a versão velha depois de uma atualização. */
  app.use(express.static(PUBLICO, {
    index: false,
    setHeaders(res, arquivo) {
      const nome = path.basename(arquivo);
      if (nome === 'index.html' || nome === 'config.json')
        res.setHeader('Cache-Control', 'no-cache');
      else if (/-[A-Z0-9]{8}\.(js|css)$/i.test(nome))
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }));

  /* O app usa rotas com # (exigência do Electron em file://), então o servidor
     só precisa devolver o index. Nada de curinga engolindo /api. */
  /* sendFile não passa pelo setHeaders do static, então o no-cache do index
     vai aqui à mão: sem ele o navegador serve a tela velha depois de uma
     atualização e a oficina acha que nada mudou. */
  const indice = path.join(PUBLICO, 'index.html');
  app.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indice);
  });

  console.log(`front-end servido de ${PUBLICO}`);
}

app.use((req, res) => {
  /* Quem pediu /api/... e chegou aqui errou a rota; quem pediu outra coisa
     provavelmente digitou um endereço no navegador e merece texto, não JSON. */
  if (req.path.startsWith('/api/') || req.accepts('json') === 'json')
    return res.status(404).json({ erro: 'Rota não encontrada.' });
  res.status(404).type('text/plain').send('Página não encontrada.');
});
app.use(handlerDeErro);

/* ---------- sobe ---------- */
const PORTA = +(process.env.PORT || 3001);
const servidor = app.listen(PORTA, () => {
  console.log(`API da Farias na porta ${PORTA} · origens: ${ORIGENS.join(', ')}`);
});

for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, () => {
    console.log(`\n${sinal} recebido, encerrando…`);
    servidor.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 8000).unref();
  });
}

module.exports = app;
