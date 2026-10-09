/* ===========================================================
   Backup com verificação de verdade.

   Um arquivo .sql que ninguém nunca restaurou não é backup — é esperança.
   Por isso cada rodada aqui faz quatro coisas:

     1. dump completo (mysqldump com transação consistente)
     2. comprime e calcula o SHA-256
     3. RESTAURA num banco temporário e confere as contagens
     4. registra o resultado e cria a notificação para o sistema

   node scripts/backup.js [horario|diario|mensal]
   =========================================================== */
'use strict';
require('../src/ambiente');

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const mysql = require('mysql2/promise');

const exec = promisify(execFile);

const TIPO = ['horario', 'diario', 'mensal'].includes(process.argv[2]) ? process.argv[2] : 'horario';
const DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const BANCO = process.env.DB_NAME || 'farias';
const BANCO_TESTE = BANCO + '_verifica';

// quantos guardar de cada tipo (esquema avô-pai-filho)
const RETENCAO = { horario: 24, diario: 30, mensal: 12 };

// tabelas cujas contagens têm que bater depois de restaurar
const CONFERIR = ['clientes', 'veiculos', 'servicos', 'itens_servico', 'usuarios'];

const cfg = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: +(process.env.DB_PORT || 3306),
  user: process.env.BACKUP_DB_USER || process.env.DB_USER,
  password: process.env.BACKUP_DB_PASSWORD || process.env.DB_PASSWORD
};

const carimbo = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const mb = n => (n / 1048576).toFixed(2) + ' MB';

async function contar(conn, banco) {
  const saida = {};
  for (const t of CONFERIR) {
    try {
      const [[r]] = await conn.query(`SELECT COUNT(*) n FROM \`${banco}\`.\`${t}\``);
      saida[t] = r.n;
    } catch { saida[t] = null; }
  }
  return saida;
}

async function main() {
  const t0 = Date.now();
  const iniciado = new Date();
  fs.mkdirSync(DIR, { recursive: true });

  const nome = `farias-${TIPO}-${carimbo()}.sql.gz`;
  const caminho = path.join(DIR, nome);
  let conn, status = 'falhou', erro = null;
  let bytes = null, sha = null, origem = null, restauro = null, verificado = 0;

  try {
    conn = await mysql.createConnection({ ...cfg, multipleStatements: true });

    /* 1. contagens do banco real, ANTES do dump */
    origem = await contar(conn, BANCO);

    /* 2. dump — --single-transaction dá uma foto consistente sem travar a oficina */
    const args = [
      `--host=${cfg.host}`, `--port=${cfg.port}`, `--user=${cfg.user}`,
      '--single-transaction', '--quick', '--routines', '--events', '--triggers',
      '--default-character-set=utf8mb4', '--add-drop-table', '--set-gtid-purged=OFF',
      BANCO
    ].filter(a => !a.includes('gtid'));   // MariaDB não tem essa flag
    if (cfg.password) process.env.MYSQL_PWD = cfg.password;

    const { stdout } = await exec('mariadb-dump', args, {
      maxBuffer: 512 * 1024 * 1024, env: process.env
    });

    /* 3. comprime e assina */
    const comprimido = zlib.gzipSync(Buffer.from(stdout, 'utf8'), { level: 9 });
    fs.writeFileSync(caminho, comprimido);
    bytes = comprimido.length;
    sha = crypto.createHash('sha256').update(comprimido).digest('hex');

    /* 4. VERIFICA restaurando de verdade num banco separado */
    await conn.query(`DROP DATABASE IF EXISTS \`${BANCO_TESTE}\``);
    await conn.query(`CREATE DATABASE \`${BANCO_TESTE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    const sql = zlib.gunzipSync(fs.readFileSync(caminho)).toString('utf8');
    await conn.query(`USE \`${BANCO_TESTE}\``);
    await conn.query(sql.replace(/^USE `[^`]+`;$/gm, ''));   // restaura no banco de teste
    restauro = await contar(conn, BANCO_TESTE);
    await conn.query(`DROP DATABASE \`${BANCO_TESTE}\``);
    verificado = 1;

    const divergentes = CONFERIR.filter(t => origem[t] !== restauro[t]);
    if (divergentes.length) {
      status = 'divergente';
      erro = 'não bateram: ' + divergentes
        .map(t => `${t} (${origem[t]} no banco, ${restauro[t]} na cópia)`).join('; ');
    } else {
      status = 'ok';
    }
  } catch (e) {
    erro = String(e.message || e).slice(0, 900);
    try { fs.unlinkSync(caminho); } catch {}
  }

  const duracao = Date.now() - t0;

  /* 5. registra e notifica */
  try {
    if (!conn) conn = await mysql.createConnection(cfg);
    await conn.query(`USE \`${BANCO}\``);
    await conn.query(
      `INSERT INTO backups
       (arquivo, tipo, iniciado_em, duracao_ms, bytes, sha256,
        linhas_origem, linhas_restauro, verificado, status, erro)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [nome, TIPO, iniciado, duracao, bytes, sha,
       JSON.stringify(origem), JSON.stringify(restauro), verificado, status, erro]);

    const total = origem ? Object.values(origem).reduce((a, b) => a + (b || 0), 0) : 0;
    const notas = {
      ok: ['ok', 'Backup concluído',
           `${mb(bytes)} · ${total.toLocaleString('pt-BR')} registros conferidos após restaurar · ${(duracao / 1000).toFixed(1)}s`],
      divergente: ['erro', 'Backup com divergência',
           `O arquivo foi gerado mas as contagens não bateram. ${erro}`],
      falhou: ['erro', 'Backup falhou',
           `Nenhum arquivo foi gerado. ${erro}`]
    }[status];

    // só notifica sucesso uma vez por dia: aviso repetido vira ruído e ninguém lê
    const [[jaHoje]] = await conn.query(
      `SELECT COUNT(*) n FROM notificacoes
       WHERE origem='backup' AND nivel='ok' AND DATE(criada_em)=CURDATE()`);
    if (status !== 'ok' || !jaHoje.n || TIPO === 'diario') {
      await conn.query(
        'INSERT INTO notificacoes (nivel, titulo, detalhe, origem) VALUES (?,?,?,?)',
        [notas[0], notas[1], notas[2], 'backup']);
    }
  } catch (e) {
    console.error('não consegui registrar o backup:', e.message);
  }

  /* 6. limpeza pela retenção */
  let apagados = 0;
  try {
    const guardar = RETENCAO[TIPO];
    const arquivos = fs.readdirSync(DIR)
      .filter(f => f.startsWith(`farias-${TIPO}-`) && f.endsWith('.sql.gz'))
      .sort().reverse();
    for (const velho of arquivos.slice(guardar)) {
      fs.unlinkSync(path.join(DIR, velho));
      apagados++;
    }
  } catch {}

  if (conn) await conn.end();

  const sinal = { ok: 'OK', divergente: 'DIVERGENTE', falhou: 'FALHOU' }[status];
  console.log(`[${sinal}] ${nome}`);
  if (bytes) console.log(`  ${mb(bytes)} · ${(duracao / 1000).toFixed(1)}s · sha ${sha.slice(0, 12)}…`);
  if (origem) console.log(`  origem:   ${JSON.stringify(origem)}`);
  if (restauro) console.log(`  restauro: ${JSON.stringify(restauro)}`);
  if (apagados) console.log(`  ${apagados} backup(s) antigo(s) removido(s) pela retenção`);
  if (erro) console.error(`  erro: ${erro}`);

  process.exit(status === 'ok' ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
