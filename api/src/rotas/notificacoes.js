/* Notificações do sistema — o sininho do topo.
   Quem escreve aqui é o próprio sistema (backup, atualização); a API só lê
   e marca como lida. */
'use strict';
const express = require('express');
const { q, um } = require('../db');
const { rota, erro404 } = require('../meio/erros');
const { exigeLogin, exigePapel } = require('../meio/auth');
const { esquecerCatalogo } = require('../meio/wega');
const { inteiro, paginacao, txt, exigeTexto } = require('../meio/validar');

const r = express.Router();
r.use(exigeLogin);

let seedConferido = false;
async function conferirSeed() {
  if (seedConferido) return;
  seedConferido = true;
  try {
    const jaTem = await um("SELECT id FROM notificacoes WHERE titulo LIKE '%assinatura%' OR titulo LIKE '%faturamento%' LIMIT 1");
    if (!jaTem) {
      await q(
        `INSERT INTO notificacoes (nivel, titulo, detalhe, origem)
         VALUES ('aviso', 'Nova função de assinatura configurada', 'Veja e identifique a data de pagamento para você na aba Configuração → Faturamento.', 'sistema')`
      );
    }
  } catch {}
}

/* GET /notificacoes — o que alimenta o badge */
r.get('/', rota(async (req, res) => {
  await conferirSeed();
  const { limite, offset } = paginacao(req.query);
  const soNaoLidas = String(req.query.nao_lidas || '') === '1';
  const filtro = soNaoLidas ? 'WHERE lida_em IS NULL' : '';

  const [lista, [cont]] = await Promise.all([
    q(`SELECT id, nivel, titulo, detalhe, origem, criada_em, lida_em
       FROM notificacoes ${filtro}
       ORDER BY criada_em DESC LIMIT ? OFFSET ?`, [limite, offset]),
    q(`SELECT
         COUNT(*) AS total,
         SUM(lida_em IS NULL) AS nao_lidas,
         SUM(lida_em IS NULL AND nivel = 'erro') AS erros
       FROM notificacoes WHERE criada_em >= DATE_SUB(NOW(), INTERVAL 30 DAY)`)
  ]);

  /* As NOVIDADES entram na mesma resposta do sino, numa chamada só — o sino
     já consulta isto a cada poucos minutos, e novidade muda raramente.

     Repare: as novidades não lidas são POR USUÁRIO (carimbo em
     usuarios.novidades_visto_em), enquanto as notificações de backup têm
     "lida" global. São contas separadas de propósito, somadas só no número
     da bolinha. */
  const [novidades, [contNov], usuario] = await Promise.all([
    q(`SELECT id, versao, titulo, corpo, a_pedido, destaque, publicada_em
         FROM novidades
        ORDER BY destaque DESC, publicada_em DESC
        LIMIT 20`),
    q(`SELECT COUNT(*) AS nao_lidas
         FROM novidades n JOIN usuarios u ON u.id = ?
        WHERE u.novidades_visto_em IS NULL OR n.publicada_em > u.novidades_visto_em`,
      [req.usuario.id]),
    um('SELECT novidades_visto_em FROM usuarios WHERE id = ?', [req.usuario.id])
  ]);

  const visto = usuario?.novidades_visto_em;
  const novidadesFlag = novidades.map(n => ({
    ...n, a_pedido: !!n.a_pedido, destaque: !!n.destaque,
    nova: !visto || new Date(n.publicada_em) > new Date(visto)
  }));

  res.json({
    nao_lidas: Number(cont.nao_lidas || 0),
    erros: Number(cont.erros || 0),
    notificacoes: lista,
    novidades: novidadesFlag,
    novidades_nao_lidas: Number(contNov.nao_lidas || 0)
  });
}));

/* POST /notificacoes/:id/lida */
r.post('/:id/lida', rota(async (req, res) => {
  const id = inteiro(req.params.id, 'o id', { min: 1 });
  const n = await um('SELECT id FROM notificacoes WHERE id = ?', [id]);
  if (!n) throw erro404('Notificação não encontrada.');
  await q('UPDATE notificacoes SET lida_em = NOW(), lida_por = ? WHERE id = ? AND lida_em IS NULL',
          [req.usuario.id, id]);
  res.json({ ok: true });
}));

/* POST /notificacoes/lidas — marca todas */
r.post('/lidas', rota(async (req, res) => {
  const [r1] = [await q('UPDATE notificacoes SET lida_em = NOW(), lida_por = ? WHERE lida_em IS NULL',
                        [req.usuario.id])];
  res.json({ ok: true, marcadas: r1.affectedRows ?? 0 });
}));

/* POST /notificacoes — cria nova notificação administrativa */
r.post('/', exigePapel('admin'), rota(async (req, res) => {
  const titulo = exigeTexto(req.body?.titulo, 'o título', 120);
  const detalhe = txt(req.body?.detalhe).slice(0, 400) || null;
  const nivel = ['ok', 'aviso', 'erro'].includes(req.body?.nivel) ? req.body.nivel : 'ok';
  const origem = txt(req.body?.origem).slice(0, 40) || 'admin';

  const ins = await q(
    'INSERT INTO notificacoes (nivel, titulo, detalhe, origem) VALUES (?, ?, ?, ?)',
    [nivel, titulo, detalhe, origem]
  );

  res.status(201).json({
    ok: true,
    notificacao: { id: ins.insertId, nivel, titulo, detalhe, origem }
  });
}));

/* GET /notificacoes/backups — histórico, para a tela de administração.
   É aqui que se descobre que o backup parou de rodar há três dias. */
r.get('/backups', exigePapel('admin'), rota(async (_req, res) => {
  const [ultimos, [saude]] = await Promise.all([
    q(`SELECT id, arquivo, tipo, iniciado_em, duracao_ms, bytes, status,
              verificado, erro, LEFT(sha256, 12) AS sha
       FROM backups ORDER BY iniciado_em DESC LIMIT 20`),
    q(`SELECT
         (SELECT iniciado_em FROM backups WHERE status='ok' ORDER BY iniciado_em DESC LIMIT 1) AS ultimo_ok,
         (SELECT TIMESTAMPDIFF(HOUR,
            (SELECT iniciado_em FROM backups WHERE status='ok' ORDER BY iniciado_em DESC LIMIT 1),
            NOW())) AS horas_desde,
         (SELECT COUNT(*) FROM backups WHERE status <> 'ok'
            AND iniciado_em >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS falhas_semana`)
  ]);

  // um backup que não roda há mais de 26h é um problema mesmo sem ter falhado
  const horas = saude.horas_desde;
  saude.alerta = horas == null ? 'nunca rodou'
               : horas > 26 ? `sem backup bem-sucedido há ${horas}h`
               : null;

  res.json({ saude, backups: ultimos });
}));

/* POST /notificacoes/recarregar-catalogo — depois de carregar um catálogo novo.

   O catálogo Wega fica em memória para a sugestão sair rápida. Sem isto,
   trocar o catálogo exigiria reiniciar a API no meio do expediente. */
r.post('/recarregar-catalogo', exigePapel('admin'), rota(async (_req, res) => {
  esquecerCatalogo();
  const { sugerirFiltros } = require('../meio/wega');
  const t0 = Date.now();
  await sugerirFiltros({ modelo: 'GOL', ano: 2015 });   // força o recarregamento
  const [[c]] = [await q('SELECT COUNT(*) n FROM catalogo_filtro')];
  res.json({ ok: true, linhas: c.n, ms: Date.now() - t0,
             nota: 'Catálogo relido do banco. A próxima consulta já usa o novo.' });
}));

module.exports = r;
