import { chromium } from 'playwright';
const erros = [];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
pg.on('console', m => {
  const t = m.text();
  // o 401 da tentativa de senha errada é resposta esperada do servidor
  if (m.type() === 'error' && !/401/.test(t)) erros.push('console: ' + t.slice(0,140));
});
pg.on('pageerror', e => erros.push('pageerror: ' + e.message.slice(0,140)));

const ok = (n, c, d='') => console.log(`  ${c ? 'ok  ' : 'FALHA'} ${n}${d ? ' · ' + d : ''}`);
let falhas = 0;
const chk = (n, c, d='') => { ok(n, c, d); if (!c) falhas++; };

await pg.goto('http://127.0.0.1:4200/', { waitUntil: 'networkidle' });
chk('abre na tela de entrada', await pg.locator('.login-card').isVisible());
chk('mostra a loja', (await pg.locator('.login-card h1').textContent())?.includes('Farias'));

// login errado primeiro
await pg.fill('#u', 'raissa'); await pg.fill('#s', 'errada');
await pg.click('button[type=submit]');
await pg.waitForTimeout(1200);
const msgErro = (await pg.locator('.login-err').textContent() || '').trim();
chk('senha errada mostra erro', await pg.locator('.login-err').isVisible(), msgErro);
chk('e a mensagem fala de senha, não de sessão expirada',
    /senha|usu[áa]rio/i.test(msgErro) && !/expirou/i.test(msgErro), msgErro);

// login certo
await pg.fill('#u', 'raissa'); await pg.fill('#s', 'farias2026');
await pg.click('button[type=submit]');
await pg.waitForURL('**/painel', { timeout: 15000 }).catch(()=>{});
chk('entra no painel', pg.url().includes('painel'), pg.url());
await pg.waitForSelector('.stat-v', { timeout: 15000 });
const clientes = await pg.locator('.stat').first().locator('.stat-v').textContent();
chk('painel traz números da API', /\d/.test(clientes || ''), 'clientes: ' + clientes);
chk('gráfico desenhou', await pg.locator('.chart .line').count() > 0,
    (await pg.locator('.chart .line').count()) + ' barras');

// a rail
chk('rail à esquerda', await pg.locator('nav.rail').isVisible());
const larguraFechada = await pg.locator('nav.rail').evaluate(e => e.getBoundingClientRect().width);
await pg.locator('nav.rail').hover();
await pg.waitForTimeout(400);
const larguraAberta = await pg.locator('nav.rail').evaluate(e => e.getBoundingClientRect().width);
chk('rail expande no hover', larguraAberta > larguraFechada + 80,
    `${Math.round(larguraFechada)}px -> ${Math.round(larguraAberta)}px`);
/* Tira o mouse de cima: a rail aberta cobre o conteúdo e o próximo clique
   bateria nela em vez do botão. É o teste esbarrando em si mesmo. */
await pg.mouse.move(900, 500);
await pg.waitForTimeout(450);

// consulta de placa
await pg.click('a[href*="/placa"]');
/* O Playwright deixa o ponteiro em cima do link clicado, e aí a rail fica
   aberta por hover sobre o conteúdo. Pessoa de verdade move o mouse para o
   campo; o teste precisa fazer o mesmo. */
await pg.mouse.move(900, 500);
await pg.waitForTimeout(600);
await pg.fill('input[name=placa]', 'IUA6376');
/* Enter em vez de clicar no botão: é como o balcão faz — digita a placa e
   aperta Enter — e não depende de onde o ponteiro do robô ficou parado. */
await pg.press('input[name=placa]', 'Enter');
await pg.waitForSelector('.ficha-h', { timeout: 15000 });
chk('consulta de placa responde', await pg.locator('.ficha-h .id').isVisible(),
    await pg.locator('.ficha-h .id').textContent());
const filtros = await pg.locator('.pecas li').count();
chk('mostra os filtros rotulados', filtros >= 3, filtros + ' itens');
const rotulos = await pg.locator('.pecas li .tipo').allTextContents();
chk('cada filtro tem o tipo escrito',
    rotulos.some(r => r.includes('óleo')) && rotulos.some(r => r.includes('ar')),
    rotulos.slice(0,4).join(' | '));

/* ---- o caminho sem consulta paga: placa desconhecida -> digita o modelo ----
   É o que a Farias vai usar todo dia, então vai no e2e com a mesma atenção. */
await pg.goto('http://127.0.0.1:4200/#/placa');
await pg.waitForTimeout(500);
await pg.fill('input[name=placa]', 'ZZZ9Z99');
await pg.press('input[name=placa]', 'Enter');
await pg.waitForSelector('input[name=modelo]', { timeout: 15000 });
chk('placa desconhecida abre o campo de modelo',
    await pg.locator('input[name=modelo]').isVisible());
chk('não pinta a tela de erro',
    await pg.locator('.falha').count() === 0);
const atalhos = await pg.locator('.atalhos button').count();
chk('oferece os modelos mais comuns para clicar', atalhos >= 5, atalhos + ' atalhos');

// autocompletar
await pg.fill('input[name=modelo]', 'corol');
await pg.waitForSelector('.mod-lista button', { timeout: 10000 });
const sug = await pg.locator('.mod-lista .nome').allTextContents();
chk('autocompletar do modelo responde',
    sug.some(x => /corolla/i.test(x)), sug.slice(0,3).join(' | '));

// digitar rápido não pode deixar a lista errada na tela (o switchMap)
await pg.fill('input[name=modelo]', 'go');
await pg.fill('input[name=modelo]', 'gol');
await pg.waitForTimeout(900);
const sug2 = await pg.locator('.mod-lista .nome').allTextContents();
chk('digitando rápido, a lista não volta para a busca antiga',
    sug2.length > 0 && sug2.every(x => /gol/i.test(x)), sug2.slice(0,3).join(' | '));

await pg.fill('input[name=anoModelo]', '2020');
await pg.locator('.mod-lista button').first().click();
await pg.waitForSelector('.ficha-h', { timeout: 15000 });
chk('responde óleo e filtros pelo modelo',
    await pg.locator('.pecas li').count() >= 3,
    (await pg.locator('.pecas li').count()) + ' peças');
chk('mostra a viscosidade em destaque',
    /\d{1,2}W-\d{2}/.test(await pg.locator('.destaque .valor').textContent() || ''),
    await pg.locator('.destaque .valor').textContent());
chk('avisa que ninguém conferiu a placa',
    await pg.locator('.alerta b').first().textContent()
      .then(t => /modelo/i.test(t || '')),
    await pg.locator('.alerta b').first().textContent());
const naCasa = await pg.locator('.na-casa').count();
chk('mostra o que a própria oficina usa', naCasa >= 1, naCasa + ' blocos');
await pg.screenshot({ path: '/tmp/claude-0/-home-claude/4bba41ce-547a-5d18-a48f-bdd8548ce138/scratchpad/tela-por-modelo.png', fullPage: true });

/* Carro sem cadastro não tem ordem de serviço para lançar — o caminho é o
   cadastro, e ele tem que chegar preenchido: o atendente acabou de ver os
   códigos na tela, e mandá-lo redigitar de memória é onde entra a peça errada. */
chk('o botão forte vira "Cadastrar", não "Lançar ordem"',
    /Cadastrar/.test(await pg.locator('.head-act .btn-p').textContent() || ''),
    await pg.locator('.head-act .btn-p').textContent());
await pg.click('.head-act .btn-p');
await pg.waitForURL('**/clientes/novo**', { timeout: 15000 });
await pg.waitForTimeout(1200);
chk('o cadastro chega com a placa', (await pg.inputValue('input[name=placa]')) === 'ZZZ9Z99',
    await pg.inputValue('input[name=placa]'));
chk('e com o modelo', (await pg.inputValue('input[name=modelo]')).length > 1,
    await pg.inputValue('input[name=modelo]'));
chk('e com o ano', (await pg.inputValue('input[name=ano]')) === '2020',
    await pg.inputValue('input[name=ano]'));
const cfo = await pg.inputValue('input[name=fo]').catch(() => '');
chk('e com o código do filtro de óleo já preenchido', cfo.length >= 4, cfo || '(vazio)');

// fila de filtros
await pg.goto('http://127.0.0.1:4200/#/filtros');
await pg.waitForSelector('.panel', { timeout: 25000 });
await pg.waitForTimeout(800);
const cards = await pg.locator('.panel').count();
chk('fila de filtros carrega com sugestão', cards > 1, cards + ' cartões');

// clientes
await pg.goto('http://127.0.0.1:4200/#/clientes');
await pg.waitForSelector('table tbody tr', { timeout: 15000 });
chk('lista de clientes carrega', await pg.locator('table tbody tr').count() > 0,
    (await pg.locator('table tbody tr').count()) + ' linhas');

// a rail navega mesmo, não só existe
await pg.goto('http://127.0.0.1:4200/#/painel');
await pg.waitForSelector('.stat-v', { timeout: 15000 });
await pg.locator('nav.rail').hover();
await pg.waitForTimeout(350);
await pg.locator('nav.rail a[href*="/vencidos"]').click();
await pg.waitForTimeout(2500);
chk('clicar na rail troca de tela', pg.url().includes('vencidos'), pg.url());

await pg.goto('http://127.0.0.1:4200/#/clientes');
await pg.waitForSelector('table tbody tr', { timeout: 15000 });
await pg.screenshot({ path: '/tmp/claude-0/-home-claude/4bba41ce-547a-5d18-a48f-bdd8548ce138/scratchpad/tela-clientes.png' });
await pg.goto('http://127.0.0.1:4200/#/painel'); await pg.waitForTimeout(1500);
await pg.screenshot({ path: '/tmp/claude-0/-home-claude/4bba41ce-547a-5d18-a48f-bdd8548ce138/scratchpad/tela-painel.png' });
await pg.goto('http://127.0.0.1:4200/#/placa'); await pg.waitForTimeout(600);
await pg.fill('input[name=placa]', 'IUA6376');
await pg.press('input[name=placa]', 'Enter');
await pg.waitForSelector('.pecas', { timeout: 15000 });
await pg.screenshot({ path: '/tmp/claude-0/-home-claude/4bba41ce-547a-5d18-a48f-bdd8548ce138/scratchpad/tela-placa.png', fullPage: true });

chk('nenhum erro de JavaScript', erros.length === 0, erros.slice(0,2).join(' / '));
await b.close();
console.log(`\n${falhas === 0 ? 'tudo passou' : falhas + ' falharam'}`);
process.exit(falhas ? 1 : 0);
