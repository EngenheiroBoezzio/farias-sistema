/* O vigia: avisa quando o backup PAROU de rodar.

   Backup que falha gera erro e aparece. Backup que simplesmente deixou de
   existir — cron desligado, servidor trocado, caminho mudado — não gera nada,
   e é assim que empresas descobrem no pior dia que não têm cópia há meses.

   Roda uma vez por dia no fim do expediente.
*/
'use strict';
require('../src/ambiente');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const LIMITE_HORAS = +(process.env.BACKUP_ALERTA_HORAS || 26);
const DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'farias'
  });

  const [[r]] = await db.query(
    `SELECT iniciado_em, arquivo,
            TIMESTAMPDIFF(HOUR, iniciado_em, NOW()) AS horas
     FROM backups WHERE status = 'ok' ORDER BY iniciado_em DESC LIMIT 1`);

  const problemas = [];

  if (!r) {
    problemas.push('Nenhum backup bem-sucedido foi registrado até agora.');
  } else {
    if (r.horas > LIMITE_HORAS)
      problemas.push(`O último backup que deu certo foi há ${r.horas} horas.`);

    // o registro diz que rodou — mas o arquivo ainda está lá?
    const caminho = path.join(DIR, r.arquivo);
    if (!fs.existsSync(caminho))
      problemas.push(`O arquivo ${r.arquivo} está registrado mas não existe mais no disco.`);
  }

  const [[falhas]] = await db.query(
    `SELECT COUNT(*) n FROM backups
     WHERE status <> 'ok' AND iniciado_em >= DATE_SUB(NOW(), INTERVAL 7 DAY)`);
  if (falhas.n >= 3)
    problemas.push(`${falhas.n} backups falharam nos últimos 7 dias.`);

  if (!problemas.length) {
    console.log(`[vigia] ok — último backup há ${r.horas}h`);
    await db.end();
    return;
  }

  // não repete o mesmo alerta todo dia: só cria se não houver um aberto
  const [[aberto]] = await db.query(
    `SELECT COUNT(*) n FROM notificacoes
     WHERE origem='vigia-backup' AND lida_em IS NULL
       AND criada_em >= DATE_SUB(NOW(), INTERVAL 3 DAY)`);

  if (!aberto.n) {
    await db.query(
      `INSERT INTO notificacoes (nivel, titulo, detalhe, origem) VALUES (?,?,?,?)`,
      ['erro', 'Backup pode ter parado', problemas.join(' ').slice(0, 400), 'vigia-backup']);
  }

  console.error('[vigia] PROBLEMA:', problemas.join(' '));
  await db.end();
  process.exit(1);
})().catch(e => { console.error(e.message); process.exit(1); });
