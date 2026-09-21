/* Processo principal do Electron.
 *
 * Duas decisões que valem explicar:
 *
 * 1. A configuração tem dois modos. Solto, o endereço da API fica num arquivo
 *    na pasta de dados do usuário e dá para trocar pela tela. TRAVADO, ele é
 *    gravado antes de compilar e vira parte do executável — é o modo de quem
 *    hospeda a API para o cliente, em que a oficina não configura servidor
 *    nenhum porque não é ela que mantém o servidor.
 *
 * 2. A janela roda com isolamento de contexto e sem Node: o renderer é uma
 *    página web comum, e tudo que precisa do sistema passa pelo preload, por
 *    uma lista fechada de funções.
 */
'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const DEV = !app.isPackaged;
const RAIZ_TELA = path.join(__dirname, '..', 'dist', 'farias-app', 'browser');

/* ---------- por que a tela NÃO é carregada de file:// ----------

   Carregando com loadFile, a janela fica na origem `file://`, e o Chromium
   manda `Origin: null` em toda chamada. Do lado da API isso é uma origem
   estranha como qualquer outra: cai fora da lista branca e volta erro. O app
   abre bonito e não consegue falar com o servidor — e isso só apareceria na
   máquina da oficina, depois de instalado.

   Registrando um esquema próprio, a janela ganha uma origem real e estável,
   `app://farias`, que entra na lista branca da API como qualquer outra. É o
   caminho documentado do Electron para app empacotado, e resolve o problema
   na raiz em vez de afrouxar o CORS do servidor.

   Tem que ser declarado ANTES do app ficar pronto. */
const ESQUEMA = 'app';
const ORIGEM_APP = `${ESQUEMA}://farias`;

protocol.registerSchemesAsPrivileged([{
  scheme: ESQUEMA,
  privileges: { standard: true, secure: true, supportFetchAPI: true,
                corsEnabled: true, stream: true }
}]);

/** Serve os arquivos do build por app://farias/... */
function registrarEsquema() {
  protocol.handle(ESQUEMA, async pedido => {
    let caminho;
    try {
      const { pathname } = new URL(pedido.url);
      const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
      caminho = path.join(RAIZ_TELA, rel);
    } catch {
      return new Response('pedido inválido', { status: 400 });
    }

    /* Sem isto, app://farias/../../../etc/passwd sairia da pasta do build. */
    const dentro = path.resolve(caminho);
    if (dentro !== RAIZ_TELA && !dentro.startsWith(RAIZ_TELA + path.sep))
      return new Response('fora do aplicativo', { status: 403 });

    if (!fs.existsSync(dentro))
      return new Response('não encontrado', { status: 404 });

    const resposta = await net.fetch(pathToFileURL(dentro).toString());

    /* Política de segurança de conteúdo do app empacotado.
       Servido pela API, quem manda este cabeçalho é o servidor; aqui não há
       servidor, e sem ele o Electron avisa no console que a janela roda sem
       política nenhuma — com razão. `connect-src` precisa soltar http e https
       porque a API mora em outro endereço, que é o ponto desta arquitetura;
       script continua só do próprio app, que é onde o XSS moraria. */
    if (/\.html?$/i.test(dentro)) {
      const cab = new Headers(resposta.headers);
      cab.set('Content-Security-Policy', [
        `default-src '${'self'}'`,
        `script-src '${'self'}'`,
        `style-src '${'self'}' '${'unsafe-inline'}'`,
        `img-src '${'self'}' data:`,
        `font-src '${'self'}' data:`,
        `connect-src '${'self'}' http: https:`,
        `object-src '${'none'}'`,
        `frame-ancestors '${'none'}'`,
        `base-uri '${'self'}'`,
        `form-action '${'self'}'`
      ].join('; '));
      return new Response(resposta.body, { status: resposta.status, headers: cab });
    }

    return resposta;
  });
}

/* Dois arquivos de configuração, e a diferença entre eles é o ponto todo:

   - o DO PACOTE, gravado antes de compilar e embutido no executável. É onde
     fica o endereço da API quando quem hospeda o servidor é o fornecedor.
   - o DO USUÁRIO, na pasta de dados, que sobrevive à atualização do app.

   Se o do pacote disser `travado: true`, o do usuário é ignorado e gravar
   passa a ser recusado. Sem isso, bastaria largar um config.json na pasta de
   dados para o programa da oficina apontar para outro servidor — e o
   bloqueio na tela seria enfeite. */
const ARQ_CONFIG = path.join(app.getPath('userData'), 'config.json');
const ARQ_PACOTE = path.join(__dirname, '..', 'dist', 'farias-app', 'browser', 'config.json');

function configDoPacote() {
  try {
    if (fs.existsSync(ARQ_PACOTE))
      return JSON.parse(fs.readFileSync(ARQ_PACOTE, 'utf8'));
  } catch (e) {
    console.error('[config] pacote ilegível:', e.message);
  }
  return null;
}

const estaTravado = () => configDoPacote()?.travado === true;

function lerConfig() {
  try {
    if (fs.existsSync(ARQ_CONFIG)) {
      const doDisco = JSON.parse(fs.readFileSync(ARQ_CONFIG, 'utf8'));
      if (estaTravado()) {
        const pacote = configDoPacote() || {};
        return { ...doDisco, apiUrl: pacote.apiUrl, travado: true, nomeLoja: pacote.nomeLoja };
      }
      return doDisco;
    }
  } catch (e) {
    console.error('[config] não consegui ler:', e.message);
  }
  return null;
}

function salvarConfig(c) {
  try {
    const seguro = { ...c };
    if (estaTravado()) {
      const pacote = configDoPacote() || {};
      seguro.apiUrl = pacote.apiUrl;
      seguro.travado = true;
      seguro.nomeLoja = pacote.nomeLoja;
    }
    fs.mkdirSync(path.dirname(ARQ_CONFIG), { recursive: true });
    fs.writeFileSync(ARQ_CONFIG, JSON.stringify(seguro, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[config] não consegui gravar:', e.message);
    return false;
  }
}

let janela = null;

function criarJanela() {
  janela = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    show: false,                       // só aparece pronta, sem flash branco
    backgroundColor: '#120E0D',
    title: 'Farias Troca de Óleo',
    icon: path.join(__dirname, '..', 'build', 'icone.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  janela.once('ready-to-show', () => janela.show());
  janela.setMenuBarVisibility(false);

  if (DEV) {
    janela.loadURL('http://localhost:4200');
  } else {
    janela.loadURL(`${ORIGEM_APP}/index.html`);
  }

  /* Link externo abre no navegador do sistema, não dentro do app: é assim que
     o wa.me do WhatsApp funciona sem sequestrar a janela. */
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // navegação para fora também sai para o navegador
  janela.webContents.on('will-navigate', (e, url) => {
    const atual = janela.webContents.getURL();
    if (new URL(url).origin !== new URL(atual).origin) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  janela.on('closed', () => { janela = null; });
}

/* ---------- ponte com a tela ---------- */
ipcMain.handle('config:ler', () => lerConfig());
ipcMain.handle('config:salvar', (_e, c) => salvarConfig(c));
ipcMain.handle('app:versao', () => app.getVersion());
/* A tela mostra isto na Configuração: é o que o Pedro precisa pôr no
   CORS_ORIGENS da API para este app poder falar com ela. */
ipcMain.handle('app:origem', () => (DEV ? 'http://localhost:4200' : ORIGEM_APP));

/* ---------- atualização automática ----------
   A espera para o GitHub que o cliente pediu. O electron-updater lê o
   `publish` do package.json e busca a release mais nova do repositório.
   Enquanto o repositório não existir, a verificação avisa e segue — o app
   não pode deixar de abrir por causa disso. */
let updater = null;
function carregarUpdater() {
  if (updater !== null) return updater;
  try {
    updater = require('electron-updater').autoUpdater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;   // instala ao fechar, não no meio do expediente
    updater.on('error', e => console.error('[atualizacao]', e?.message || e));
    updater.on('update-downloaded', i => {
      console.log('[atualizacao] versão', i?.version, 'pronta para instalar ao fechar');
      if (janela) janela.webContents.send('app:atualizacao-pronta', i?.version);
    });
  } catch {
    updater = false;                       // pacote não instalado ainda
  }
  return updater;
}

ipcMain.handle('app:verificar-atualizacao', async () => {
  if (DEV) return { disponivel: false, motivo: 'em desenvolvimento' };
  const up = carregarUpdater();
  if (!up) return { disponivel: false, motivo: 'atualizador não instalado' };
  try {
    const r = await up.checkForUpdates();
    const nova = r?.updateInfo?.version;
    return { disponivel: !!nova && nova !== app.getVersion(), versao: nova };
  } catch (e) {
    return { disponivel: false, motivo: e?.message || 'falhou' };
  }
});

/* ---------- ciclo de vida ---------- */

// uma instância só: duas janelas no mesmo banco confundem o balcão
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (janela) { if (janela.isMinimized()) janela.restore(); janela.focus(); }
  });

  app.whenReady().then(() => {
    if (!DEV) registrarEsquema();
    criarJanela();
    if (!DEV) {
      const up = carregarUpdater();
      if (up) up.checkForUpdatesAndNotify().catch(() => {});
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) criarJanela();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

process.on('uncaughtException', e => {
  console.error('[fatal]', e);
  if (app.isReady())
    dialog.showErrorBox('Erro inesperado',
      'O programa encontrou um problema.\n\n' + (e?.message || String(e)));
});
