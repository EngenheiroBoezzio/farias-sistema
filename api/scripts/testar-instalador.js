/* Instala o sistema DO ZERO e confere o resultado.
 *
 * Existe porque instalação é o único código que ninguém roda duas vezes: se
 * quebrar, quebra na máquina do cliente, na frente dele. Aqui a instalação
 * roda inteira contra um banco novo, com usuário sem DDL, e o script confere
 * o que ficou de pé — tabelas, catálogos, API, tela.
 *
 * Como conversa com o instalador: respondendo ao TEXTO da pergunta, não numa
 * ordem fixa. Jogar as respostas de uma vez no stdin não funciona — o
 * readline descarta o que chega antes de existir uma pergunta esperando — e
 * responder por ordem quebra sozinho no dia em que uma pergunta a mais
 * entrar no meio.
 *
 *   node scripts/testar-instalador.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const DESTINO = process.env.PROVA_DIR || path.join(os.tmpdir(), 'prova-farias');
const BANCO = process.env.PROVA_BANCO || 'prova_farias';
const PORTA = +(process.env.PROVA_PORTA || 3399);

let passou = 0, falhou = 0;
const ok = (nome, cond, det = '') => {
  cond ? passou++ : falhou++;
  console.log(`  ${cond ? 'ok  ' : 'FALHA'} ${nome}${det ? ' · ' + det : ''}`);
  return !!cond;
};

const mysql = (sql, banco) => spawnSync('mariadb',
  ['-uroot', ...(banco ? [banco] : [])],
  { input: sql, encoding: 'utf8' });

/* As respostas, casadas pelo pedaço de texto que aparece na pergunta.
   Cada entrada leva uma LISTA: a mesma pergunta pode voltar (é o caso do
   caminho da planilha, que o instalador repete até receber um arquivo de
   verdade), e aí a próxima resposta da lista é usada. */
const PLANILHA = process.env.PROVA_PLANILHA || 'nao';
/* Um .xlsx que não é um .xlsx: serve para provar que importação quebrada
   avisa e SEGUE, em vez de jogar fora banco, tabelas, .env e catálogos. */
const XLSX_FALSA = path.join(os.tmpdir(), 'nao-e-planilha.xlsx');

const RESPOSTAS = [
  [/Pasta de instala/i,               [DESTINO]],
  [/Atualizar os arquivos por cima/i, ['s']],
  [/Senha do root do banco/i,         ['']],
  [/Nome do banco/i,                  [BANCO]],
  /* No modo "pasta" o teste faz DE PROPÓSITO o que derrubou a instalação de
     verdade: responde o caminho de uma pasta no campo da planilha. O
     instalador tem que recusar e perguntar de novo, não aceitar e estourar
     lá na frente com EISDIR. */
  [/Importar a planilha/i,            [PLANILHA === 'nao' ? 'n' : 's']],
  [/Caminho do arquivo/i,
     PLANILHA === 'pasta'    ? [RAIZ, ''] :
     PLANILHA === 'quebrada' ? [XLSX_FALSA] : ['']],
  [/Tentar assim mesmo/i,             ['s']],
  [/Porta da API/i,                   [String(PORTA)]],
  [/Agendar o backup/i,               ['n']],
  [/Iniciar o sistema junto/i,        ['n']],
  [/Pode instalar\?/i,                ['s']],
  [/Anotou\?/i,                       ['']],
  [/Instalar o MariaDB agora/i,       ['n']],
  [/Abrir o sistema agora/i,          ['n']]
];

/* Pergunta que não está na lista trava a prova para sempre. Em vez de deixar
   o prazo de 10 minutos estourar sem explicação, o script acusa qual foi. */
const SEGUNDOS_SEM_RESPOSTA = 90;

function instalar() {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [path.join(RAIZ, 'scripts', 'instalar.js')], {
      cwd: RAIZ, env: { ...process.env, FORCE_COLOR: '0' }
    });

    let tudo = '', pendente = '';
    const fila = RESPOSTAS.map(([padrao, valores]) => ({ padrao, valores: [...valores] }));

    const olhar = () => {
      /* O prompt não termina em \n — fica na última linha incompleta. */
      for (const item of fila) {
        if (!item.valores.length) continue;
        if (item.padrao.test(pendente)) {
          const valor = item.valores.shift();
          pendente = '';
          p.stdin.write(valor + '\n');
          rearmar();
          return;
        }
      }
    };

    p.stdout.on('data', d => {
      const t = d.toString();
      tudo += t;
      process.stdout.write(t.replace(/^/gm, '  | '));
      pendente += t;
      const corte = pendente.lastIndexOf('\n');
      if (corte >= 0) pendente = pendente.slice(corte + 1);
      olhar();
    });
    p.stderr.on('data', d => { tudo += d.toString(); process.stderr.write(d); });

    /* Relógio que reinicia a cada resposta dada: se ficar muito tempo sem
       responder nada, quase certamente apareceu uma pergunta nova. */
    let travou = null;
    const rearmar = () => {
      clearTimeout(travou);
      travou = setTimeout(() => {
        p.kill();
        const ultima = tudo.trimEnd().split('\n').slice(-3).join(' | ');
        resolve({ codigo: -1, tudo, estourou: true, semResposta: ultima });
      }, SEGUNDOS_SEM_RESPOSTA * 1000);
    };
    rearmar();

    p.on('close', codigo => { clearTimeout(travou); clearTimeout(prazo); resolve({ codigo, tudo }); });
    const prazo = setTimeout(() => { p.kill(); resolve({ codigo: -1, tudo, estourou: true }); },
                             10 * 60 * 1000);
  });
}

(async () => {
  console.log('\n=== instalação do zero ===\n');
  console.log(`  destino: ${DESTINO}`);
  console.log(`  banco  : ${BANCO} (será apagado e recriado)\n`);

  /* terreno limpo: nada de reaproveitar sobra de uma rodada anterior */
  fs.rmSync(DESTINO, { recursive: true, force: true });
  if (PLANILHA === 'quebrada')
    fs.writeFileSync(XLSX_FALSA, 'isto nao e uma planilha, e texto puro\n');
  mysql(`DROP DATABASE IF EXISTS \`${BANCO}\`;
         DROP DATABASE IF EXISTS \`${BANCO}_verifica\`;
         DROP USER IF EXISTS '${BANCO}'@'localhost';
         DROP USER IF EXISTS '${BANCO}_backup'@'localhost';`);

  console.log('  --- saída do instalador ---');
  const r = await instalar();
  console.log('  --- fim da saída ---\n');

  if (!ok('o instalador terminou sem erro', r.codigo === 0,
          r.semResposta ? `travou numa pergunta não prevista: ${r.semResposta}`
                        : r.estourou ? 'estourou o prazo' : `código ${r.codigo}`)) {
    return fim();
  }

  /* ---------- a pasta no lugar da planilha ---------- */
  if (PLANILHA === 'pasta') {
    console.log('\n  --- caminho de planilha errado ---');
    ok('recusa uma pasta no lugar do arquivo',
       /isso é uma pasta/i.test(r.tudo));
    ok('não engole dizendo "arquivo encontrado"',
       !/\[ok\] arquivo encontrado/i.test(r.tudo));
    ok('não tenta ler a pasta como planilha (EISDIR)',
       !/EISDIR/i.test(r.tudo));
    ok('e a instalação termina assim mesmo', r.codigo === 0);
  }

  /* ---------- importação que quebra ---------- */
  if (PLANILHA === 'quebrada') {
    console.log('\n  --- planilha ilegível ---');
    ok('avisa que a importação falhou', /importação falhou/i.test(r.tudo));
    ok('mas NÃO joga fora a instalação', r.codigo === 0);
    ok('e diz como importar depois', /migrar\.js/.test(r.tudo));
    ok('os catálogos entraram mesmo sem a planilha',
       /filtros Wega/i.test(r.tudo) || /2519/.test(r.tudo));
  }

  /* ---------- o que ficou no disco ---------- */
  console.log('\n  --- arquivos ---');
  ok('.env foi gerado', fs.existsSync(path.join(DESTINO, '.env')));
  const env = fs.readFileSync(path.join(DESTINO, '.env'), 'utf8');
  ok('com JWT_SECRET longo o bastante',
     (env.match(/JWT_SECRET=(\S+)/)?.[1] || '').length >= 32);
  ok('com senha do banco sorteada, não fixa',
     !/DB_PASSWORD=\s*$/m.test(env) && !/DB_PASSWORD=(farias|123|senha)/i.test(env));
  ok('sem consulta de placa paga ligada', /^PLACA_API_URL=\s*$/m.test(env));
  ok('a tela veio junto', fs.existsSync(path.join(DESTINO, 'publico', 'index.html')));

  const cfg = JSON.parse(fs.readFileSync(path.join(DESTINO, 'publico', 'config.json'), 'utf8'));
  ok('a tela aponta para a mesma origem', cfg.apiUrl === 'mesma-origem', cfg.apiUrl);

  /* ---------- o que ficou no banco ---------- */
  console.log('\n  --- banco ---');
  const tabelas = mysql('SHOW TABLES;', BANCO).stdout || '';
  for (const t of ['clientes', 'veiculos', 'servicos', 'usuarios',
                   'catalogo_oleo', 'catalogo_filtro', 'cache_placa'])
    ok(`tabela ${t}`, tabelas.includes(t));

  /* placa.sql é o que o instalador esquecia de aplicar: sem ele a instalação
     sobe e só quebra na primeira consulta de placa. Fica conferido coluna a
     coluna, não por "o arquivo rodou". */
  const colCache = mysql('SHOW COLUMNS FROM cache_placa;', BANCO).stdout || '';
  for (const c of ['fipe_codigo', 'fipe_modelo', 'fipe_valor', 'logo_marca'])
    ok(`cache_placa.${c} (vem do placa.sql)`, colCache.includes(c));
  const colVeic = mysql('SHOW COLUMNS FROM veiculos;', BANCO).stdout || '';
  for (const c of ['versao', 'fipe_codigo', 'combustivel'])
    ok(`veiculos.${c} (vem do placa.sql)`, colVeic.includes(c));

  const conta = sql => parseInt((mysql(sql, BANCO).stdout || '').split('\n')[1] || '0', 10);
  ok('catálogo Wega carregado', conta('SELECT COUNT(*) FROM catalogo_filtro;') > 2000,
     `${conta('SELECT COUNT(*) FROM catalogo_filtro;')} linhas`);
  ok('catálogo de óleo carregado', conta('SELECT COUNT(*) FROM catalogo_oleo;') > 300,
     `${conta('SELECT COUNT(*) FROM catalogo_oleo;')} linhas`);
  ok('usuários criados', conta('SELECT COUNT(*) FROM usuarios;') > 0);

  /* O usuário da API não pode ter poder de mexer na estrutura. */
  const grants = mysql(`SHOW GRANTS FOR '${BANCO}'@'localhost';`).stdout || '';
  ok('a API não recebeu permissão de DROP/ALTER/CREATE',
     !/\b(DROP|ALTER|CREATE|ALL PRIVILEGES)\b/.test(grants.replace(/GRANT USAGE[^\n]*/g, '')),
     grants.split('\n')[1]?.slice(0, 80));

  /* ---------- o sistema de pé ---------- */
  console.log('\n  --- no ar ---');
  /* O instalador sobe a API para conferir e pode deixá-la de pé. Se a porta
     já estiver ocupada, a instância nova morre calada e a prova passa a
     medir a instância VELHA — inclusive o limitador de login já gasto pelo
     pentest que o instalador roda. Derruba antes. */
  try {
    const viva = await fetch(`http://127.0.0.1:${PORTA}/health`).then(() => true).catch(() => false);
    if (viva) {
      spawnSync('pkill', ['-f', `servidor.js`], { encoding: 'utf8' });
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch { /* porta livre */ }

  const api = spawn(process.execPath, [path.join(DESTINO, 'src', 'servidor.js')], {
    cwd: os.tmpdir(),          // de propósito: o serviço do Windows começa fora da pasta
    env: { ...process.env, PORT: String(PORTA) },
    detached: true, stdio: 'ignore'
  });
  await new Promise(r => setTimeout(r, 5000));

  try {
    const saude = await fetch(`http://127.0.0.1:${PORTA}/health`).then(r => r.json());
    ok('a API sobe mesmo iniciada de outra pasta', saude.ok === true);
  } catch (e) {
    ok('a API sobe mesmo iniciada de outra pasta', false, e.message);
  }

  try {
    const r2 = await fetch(`http://127.0.0.1:${PORTA}/`);
    const html = await r2.text();
    ok('a mesma porta entrega a tela', r2.status === 200 && /<app-root/.test(html));
    ok('com política de segurança de conteúdo',
       /script-src 'self'/.test(r2.headers.get('content-security-policy') || ''));
  } catch (e) {
    ok('a mesma porta entrega a tela', false, e.message);
    ok('com política de segurança de conteúdo', false);
  }

  /* Uma instalação nova não tem histórico nenhum. A consulta por modelo tem
     que responder assim mesmo, pelo catálogo — é o caminho do dia a dia. */
  try {
    const senha = senhaDoSeed(r.tudo);
    const resp = await fetch(`http://127.0.0.1:${PORTA}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usuario: 'raissa', senha })
    });
    const entrar = await resp.json().catch(() => ({}));
    /* O detalhe importa: 401 é senha errada (problema do seed ou da leitura
       da senha), 429 é o limitador ainda quente do pentest que o próprio
       instalador roda. São dois defeitos diferentes e a mensagem tem que
       separar, senão a próxima pessoa persegue o errado. */
    if (ok('dá para entrar com a senha que o instalador sorteou', !!entrar.token,
           entrar.token ? '' :
           `HTTP ${resp.status} · senha lida: ${senha ? senha.slice(0,4) + '…' : '(não achei)'}` +
           (resp.status === 429 ? ' · limitador ainda quente do pentest' : ''))) {
      const h = { authorization: 'Bearer ' + entrar.token };
      const pm = await fetch(
        `http://127.0.0.1:${PORTA}/api/placa/por-modelo?modelo=Gol&ano=2020`,
        { headers: h }).then(x => x.json());
      ok('consulta por modelo responde numa base vazia',
         (pm.filtros?.itens || []).length === 4,
         (pm.filtros?.itens || []).map(i => i.codigo).join(' '));
      const desconhecida = await fetch(`http://127.0.0.1:${PORTA}/api/placa/ZZZ9Z99`,
                                       { headers: h });
      const jd = await desconhecida.json();
      ok('placa desconhecida pede o modelo em vez de dar erro',
         desconhecida.status === 200 && jd.precisa_modelo === true);
    }
  } catch (e) {
    ok('dá para entrar com a senha que o instalador sorteou', false, e.message);
  }


  try { process.kill(-api.pid); } catch { try { api.kill(); } catch {} }
  fim();
})().catch(e => { console.error('\nerro na prova:', e.message); process.exit(1); });

/** A senha do admin sai UMA vez, na saída do instalador. */
function senhaDoSeed(saida) {
  const m = saida.match(/raissa\s*[|:]?\s*(\S{8,})/i) ||
            saida.match(/senha[^\n]*?:\s*(\S{8,})/i);
  return m ? m[1].replace(/[|]/g, '').trim() : 'farias2026';
}

function fim() {
  console.log(`\n${passou} passaram · ${falhou} falharam\n`);
  process.exit(falhou ? 1 : 0);
}
