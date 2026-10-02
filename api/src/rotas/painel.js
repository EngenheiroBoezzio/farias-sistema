/* Painel e listas de trabalho.
   Agregações pesadas ficam num cache curto em memória: a tela abre instantânea
   e os números continuam do dia. */
'use strict';
const express = require('express');
const { q } = require('../db');
const { rota } = require('../meio/erros');
const { exigeLogin } = require('../meio/auth');
const { paginacao } = require('../meio/validar');

const r = express.Router();
r.use(exigeLogin);

const TTL = +(process.env.CACHE_PAINEL_MS || 30000);
const cache = new Map();
async function comCache(chave, fn) {
  const agora = Date.now();
  const hit = cache.get(chave);
  if (hit && agora - hit.em < TTL) return { ...hit.valor, _cache: true };
  const valor = await fn();
  cache.set(chave, { em: agora, valor });
  return { ...valor, _cache: false };
}

/* GET /painel */
r.get('/', rota(async (_req, res) => {
  const dados = await comCache('painel', async () => {
    const [[resumo], serie, oleos, ultimas] = await Promise.all([
      q(`SELECT
           (SELECT COUNT(*) FROM clientes) AS clientes,
           (SELECT COUNT(*) FROM veiculos) AS veiculos,
           (SELECT COUNT(*) FROM servicos) AS servicos,
           (SELECT COUNT(*) FROM veiculos WHERE situacao='em_dia')  AS em_dia,
           (SELECT COUNT(*) FROM veiculos WHERE situacao='vencido') AS vencido,
           (SELECT COUNT(*) FROM veiculos WHERE situacao='parado')  AS parado,
           (SELECT COUNT(*) FROM veiculos WHERE situacao='frio')    AS frio,
           (SELECT COUNT(*) FROM clientes WHERE telefone IS NOT NULL) AS com_telefone,
           (SELECT COUNT(*) FROM clientes WHERE nascimento IS NOT NULL) AS com_nascimento,
           (SELECT ROUND(AVG(total),2) FROM servicos WHERE total > 0) AS ticket`),
      /* O custo sai daqui somado POR MÊS, e não das ordens carregadas na
         tela. O Financeiro busca 100 ordens por página; somar o custo do
         lado do cliente daria o custo das últimas 100 e chamaria isso de
         "o mês", o que é pior do que não mostrar nada. São 9 mil ordens na
         base — quem soma é o banco.

         `custo_conhecido` conta quantas ordens do mês têm ALGUM custo
         gravado. Serve para a tela saber a diferença entre "o mês custou
         zero" e "ninguém cadastrou preço ainda" — que parecem iguais no
         número e são coisas opostas. */
      q(`SELECT DATE_FORMAT(data,'%Y-%m') AS mes, COUNT(*) AS n,
                ROUND(SUM(COALESCE(total,0)),2) AS valor,
                ROUND(SUM(COALESCE(custo_oleo,0) + COALESCE(custo_filtro_oleo,0)
                        + COALESCE(custo_filtro_ar,0) + COALESCE(custo_filtro_cabine,0)
                        + COALESCE(custo_filtro_combustivel,0)),2) AS custo,
                SUM(custo_oleo IS NOT NULL OR custo_filtro_oleo IS NOT NULL
                 OR custo_filtro_ar IS NOT NULL OR custo_filtro_cabine IS NOT NULL
                 OR custo_filtro_combustivel IS NOT NULL) AS custo_conhecido
         FROM servicos WHERE data >= DATE_SUB(CURDATE(), INTERVAL 13 MONTH)
         GROUP BY mes ORDER BY mes`),
      q(`SELECT oleo AS nome, COUNT(*) AS n FROM servicos
         WHERE oleo IS NOT NULL AND oleo <> ''
         GROUP BY oleo ORDER BY n DESC LIMIT 6`),
      q(`SELECT s.data, s.total, s.oleo, v.placa, v.modelo, c.nome AS cliente
         FROM servicos s
         JOIN veiculos v ON v.id = s.veiculo_id
         JOIN clientes c ON c.id = s.cliente_id
         ORDER BY s.id DESC LIMIT 5`)
    ]);
    return { resumo, serie, oleos, ultimas };
  });
  res.json(dados);
}));

/* GET /painel/vencidos — a fila de recuperação.
   Índice (situacao, ultima_troca) resolve sem ordenar em disco. */
r.get('/vencidos', rota(async (req, res) => {
  const { limite, offset, pagina } = paginacao(req.query);
  const [linhas, [{ total }]] = await Promise.all([
    q(`SELECT v.id, v.placa, v.modelo, v.ultimo_oleo, v.ultimo_km, v.ultima_troca,
              DATEDIFF(CURDATE(), v.ultima_troca) AS dias,
              c.nome AS cliente, c.telefone, c.tel_inferido, c.aceita_aviso,
              (SELECT MAX(a.enviado_em) FROM avisos a
                WHERE a.veiculo_id = v.id AND a.tipo='vencido') AS ultimo_aviso
       FROM veiculos v JOIN clientes c ON c.id = v.cliente_id
       WHERE v.situacao = 'vencido'
       ORDER BY v.ultima_troca ASC LIMIT ? OFFSET ?`, [limite, offset]),
    q(`SELECT COUNT(*) AS total FROM veiculos WHERE situacao='vencido'`)
  ]);
  res.json({ total, pagina, limite, vencidos: linhas });
}));

/* GET /painel/aniversariantes — usa o índice por mês/dia */
r.get('/aniversariantes', rota(async (_req, res) => {
  const linhas = await q(
    // usa as colunas geradas (nasc_mes, nasc_dia): sai por índice, não varre a tabela
    `SELECT id, nome, telefone, nascimento FROM clientes
     WHERE nasc_mes = MONTH(CURDATE())
       AND nasc_dia = DAY(CURDATE())
       AND aceita_aviso = 1
     ORDER BY nome`);
  res.json({ total: linhas.length, aniversariantes: linhas });
}));

module.exports = r;
