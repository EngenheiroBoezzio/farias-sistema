/* Instalador do sistema da Farias.
 *
 * Roda pelo INSTALAR.bat. Faz perguntas, mostra o que vai fazer, e confere
 * cada passo antes de seguir para o próximo.
 *
 * Regras que segui aqui:
 *  - nada é feito em silêncio: cada passo diz o que fez e o que achou;
 *  - toda senha é gerada, não inventada pelo instalador com valor fixo;
 *  - o que falhar PARA a instalação, em vez de deixar meio pronto;
 *  - rodar de novo é seguro: detecta o que já existe e não duplica.
 *
 *   node scripts/instalar.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { execFileSync, execSync, spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const WIN = process.platform === 'win32';

/* ---------- conversa com o usuário ---------- */
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const perguntar = q => new Promise(r => rl.question(q, v => r(v.trim())));

const C = {
  ok: t => `  [ok] ${t}`,
  erro: t => `  [X]  ${t}`,
  aviso: t => `  [!]  ${t}`,
  passo: t => `\n  ${t}\n  ${'-'.repeat(Math.min(58, t.length + 4))}`
};

async function pergunte(texto, padrao) {
  const sufixo = padrao ? ` [${padrao}]` : '';
  const v = await perguntar(`  ${texto}${sufixo}: `);
  return v || padrao || '';
}

async function confirme(texto, padraoSim = true) {
  const v = (await perguntar(`  ${texto} ${padraoSim ? '[S/n]' : '[s/N]'}: `)).toLowerCase();
  if (!v) return padraoSim;
  return v === 's' || v === 'sim' || v === 'y';
}

class Parar extends Error {}
const pare = (msg, dica) => { const e = new Parar(msg); e.dica = dica; throw e; };

/* O que já foi GRAVADO na máquina. Parar no meio e dizer "nada ficou pela
   metade" é mentira quando o banco já existe — e mentira num instalador faz
   a pessoa procurar problema no lugar errado, ou instalar por cima achando
   que está começando do zero. */
const gravado = [];
const jaFiz = t => { gravado.push(t); };

/* ---------- utilidades ---------- */
const senhaForte = () => crypto.randomBytes(18).toString('base64')
  .replace(/[+/=]/g, '').slice(0, 20);

/* Com shell:true, o Node manda passar o comando INTEIRO numa string — lista
   de argumentos separada dispara o aviso DEP0190 e, pior, aparece no meio da
   pergunta que está na tela, fazendo parecer que o instalador quebrou.
   Aspas em volta do caminho porque no Windows ele tem espaço quase sempre. */
const versaoDe = exe => spawnSync(`"${exe}" --version`,
  { encoding: 'utf8', shell: true, windowsHide: true });

/** O winget existe a partir do Windows 10 1809. Sem ele, instalação manual. */
function temWinget() {
  return versaoDe('winget').status === 0;
}

function acharMysql() {
  // no PATH primeiro
  for (const nome of ['mariadb', 'mysql']) {
    const r = WIN ? versaoDe(nome)
                  : spawnSync(nome, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return nome;
  }
  // instalações típicas do Windows
  if (WIN) {
    const bases = ['C:\\Program Files\\MariaDB', 'C:\\Program Files (x86)\\MariaDB',
                   'C:\\Program Files\\MySQL', 'C:\\xampp\\mysql'];
    for (const base of bases) {
      if (!fs.existsSync(base)) continue;
      for (const d of fs.readdirSync(base)) {
        for (const exe of ['mariadb.exe', 'mysql.exe']) {
          const p = path.join(base, d, 'bin', exe);
          if (fs.existsSync(p)) return p;
          const p2 = path.join(base, 'bin', exe);
          if (fs.existsSync(p2)) return p2;
        }
      }
    }
  }
  return null;
}

/** Roda SQL como root. Devolve a saída ou lança. */
function sql(cliente, texto, { usuario = 'root', senha = '', banco = null } = {}) {
  const args = [`-u${usuario}`];
  if (senha) args.push(`-p${senha}`);
  if (banco) args.push(banco);
  const r = spawnSync(cliente, args, { input: texto, encoding: 'utf8', shell: false });
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || '').split('\n').filter(Boolean).slice(-2).join(' ');
    const e = new Error(msg || 'comando SQL falhou');
    e.saida = msg;
    throw e;
  }
  return r.stdout || '';
}

/* O `cwd` tem que ser a pasta de DESTINO, não a de origem: estes scripts leem
   o .env da pasta onde rodam, e rodando da origem eles gravariam no banco da
   instalação antiga — apagando dados de produção sem ninguém perceber. */
function rodarNode(cwd, script, args = [], env = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, ...env }
  });
  return { ok: r.status === 0, saida: (r.stdout || '') + (r.stderr || '') };
}

/* =========================================================== */
(async () => {
  console.log('  Vou instalar o sistema nesta máquina.');
  console.log('  Nada é gravado antes de você confirmar no fim.\n');

  /* ---------- 1. onde instalar ---------- */
  console.log(C.passo('1. Onde o sistema vai ficar'));
  const padraoDestino = WIN ? 'C:\\farias' : '/opt/farias-api';
  let destino = await pergunte('Pasta de instalação', padraoDestino);
  destino = path.resolve(destino);

  const jaTem = fs.existsSync(path.join(destino, 'src', 'servidor.js'));
  if (jaTem) {
    console.log(C.aviso(`Já existe uma instalação em ${destino}.`));
    if (!await confirme('Atualizar os arquivos por cima? (os dados do banco ficam)', true))
      pare('Instalação cancelada por você.');
  }

  /* ---------- 2. o banco ---------- */
  console.log(C.passo('2. Banco de dados'));
  let cliente = acharMysql();

  /* Sem banco não há sistema. Em vez de mandar o Pedro sair, baixar e voltar,
     o instalador se oferece para instalar — mas PERGUNTANDO: instalar
     programa na máquina de alguém sem avisar não se faz. */
  if (!cliente && WIN && temWinget()) {
    console.log(C.aviso('o MariaDB não está instalado nesta máquina.'));
    if (await confirme('Instalar o MariaDB agora? (leva alguns minutos)', true)) {
      console.log('    baixando e instalando, aguarde…');
      try {
        execSync('winget install --id MariaDB.Server -e --silent ' +
                 '--accept-source-agreements --accept-package-agreements',
                 { stdio: 'inherit', shell: true });
      } catch {
        console.log(C.aviso('o winget não terminou bem. Vou conferir assim mesmo.'));
      }
      cliente = acharMysql();
      if (cliente) console.log(C.ok('MariaDB instalado'));
    }
  }

  if (!cliente) {
    pare('Não achei o MariaDB nesta máquina.',
         'Instale o MariaDB (https://mariadb.org/download) e rode este instalador de novo.\n' +
         '       Se já estiver instalado, abra o instalador de novo por um Prompt onde\n' +
         '       o comando "mariadb --version" funcione.');
  }
  console.log(C.ok(`cliente do banco: ${cliente}`));

  const senhaRoot = await pergunte('Senha do root do banco (em branco se não tiver)', '');
  try {
    sql(cliente, 'SELECT 1;', { senha: senhaRoot });
    console.log(C.ok('consegui entrar como root'));
  } catch (e) {
    pare(`Não consegui entrar no banco como root: ${e.message}`,
         'Confira se o serviço do MariaDB está rodando e se a senha está certa.');
  }

  const nomeBanco = await pergunte('Nome do banco', 'farias');

  /* senhas geradas: senha escolhida por instalador vira senha padrão do mundo */
  const senhaApp = senhaForte();
  const senhaBkp = senhaForte();

  /* ---------- 3. a planilha ---------- */
  console.log(C.passo('3. Dados da planilha'));
  let planilha = '';
  if (await confirme('Importar a planilha de clientes agora?', true)) {
    console.log('    (deixe em branco e dê Enter para importar depois)');
    for (;;) {
      planilha = await pergunte('Caminho do arquivo .xlsx', '');
      if (!planilha) { console.log(C.aviso('vou pular a importação')); break; }
      planilha = planilha.replace(/^"|"$/g, '').trim();

      /* "existe" não basta: pasta existe. Conferir só isso deixava o
         instalador dizer "arquivo encontrado" para uma pasta e ir tentar ler
         ela como planilha, que estoura lá na frente com EISDIR. */
      if (!fs.existsSync(planilha)) {
        console.log(C.erro('não achei esse caminho. Arraste o arquivo para esta janela e dê Enter.'));
        continue;
      }
      if (fs.statSync(planilha).isDirectory()) {
        console.log(C.erro('isso é uma pasta, não a planilha.'));
        console.log('       Preciso do arquivo em si, terminado em .xlsx.');
        const xlsx = fs.readdirSync(planilha).filter(f => /\.xlsx?$/i.test(f));
        if (xlsx.length) {
          console.log('       Dentro dessa pasta eu vejo:');
          for (const f of xlsx.slice(0, 5)) console.log(`         ${path.join(planilha, f)}`);
        }
        continue;
      }
      if (!/\.xlsx?$/i.test(planilha)) {
        console.log(C.erro('esse arquivo não termina em .xlsx.'));
        if (!await confirme('Tentar assim mesmo?', false)) continue;
      }
      console.log(C.ok(`planilha: ${path.basename(planilha)}`));
      break;
    }
  }

  /* ---------- 4. rede ---------- */
  console.log(C.passo('4. Rede'));
  const porta = await pergunte('Porta da API', '3001');

  const ips = Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  if (ips.length) {
    console.log(C.ok(`endereço desta máquina na rede: ${ips.join(', ')}`));
    console.log(`       Os outros computadores vão apontar para http://${ips[0]}:${porta}`);
  }

  /* ---------- 5. automações ---------- */
  console.log(C.passo('5. Automação'));
  const comBackup = await confirme('Agendar o backup automático?', true);
  const comBoot = await confirme('Iniciar o sistema junto com o Windows?', WIN);

  /* ---------- resumo ---------- */
  console.log(C.passo('Resumo — confira antes de eu gravar'));
  console.log(`    pasta      : ${destino}`);
  console.log(`    banco      : ${nomeBanco}`);
  console.log(`    usuários   : ${nomeBanco} (API, sem poder alterar estrutura)`);
  console.log(`                 ${nomeBanco}_backup (só leitura)`);
  console.log(`    senhas     : geradas agora, vão para o .env`);
  console.log(`    porta      : ${porta}`);
  console.log(`    planilha   : ${planilha || '(não importar)'}`);
  console.log(`    backup     : ${comBackup ? 'agendado' : 'não'}`);
  console.log(`    no boot    : ${comBoot ? 'sim' : 'não'}`);
  console.log();
  if (!await confirme('Pode instalar?', true)) pare('Instalação cancelada por você.');

  /* =============== daqui para baixo, grava =============== */

  /* copiar arquivos */
  console.log(C.passo('Copiando arquivos'));
  if (path.resolve(RAIZ) !== destino) {
    fs.mkdirSync(destino, { recursive: true });
    const pular = new Set(['node_modules', 'backups', 'logs', '.git', 'instalador', '.env']);
    const copiar = (de, para) => {
      for (const item of fs.readdirSync(de)) {
        if (pular.has(item)) continue;
        const o = path.join(de, item), d = path.join(para, item);
        const st = fs.statSync(o);
        if (st.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copiar(o, d); }
        else fs.copyFileSync(o, d);
      }
    };
    copiar(RAIZ, destino);
    console.log(C.ok(`arquivos em ${destino}`));
    jaFiz(`arquivos copiados para ${destino}`);
  } else {
    console.log(C.ok('já está na pasta final'));
  }
  fs.mkdirSync(path.join(destino, 'backups'), { recursive: true });
  fs.mkdirSync(path.join(destino, 'logs'), { recursive: true });

  /* dependências */
  console.log(C.passo('Instalando dependências'));
  try {
    execSync('npm install --omit=dev --no-audit --no-fund', {
      cwd: destino, stdio: 'inherit', shell: true
    });
    console.log(C.ok('pacotes instalados'));
  } catch {
    pare('npm install falhou.',
         'Quase sempre é falta de internet. Confira a conexão e rode de novo.');
  }

  /* banco + usuários */
  console.log(C.passo('Criando banco e usuários'));
  const esc = s => String(s).replace(/'/g, "''");
  sql(cliente, `
    CREATE DATABASE IF NOT EXISTS \`${nomeBanco}\`
      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    CREATE USER IF NOT EXISTS '${nomeBanco}'@'localhost' IDENTIFIED BY '${esc(senhaApp)}';
    ALTER USER '${nomeBanco}'@'localhost' IDENTIFIED BY '${esc(senhaApp)}';
    GRANT SELECT, INSERT, UPDATE, DELETE ON \`${nomeBanco}\`.* TO '${nomeBanco}'@'localhost';
    CREATE USER IF NOT EXISTS '${nomeBanco}_backup'@'localhost' IDENTIFIED BY '${esc(senhaBkp)}';
    ALTER USER '${nomeBanco}_backup'@'localhost' IDENTIFIED BY '${esc(senhaBkp)}';
    GRANT SELECT, LOCK TABLES, SHOW VIEW, EVENT, TRIGGER ON \`${nomeBanco}\`.*
      TO '${nomeBanco}_backup'@'localhost';
    GRANT ALL PRIVILEGES ON \`${nomeBanco}_verifica\`.* TO '${nomeBanco}_backup'@'localhost';
    FLUSH PRIVILEGES;
  `, { senha: senhaRoot });
  console.log(C.ok(`banco "${nomeBanco}" e os dois usuários prontos`));
  jaFiz(`banco "${nomeBanco}" criado, com os usuários ${nomeBanco} e ${nomeBanco}_backup`);
  console.log(C.ok('a API NÃO recebe permissão de alterar estrutura — é de propósito'));

  /* tabelas */
  console.log(C.passo('Criando as tabelas'));
  /* A ordem importa e placa.sql NÃO pode faltar: é ele que cria as colunas de
     versão/FIPE em cache_placa e em veiculos. Sem ele a instalação sobe e só
     quebra depois, na primeira consulta de placa — erro que não aparece em
     base já migrada, só em instalação limpa. */
  for (const arq of ['schema.sql', 'valores.sql', 'wega.sql', 'placa.sql']) {
    const caminho = path.join(destino, 'sql', arq);
    /* Antes isto era um aviso e a instalação seguia. Seguir sem uma dessas
       tabelas entrega um sistema que só falha na frente do cliente. */
    if (!fs.existsSync(caminho))
      pare(`${arq} não veio no pacote.`,
           'O pacote está incompleto. Baixe de novo e rode outra vez.');
    try {
      sql(cliente, fs.readFileSync(caminho, 'utf8'), { senha: senhaRoot, banco: nomeBanco });
      console.log(C.ok(arq));
    } catch (e) {
      pare(`Falhou ao aplicar ${arq}: ${e.message}`);
    }
  }
  jaFiz('tabelas criadas');

  /* .env */
  console.log(C.passo('Gravando a configuração'));
  const jwt = crypto.randomBytes(48).toString('hex');
  const env = [
    '# Gerado pelo instalador em ' + new Date().toLocaleString('pt-BR'),
    '# As senhas abaixo foram sorteadas nesta máquina. Não reaproveite em outro lugar.',
    '',
    `PORT=${porta}`,
    'NODE_ENV=producao',
    '',
    'DB_HOST=127.0.0.1',
    'DB_PORT=3306',
    `DB_USER=${nomeBanco}`,
    `DB_PASSWORD=${senhaApp}`,
    `DB_NAME=${nomeBanco}`,
    'DB_POOL=10',
    '',
    '# Trocar este valor derruba todas as sessões abertas.',
    `JWT_SECRET=${jwt}`,
    'SESSAO_TTL=3d',
    '',
    `CORS_ORIGENS=http://localhost:4200${ips.length ? ',http://' + ips[0] + ':4200' : ''}`,
    '',
    `BACKUP_DB_USER=${nomeBanco}_backup`,
    `BACKUP_DB_PASSWORD=${senhaBkp}`,
    'BACKUP_DIR=./backups',
    '',
    '# Consulta de placa por API externa: OPCIONAL, e por padrão DESLIGADA.',
    '# Os serviços que devolvem motorização pedem CNPJ. Sem isso preenchido o',
    '# sistema resolve pelo cadastro, pelo catálogo Wega e pelo histórico da',
    '# própria oficina: placa desconhecida abre um campo pedindo o modelo e a',
    '# resposta sai igual, de graça e sem internet. Veja o item 10a do',
    '# INSTALACAO.md.',
    'PLACA_API_URL=',
    'PLACA_API_TOKEN=',
    'PLACA_TIMEOUT_MS=8000',
    ''
  ].join('\n');
  const arqEnv = path.join(destino, '.env');
  fs.writeFileSync(arqEnv, env, 'utf8');
  try { fs.chmodSync(arqEnv, 0o600); } catch {}
  console.log(C.ok('.env gravado com senhas novas'));
  jaFiz(`configuração gravada em ${path.join(destino, '.env')}`);

  /* planilha
     Falhar aqui NÃO derruba a instalação, e isso é decisão consciente: o
     sistema funciona com a base vazia — a consulta por modelo responde óleo e
     filtro pelo catálogo desde o primeiro dia. Jogar fora banco, tabelas,
     .env e catálogos porque um caminho de arquivo estava errado seria perder
     tudo pelo passo mais fácil de refazer depois. */
  let planilhaOk = false;
  if (planilha) {
    console.log(C.passo('Importando a planilha'));
    const r = rodarNode(destino, path.join(destino, 'scripts', 'migrar.js'), [planilha]);
    console.log(r.saida.split('\n').filter(Boolean).slice(-8).map(l => '       ' + l).join('\n'));
    if (r.ok) {
      planilhaOk = true;
      console.log(C.ok('planilha importada'));
      const s = rodarNode(destino, path.join(destino, 'scripts', 'separar-valor-codigo.js'), ['--aplicar']);
      if (s.ok) console.log(C.ok('preço e código de peça separados'));
      else console.log(C.aviso('não consegui separar preço de código; dá para rodar depois'));
    } else {
      console.log(C.aviso('a importação falhou — SIGO com a base vazia.'));
      console.log('       O sistema funciona assim: a consulta por modelo já');
      console.log('       responde óleo e filtro pelo catálogo.');
      console.log('       Para importar depois, com o arquivo certo em mãos:');
      console.log(`         cd "${destino}"`);
      console.log('         node scripts/migrar.js "C:\\caminho\\da\\planilha.xlsx"');
      console.log('         node scripts/separar-valor-codigo.js --aplicar');
    }
  }

  /* catálogos */
  console.log(C.passo('Carregando os catálogos'));
  for (const [script, nome] of [['carregar-catalogo.js', 'óleo'], ['carregar-wega.js', 'filtros Wega']]) {
    const r = rodarNode(destino, path.join(destino, 'scripts', script));
    if (r.ok) {
      const linha = r.saida.split('\n').find(l => /carregado|entradas/i.test(l)) || '';
      console.log(C.ok(`catálogo de ${nome} ${linha.trim()}`));
    } else {
      console.log(C.aviso(`catálogo de ${nome} não carregou — rode "node scripts/${script}" depois`));
    }
  }

  /* usuários do sistema */
  console.log(C.passo('Criando os usuários do sistema'));
  const seed = rodarNode(destino, path.join(destino, 'scripts', 'seed.js'));
  console.log(seed.saida.split('\n').filter(Boolean).map(l => '       ' + l).join('\n'));

  /* Guarda a conta de admin para conferir a instalação logo abaixo. As senhas
     são sorteadas, então os testes NÃO funcionam com a senha de exemplo — e
     mandar o usuário rodar um comando que falha é pior que não mandar nada. */
  let admin = null;
  for (const l of seed.saida.split('\n')) {
    const m = l.match(/^\s*(\S+)\s+(\S+)\s+\((admin|atendente)\)\s*$/);
    if (m && m[3] === 'admin') { admin = { usuario: m[1], senha: m[2] }; break; }
  }

  if (seed.ok) {
    console.log(C.aviso('ANOTE AS SENHAS ACIMA AGORA. Elas não são mostradas de novo.'));
    await perguntar('\n  Anotou? Dê Enter para continuar. ');
  }

  /* backup agendado */
  if (comBackup) {
    console.log(C.passo('Agendando o backup'));
    if (WIN) {
      const node = process.execPath;
      const tarefas = [
        ['FariasBackupHorario', 'HOURLY', '1', 'backup.js horario'],
        ['FariasBackupDiario',  'DAILY',  '12:30', 'backup.js diario'],
        ['FariasVigiaBackup',   'DAILY',  '19:15', 'vigia-backup.js']
      ];
      let feitas = 0;
      for (const [nome, freq, quando, cmd] of tarefas) {
        const [arq, ...extra] = cmd.split(' ');
        const linha = `cmd /c cd /d "${destino}" && "${node}" scripts\\${arq} ${extra.join(' ')} >> logs\\backup.log 2>&1`;
        const args = ['/Create', '/F', '/TN', nome, '/TR', linha, '/SC', freq];
        if (freq === 'DAILY') args.push('/ST', quando);
        else args.push('/MO', quando);
        const r = spawnSync('schtasks', args, { encoding: 'utf8' });
        if (r.status === 0) feitas++;
        else console.log(C.aviso(`${nome}: ${(r.stderr || '').trim().split('\n')[0]}`));
      }
      if (feitas === 3) console.log(C.ok('três tarefas agendadas (horário, diário 12h30, vigia 19h15)'));
      else if (feitas) console.log(C.aviso(`${feitas} de 3 agendadas — reveja no Agendador de Tarefas`));
      else console.log(C.aviso('não consegui agendar. Rode o instalador como administrador.'));
    } else {
      console.log(C.aviso('no Linux, use o scripts/crontab.txt (instruções no INSTALACAO.md)'));
    }
  }

  /* iniciar com o Windows */
  if (comBoot && WIN) {
    console.log(C.passo('Configurando a inicialização'));
    const linha = `cmd /c cd /d "${destino}" && "${process.execPath}" src\\servidor.js >> logs\\api.log 2>&1`;
    const r = spawnSync('schtasks',
      ['/Create', '/F', '/TN', 'FariasAPI', '/TR', linha, '/SC', 'ONSTART', '/RL', 'HIGHEST'],
      { encoding: 'utf8' });
    if (r.status === 0) {
      console.log(C.ok('o sistema sobe junto com o Windows'));
    } else {
      // sem admin: atalho na pasta Inicializar resolve para o usuário atual
      try {
        const inic = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft',
                               'Windows', 'Start Menu', 'Programs', 'Startup');
        fs.mkdirSync(inic, { recursive: true });
        fs.writeFileSync(path.join(inic, 'Farias API.bat'),
          `@echo off\r\ncd /d "${destino}"\r\nstart "" /min "${process.execPath}" src\\servidor.js\r\n`,
          'utf8');
        console.log(C.ok('atalho criado na pasta Inicializar (sobe ao entrar no Windows)'));
      } catch {
        console.log(C.aviso('não consegui configurar o início automático. Faça manualmente.'));
      }
    }
  }

  /* subir e conferir */
  console.log(C.passo('Subindo o sistema para conferir'));
  const { spawn } = require('child_process');
  const api = spawn(process.execPath, ['src/servidor.js'], {
    cwd: destino, detached: true, stdio: 'ignore',
    env: { ...process.env }
  });
  api.unref();
  await new Promise(r => setTimeout(r, 4000));

  let saude = null;
  try {
    const r = await fetch(`http://127.0.0.1:${porta}/health`);
    saude = await r.json();
  } catch { /* trata abaixo */ }

  if (saude?.ok) {
    console.log(C.ok(`a API respondeu na porta ${porta} (banco em ${saude.banco_ms} ms)`));

    if (admin) {
      console.log(C.passo('Conferindo a instalação'));
      const env = { TESTE_USUARIO: admin.usuario, TESTE_SENHA: admin.senha };
      /* O pentest termina disparando força bruta no login de propósito, e
         isso deixa o limitador travado por 15 minutos. Ele vai POR ÚLTIMO,
         senão derruba o teste seguinte e a falha parece do sistema. */
      for (const [arq, nome] of [['teste-wega.js', 'catálogo de filtros'],
                                 ['teste-modelo.js', 'consulta por modelo'],
                                 ['pentest.js', 'segurança']]) {
        const r = rodarNode(destino, path.join(destino, 'scripts', arq),
                            [`http://127.0.0.1:${porta}`], env);
        const linha = (r.saida.split('\n').find(l => /passaram/.test(l)) || '').trim();
        if (r.ok) { console.log(C.ok(`${nome}: ${linha}`)); continue; }

        console.log(C.aviso(`${nome}: ${linha || 'não passou'}`));
        const falhas = r.saida.split('\n').filter(l => /FALHA/.test(l));
        if (falhas.length) {
          for (const l of falhas.slice(0, 3)) console.log(`         ${l.trim()}`);
        } else {
          /* Sem linha de FALHA o teste quebrou antes de reportar. Engolir isso
             transforma a conferência em caixa-preta: mostra a saída crua. */
          const cru = r.saida.split('\n').filter(Boolean).slice(-4);
          for (const l of cru) console.log(`         ${l.trim()}`);
        }
      }
    }
  } else {
    console.log(C.erro('a API não respondeu.'));
    console.log(`       Veja ${path.join(destino, 'logs', 'api.log')} para saber por quê.`);
  }

  /* ---------- a tela ----------
     O front compilado veio dentro do pacote, em publico/, e a API já o
     entrega na mesma porta. Então o config dele diz "mesma-origem": o balcão
     abre o navegador no endereço da máquina e acabou. Sem endereço de API
     para digitar em cada computador, que é onde uma instalação costuma
     emperrar, e sem CORS, porque é tudo a mesma origem. */
  const publico = path.join(destino, 'publico');
  const temTela = fs.existsSync(path.join(publico, 'index.html'));
  if (temTela) {
    console.log(C.passo('Configurando a tela'));
    const cfg = path.join(publico, 'config.json');
    let atual = {};
    try { atual = JSON.parse(fs.readFileSync(cfg, 'utf8')); } catch { /* recria */ }
    fs.writeFileSync(cfg, JSON.stringify({
      ...atual,
      apiUrl: 'mesma-origem',
      nomeLoja: atual.nomeLoja || 'Farias Troca de Óleo',
      canalWhatsapp: atual.canalWhatsapp || ''
    }, null, 2), 'utf8');
    console.log(C.ok('a tela fala com esta mesma máquina, sem endereço para configurar'));
  } else {
    console.log(C.aviso('pacote sem a pasta publico/ — a API sobe, mas sem tela.'));
  }

  /* Para quem for usar o aplicativo Electron em vez do navegador: aí sim há
     um endereço a apontar, e ele fica pronto neste arquivo. */
  const cfgApp = {
    apiUrl: `http://${ips[0] || 'localhost'}:${porta}`,
    nomeLoja: 'Farias Troca de Óleo',
    canalWhatsapp: ''
  };
  fs.writeFileSync(path.join(destino, 'config-do-aplicativo.json'),
    JSON.stringify(cfgApp, null, 2), 'utf8');

  /* ---------- fim ---------- */
  console.log(C.passo('Pronto'));
  const enderecoRede = `http://${ips[0] || 'localhost'}:${porta}`;
  console.log(`    Sistema em    : ${destino}`);
  console.log(`    Backups em    : ${path.join(destino, 'backups')}`);
  console.log();
  if (temTela) {
    console.log('    ABRA O SISTEMA NO NAVEGADOR:');
    console.log(`        nesta máquina      -> http://localhost:${porta}`);
    if (ips.length)
      console.log(`        nos outros do balcão -> ${enderecoRede}`);
    console.log();
    console.log('    Não há endereço para configurar em cada computador: a');
    console.log('    tela conversa com quem a entregou.');
  } else {
    console.log(`    Endereço da API : ${enderecoRede}`);
    console.log('    No aplicativo do balcão, abra Configuração e ponha esse endereço.');
    console.log('    O arquivo config-do-aplicativo.json já tem ele pronto.');
  }
  console.log();
  console.log('    Para conferir a instalação de novo, use a senha do admin');
  console.log('    que você anotou (as senhas são sorteadas, não fixas):');
  console.log(`        cd "${destino}"`);
  if (WIN) {
    console.log(`        set TESTE_USUARIO=${admin ? admin.usuario : 'raissa'}`);
    console.log('        set TESTE_SENHA=a-senha-que-voce-anotou');
    console.log(`        node scripts/pentest.js http://127.0.0.1:${porta}`);
  } else {
    console.log(`        TESTE_USUARIO=${admin ? admin.usuario : 'raissa'} \\`);
    console.log(`        TESTE_SENHA=a-senha-anotada node scripts/pentest.js http://127.0.0.1:${porta}`);
  }
  console.log();
  console.log('    IMPORTANTE: os backups ficam nesta mesma máquina. Se o HD');
  console.log('    queimar, somem junto com o banco. Mande o diário para fora');
  console.log('    também — veja a última seção do INSTALACAO.md.');

  /* Abre a tela no fim. É o passo que transforma "instalou" em "está usando",
     e evita o mal-entendido clássico de achar que faltou alguma coisa porque
     o instalador terminou num prompt preto. */
  if (temTela) {
    console.log();
    if (await confirme('Abrir o sistema agora no navegador?', true)) {
      const url = `http://localhost:${porta}`;
      try {
        if (WIN) spawnSync('cmd', ['/c', 'start', '', url], { shell: false });
        else if (process.platform === 'darwin') spawnSync('open', [url]);
        else spawnSync('xdg-open', [url]);
      } catch {
        console.log(C.aviso(`não consegui abrir sozinho. Abra ${url} no navegador.`));
      }
    }
  }

  rl.close();
  process.exit(0);
})().catch(e => {
  console.log();
  if (e instanceof Parar) {
    console.log(C.erro(e.message));
    if (e.dica) console.log(`       ${e.dica}`);
  } else {
    console.log(C.erro('Erro inesperado: ' + (e?.message || e)));
    if (e?.stack) console.log(e.stack.split('\n').slice(1, 4).join('\n'));
  }

  if (gravado.length) {
    console.log();
    console.log('  O que JÁ ficou gravado nesta máquina:');
    for (const t of gravado) console.log(`    - ${t}`);
    console.log();
    console.log('  Rodar o INSTALAR.bat de novo é seguro: ele reconhece o que');
    console.log('  já existe e não duplica nada.');
  } else {
    console.log();
    console.log('  Nada foi gravado nesta máquina — parou antes disso.');
  }

  rl.close();
  process.exit(1);
});
