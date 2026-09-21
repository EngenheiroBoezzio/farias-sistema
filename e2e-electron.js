/* Prova o app EMPACOTADO falando com uma API remota.
 *
 * É o cenário de entrega: API no servidor do fornecedor, executável na
 * máquina da oficina. Duas coisas que só aparecem aqui e não no navegador:
 * a origem `app://farias` (file:// manda Origin: null e a API recusa) e a
 * configuração travada, que não pode ser contornada de dentro da página.
 *
 *   API=http://192.0.2.2:3001 xvfb-run -a electron e2e-electron.js
 */
const { app, BrowserWindow } = require('electron');
Object.defineProperty(app, 'isPackaged', { get: () => true });
require('./electron/main.js');

const API = process.env.API || 'http://192.0.2.2:3001';
const USUARIO = process.env.TESTE_USUARIO || 'raissa';
const SENHA = process.env.TESTE_SENHA || 'farias2026';

let passou = 0, falhou = 0;
const ok = (n, c, d = '') => {
  c ? passou++ : falhou++;
  console.log(`  ${c ? 'ok  ' : 'FALHA'} ${n}${d ? ' · ' + d : ''}`);
};

app.whenReady().then(async () => {
  console.log('\n=== aplicativo empacotado x API remota ===\n');
  await new Promise(r => setTimeout(r, 4000));
  const w = BrowserWindow.getAllWindows()[0];
  if (!w) { ok('a janela abriu', false); return fim(); }

  const erros = [];
  w.webContents.on('console-message', (_e, nivel, msg) => {
    if (nivel >= 2 && !/401|Autoriza/i.test(msg)) erros.push(msg.slice(0, 120));
  });

  ok('a janela abriu', true, w.webContents.getURL());
  ok('a tela NÃO roda em file://', !/^file:/.test(w.webContents.getURL()));

  const r = await w.webContents.executeJavaScript(`(async () => {
    const o = { origem: location.origin };
    const cfg = await (await fetch('config.json')).json();
    o.apiUrl = cfg.apiUrl; o.travado = cfg.travado;
    const s = await fetch('${API}/health', { cache: 'no-store' });
    o.health = s.status;
    const l = await fetch('${API}/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usuario: '${USUARIO}', senha: '${SENHA}' }) });
    o.login = l.status; o.token = !!(await l.json()).token;
    return o;
  })()`);

  ok('a origem é app://farias, e não null', r.origem === 'app://farias', r.origem);
  ok('a configuração veio gravada no pacote', r.apiUrl === API, r.apiUrl);
  ok('e está travada', r.travado === true);
  ok('a API remota aceita a origem do app', r.health === 200, `health ${r.health}`);
  ok('e o login funciona através dela', r.login === 200 && r.token, `login ${r.login}`);

  /* Tentativa de burlar: plantar outro endereço no localStorage, como quem
     abre o DevTools. Travado, isso não pode mudar nada. */
  await w.webContents.executeJavaScript(
    `localStorage.setItem('farias.config', JSON.stringify({ apiUrl: 'http://servidor-do-mal:9999' }))`);
  await w.webContents.reload();
  await new Promise(r => setTimeout(r, 3500));
  const depois = await w.webContents.executeJavaScript(
    `(async () => (await (await fetch('config.json')).json()).apiUrl)()`);
  ok('localStorage não consegue apontar o app para outro servidor',
     depois === API, depois);

  /* entra de verdade pela tela e navega */
  await w.webContents.executeJavaScript(`
    (() => { location.hash = '#/entrar'; })()`);
  await new Promise(r => setTimeout(r, 1200));
  const entrou = await w.webContents.executeJavaScript(`(async () => {
    const u = document.querySelector('#u'), s = document.querySelector('#s');
    if (!u || !s) return { erro: 'campos não encontrados' };
    const set = (el, v) => {
      const p = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      p.set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(u, '${USUARIO}'); set(s, '${SENHA}');
    document.querySelector('button[type=submit]').click();
    await new Promise(r => setTimeout(r, 4000));
    return { hash: location.hash, stat: document.querySelectorAll('.stat-v').length };
  })()`);
  ok('entra pela tela e cai no painel', /painel/.test(entrou.hash || ''), JSON.stringify(entrou));
  ok('o painel traz números vindos da API remota', (entrou.stat || 0) > 0,
     `${entrou.stat} indicadores`);

  /* a tela de configuração não pode oferecer campo de servidor */
  await w.webContents.executeJavaScript(`(() => { location.hash = '#/configuracao'; })()`);
  await new Promise(r => setTimeout(r, 1800));
  const cfgTela = await w.webContents.executeJavaScript(`(() => ({
    campoApi: !!document.querySelector('input[name=api]'),
    botaoSalvar: [...document.querySelectorAll('button')].some(b => /Salvar/i.test(b.textContent)),
    mostraEndereco: document.body.innerText.includes('${API}'),
    selo: document.body.innerText.includes('definido na instalação')
  }))()`);
  ok('não existe campo para digitar o endereço', cfgTela.campoApi === false);
  ok('nem botão de salvar servidor', cfgTela.botaoSalvar === false);
  ok('mas o endereço aparece para o suporte', cfgTela.mostraEndereco === true);
  ok('com o selo de "definido na instalação"', cfgTela.selo === true);

  ok('nenhum erro de JavaScript', erros.length === 0, erros.slice(0, 2).join(' / '));

  await w.webContents.capturePage().then(img =>
    require('fs').writeFileSync('/tmp/claude-0/electron-config.png', img.toPNG()));
  fim();
});

function fim() {
  console.log(`\n${passou} passaram · ${falhou} falharam\n`);
  app.exit(falhou ? 1 : 0);
}
