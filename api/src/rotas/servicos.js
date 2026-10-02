/* Ordens de serviço. Gravar um serviço atualiza o resumo do veículo na mesma
   transação — é isso que deixa a listagem instantânea depois. */
'use strict';
const express = require('express');
const { pool, q, um } = require('../db');
const { rota, erro400, erro403, erro404 } = require('../meio/erros');
const { exigeLogin, exigeEscrita } = require('../meio/auth');
const { somente, placaValida, dataValida, inteiro, decimal, txt, textoAte, paginacao } = require('../meio/validar');

const r = express.Router();
r.use(exigeLogin, exigeEscrita('admin', 'atendente'));

const INTERVALO = +(process.env.INTERVALO_DIAS || 219);

// lista branca: nada fora daqui é gravável pelo cliente
/* Preço e código são coisas diferentes e agora têm coluna própria:
   valor_filtro_* é quanto foi cobrado, cod_filtro_* é qual peça entrou.
   As colunas bruto_* guardam o texto da planilha e não são graváveis. */
const CODIGOS = ['cod_filtro_oleo', 'cod_filtro_ar',
                 'cod_filtro_cabine', 'cod_filtro_combustivel'];
/* valor_oleo entra aqui e, com isso, vale para o POST e para o PATCH de uma
   vez — os dois montam a lista branca a partir de VALORES. */
const VALORES = ['valor_oleo', 'valor_filtro_oleo', 'valor_filtro_ar',
                 'valor_filtro_cabine', 'valor_filtro_combustivel'];
const CAMPOS = ['placa', 'data', 'km', 'oleo', 'litros', 'total', ...VALORES, ...CODIGOS];

const ROTULO = {
  valor_oleo: 'o valor do óleo',
  valor_filtro_oleo: 'o valor do filtro de óleo',
  valor_filtro_ar: 'o valor do filtro de ar',
  valor_filtro_cabine: 'o valor do filtro de cabine',
  valor_filtro_combustivel: 'o valor do filtro de combustível',
  cod_filtro_oleo: 'o código do filtro de óleo',
  cod_filtro_ar: 'o código do filtro de ar',
  cod_filtro_cabine: 'o código do filtro de cabine',
  cod_filtro_combustivel: 'o código do filtro de combustível'
};

function validarServico(corpo) {
  const c = somente(corpo || {}, CAMPOS);
  const s = {
    placa: placaValida(c.placa),
    data: dataValida(c.data, 'a data') || new Date().toISOString().slice(0, 10),
    km: inteiro(c.km, 'a quilometragem', { min: 0, max: 2000000 }),
    oleo: txt(c.oleo).toUpperCase().slice(0, 30) || null,
    litros: decimal(c.litros, 'os litros', { min: 0, max: 30 }),
    total: decimal(c.total, 'o total', { min: 0, max: 20000 })
  };
  for (const k of VALORES) s[k] = decimal(c[k], ROTULO[k], { min: 0, max: 5000 });
  for (const k of CODIGOS)
    s[k] = (textoAte(c[k], ROTULO[k], 30) || '').toUpperCase() || null;
  return s;
}

/* O custo NÃO vem do corpo da requisição, é lido aqui no servidor.
 *
 * Duas razões. A primeira é que margem não pode depender do que o navegador
 * manda: quem lança a ordem não deveria conseguir dizer quanto a peça custou.
 * A segunda é que assim o balcão não digita nada — o custo sai da lista que a
 * oficina mantém, e é copiado para dentro da ordem.
 *
 * Copiado, e não consultado depois: se o relatório de março fosse calculado
 * lendo a tabela de hoje, o fornecedor subir o óleo em novembro mudaria a
 * margem de ordens fechadas há meses. Ordem fechada é fato passado.
 *
 * Item sem cadastro vira NULL, e não zero. Zero diria "este óleo saiu de
 * graça" — a tela precisa poder mostrar "não sei quanto custou".
 */
async function custosDaOrdem(conn, s) {
  const custos = {
    custo_oleo: null, custo_filtro_oleo: null, custo_filtro_ar: null,
    custo_filtro_cabine: null, custo_filtro_combustivel: null
  };

  const pegar = async (tipo, chave) => {
    if (!chave) return null;
    const [[linha]] = await conn.query(
      `SELECT custo, unidade FROM precos_itens
        WHERE tipo = ? AND chave = ? AND ativo = 1`,
      [tipo, String(chave).toUpperCase()]);
    return linha && linha.custo != null ? linha : null;
  };

  const oleo = await pegar('oleo', s.oleo);
  if (oleo) {
    /* Óleo se compra por litro. Sem litros na ordem não dá para saber quanto
       saiu do tambor, e chutar "1 litro" seria inventar uma margem alta. */
    const litros = Number(s.litros);
    custos.custo_oleo = (oleo.unidade === 'litro')
      ? (Number.isFinite(litros) && litros > 0
          ? Math.round(Number(oleo.custo) * litros * 100) / 100
          : null)
      : Number(oleo.custo);
  }

  for (const [campo, tipo] of [
    ['cod_filtro_oleo', 'filtro_oleo'],
    ['cod_filtro_ar', 'filtro_ar'],
    ['cod_filtro_cabine', 'filtro_cabine'],
    ['cod_filtro_combustivel', 'filtro_combustivel']
  ]) {
    const achado = await pegar(tipo, s[campo]);
    if (achado) custos['custo_' + tipo] = Number(achado.custo);
  }

  return custos;
}

/* POST /servicos — registra a ordem */
r.post('/', rota(async (req, res) => {
  const s = validarServico(req.body);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[veic]] = await conn.query(
      'SELECT id, cliente_id, ultima_troca, ultimo_km FROM veiculos WHERE placa = ? FOR UPDATE', [s.placa]);
    if (!veic) { await conn.rollback(); throw erro404('Placa não cadastrada. Cadastre o veículo primeiro.'); }

    const custos = await custosDaOrdem(conn, s);

    // o usuário vem da sessão, NUNCA do corpo (mass assignment)
    const [ins] = await conn.query(
      `INSERT INTO servicos
       (veiculo_id, cliente_id, data, km, oleo, litros, valor_oleo,
        valor_filtro_oleo, valor_filtro_ar, valor_filtro_cabine, valor_filtro_combustivel,
        custo_oleo, custo_filtro_oleo, custo_filtro_ar,
        custo_filtro_cabine, custo_filtro_combustivel,
        cod_filtro_oleo, cod_filtro_ar, cod_filtro_cabine, cod_filtro_combustivel,
        total, usuario_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [veic.id, veic.cliente_id, s.data, s.km, s.oleo, s.litros, s.valor_oleo,
       s.valor_filtro_oleo, s.valor_filtro_ar, s.valor_filtro_cabine, s.valor_filtro_combustivel,
       custos.custo_oleo, custos.custo_filtro_oleo, custos.custo_filtro_ar,
       custos.custo_filtro_cabine, custos.custo_filtro_combustivel,
       s.cod_filtro_oleo, s.cod_filtro_ar, s.cod_filtro_cabine, s.cod_filtro_combustivel,
       s.total, req.usuario.id]);

    // resumo do veículo: só avança se este serviço for o mais recente
    await conn.query(
      `UPDATE veiculos SET
         visitas = visitas + 1,
         ultima_troca = GREATEST(COALESCE(ultima_troca, '1900-01-01'), ?),
         ultimo_km   = IF(? >= COALESCE(ultima_troca,'1900-01-01'), COALESCE(?, ultimo_km), ultimo_km),
         ultimo_oleo = IF(? >= COALESCE(ultima_troca,'1900-01-01'), COALESCE(?, ultimo_oleo), ultimo_oleo),
         situacao = CASE
           WHEN DATEDIFF(CURDATE(), GREATEST(COALESCE(ultima_troca,'1900-01-01'), ?)) <= ? THEN 'em_dia'
           WHEN DATEDIFF(CURDATE(), GREATEST(COALESCE(ultima_troca,'1900-01-01'), ?)) <= 365 THEN 'vencido'
           WHEN DATEDIFF(CURDATE(), GREATEST(COALESCE(ultima_troca,'1900-01-01'), ?)) <= 730 THEN 'parado'
           ELSE 'frio' END
       WHERE id = ?`,
      [s.data, s.data, s.km, s.data, s.oleo, s.data, INTERVALO, s.data, s.data, veic.id]);

    await conn.commit();

    /* Hodômetro andando para trás quase sempre é dígito trocado na digitação,
       e o km é o que decide se o carro entra na fila de "vencido". Não bloqueia
       (troca de motor e painel zerado existem), mas o balcão precisa ver. */
    const aviso = (s.km != null && veic.ultimo_km != null && s.km < veic.ultimo_km)
      ? `Conferir a quilometragem: registrada ${Number(s.km).toLocaleString('pt-BR')} km, ` +
        `menor que os ${Number(veic.ultimo_km).toLocaleString('pt-BR')} km da última troca.`
      : null;

    res.status(201).json({
      id: ins.insertId,
      servico: { ...s, ...custos, veiculo_id: veic.id },
      aviso
    });
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}));

/* GET /servicos?de=&ate=&pagina= */
r.get('/', rota(async (req, res) => {
  const { limite, offset, pagina } = paginacao(req.query);
  const de = dataValida(req.query.de, 'a data inicial');
  const ate = dataValida(req.query.ate, 'a data final');
  if (de && ate && de > ate) throw erro400('A data inicial é depois da final.');

  const onde = [], p = [];
  if (de) { onde.push('s.data >= ?'); p.push(de); }
  if (ate) { onde.push('s.data <= ?'); p.push(ate); }
  const filtro = onde.length ? 'WHERE ' + onde.join(' AND ') : '';

  // Os ids saem primeiro, só pelo índice (ix_data_id); os JOINs depois rodam
  // sobre 50 linhas por chave primária. Sem isso o otimizador começa pela
  // tabela de clientes e cai em "temporary + filesort" — medido: 14,6ms -> 0,5ms.
  const [linhas, [{ total }]] = await Promise.all([
    q(`SELECT s.id, s.data, s.km, s.oleo, s.litros, s.total,
              /* O custo copiado no dia do lançamento. O Financeiro soma estas
                 colunas para descontar do faturamento o que saiu do estoque —
                 antes disto a "sobra" era só faturamento menos despesa
                 lançada à mão, e por isso vinha sempre maior que a real. */
              s.custo_oleo, s.custo_filtro_oleo, s.custo_filtro_ar,
              s.custo_filtro_cabine, s.custo_filtro_combustivel,
              s.valor_oleo, s.valor_filtro_oleo, s.valor_filtro_ar,
              s.valor_filtro_cabine, s.valor_filtro_combustivel,
              v.placa, v.modelo, c.nome AS cliente
       FROM (SELECT id FROM servicos s ${filtro}
             ORDER BY data DESC, id DESC LIMIT ? OFFSET ?) AS ids
       JOIN servicos s ON s.id = ids.id
       JOIN veiculos v ON v.id = s.veiculo_id
       JOIN clientes c ON c.id = s.cliente_id
       ORDER BY s.data DESC, s.id DESC`, [...p, limite, offset]),
    q(`SELECT COUNT(*) AS total FROM servicos s ${filtro}`, p)
  ]);

  res.json({ total, pagina, limite, servicos: linhas });
}));


/* Recalcula o resumo do veículo a partir dos serviços que restaram.
   Chamado depois de editar ou excluir: sem isso o resumo mente. */
async function recalcular(conn, veiculoId) {
  const [[r]] = await conn.query(
    `SELECT COUNT(*) visitas, MAX(data) ultima FROM servicos WHERE veiculo_id = ?`,
    [veiculoId]);

  if (!r.visitas) {
    await conn.query(
      `UPDATE veiculos SET visitas = 0, ultima_troca = NULL, ultimo_km = NULL,
         ultimo_oleo = NULL, situacao = NULL WHERE id = ?`, [veiculoId]);
    return;
  }

  const [[ult]] = await conn.query(
    `SELECT km, oleo FROM servicos WHERE veiculo_id = ? ORDER BY data DESC, id DESC LIMIT 1`,
    [veiculoId]);

  await conn.query(
    `UPDATE veiculos SET visitas = ?, ultima_troca = ?, ultimo_km = ?, ultimo_oleo = ?,
       situacao = CASE
         WHEN DATEDIFF(CURDATE(), ?) <= ? THEN 'em_dia'
         WHEN DATEDIFF(CURDATE(), ?) <= 365 THEN 'vencido'
         WHEN DATEDIFF(CURDATE(), ?) <= 730 THEN 'parado'
         ELSE 'frio' END
     WHERE id = ?`,
    [r.visitas, r.ultima, ult.km, ult.oleo, r.ultima, INTERVALO, r.ultima, r.ultima, veiculoId]);
}

/* GET /servicos/:id */
r.get('/:id', rota(async (req, res) => {
  const id = inteiro(req.params.id, 'o id', { min: 1 });
  const s = await um(
    `SELECT s.*, v.placa, v.modelo, c.nome AS cliente
     FROM servicos s
     JOIN veiculos v ON v.id = s.veiculo_id
     JOIN clientes c ON c.id = s.cliente_id
     WHERE s.id = ?`, [id]);
  if (!s) throw erro404('Ordem não encontrada.');
  const itens = await q(
    'SELECT id, descricao, valor FROM itens_servico WHERE servico_id = ?', [id]);
  res.json({ servico: s, itens });
}));

/* PATCH /servicos/:id — corrigir o que o atendente digitou errado */
r.patch('/:id', rota(async (req, res) => {
  const id = inteiro(req.params.id, 'o id', { min: 1 });
  const c = somente(req.body || {},
    ['data', 'km', 'oleo', 'litros', 'total', ...VALORES, ...CODIGOS]);
  if (!Object.keys(c).length) throw erro400('Nada para alterar.');

  const atual = await um(
    `SELECT id, veiculo_id, oleo, litros,
            cod_filtro_oleo, cod_filtro_ar, cod_filtro_cabine, cod_filtro_combustivel
       FROM servicos WHERE id = ?`, [id]);
  if (!atual) throw erro404('Ordem não encontrada.');

  const campos = {}, ordem = [];
  if (c.data !== undefined) { campos.data = dataValida(c.data, 'a data'); ordem.push('data'); }
  if (c.km !== undefined) { campos.km = inteiro(c.km, 'a quilometragem', { min: 0, max: 2000000 }); ordem.push('km'); }
  if (c.oleo !== undefined) { campos.oleo = txt(c.oleo).toUpperCase().slice(0, 30) || null; ordem.push('oleo'); }
  if (c.litros !== undefined) { campos.litros = decimal(c.litros, 'os litros', { min: 0, max: 30 }); ordem.push('litros'); }
  if (c.total !== undefined) { campos.total = decimal(c.total, 'o total', { min: 0, max: 20000 }); ordem.push('total'); }
  for (const f of CODIGOS)
    if (c[f] !== undefined) {
      campos[f] = (textoAte(c[f], ROTULO[f], 30) || '').toUpperCase() || null;
      ordem.push(f);
    }
  for (const f of VALORES)
    if (c[f] !== undefined) {
      campos[f] = decimal(c[f], ROTULO[f], { min: 0, max: 5000 });
      ordem.push(f);
    }

  /* Corrigir o óleo, os litros ou um código de peça muda QUAL item entrou na
     ordem — então o custo copiado no lançamento deixou de valer. Recalcular
     aqui é o que faz a correção de um dígito errado no código não deixar a
     margem daquela ordem mentindo para sempre.

     O que continua valendo é a regra do começo: o custo vem da lista de hoje,
     não do corpo da requisição. Quem corrige a ordem não escolhe a margem. */
  const mudouItem = ['oleo', 'litros', ...CODIGOS].some(k => c[k] !== undefined);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (mudouItem) {
      const depois = {
        oleo: campos.oleo !== undefined ? campos.oleo : atual.oleo,
        litros: campos.litros !== undefined ? campos.litros : atual.litros
      };
      for (const f of CODIGOS)
        depois[f] = campos[f] !== undefined ? campos[f] : atual[f];

      const custos = await custosDaOrdem(conn, depois);
      for (const [k, v] of Object.entries(custos)) { campos[k] = v; ordem.push(k); }
    }

    await conn.query(
      `UPDATE servicos SET ${ordem.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
      [...ordem.map(k => campos[k]), id]);
    await recalcular(conn, atual.veiculo_id);   // a data ou o km podem ter mudado
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally { conn.release(); }

  const novo = await um('SELECT * FROM servicos WHERE id = ?', [id]);
  res.json({ servico: novo });
}));

/* DELETE /servicos/:id — só admin: apagar ordem mexe no faturamento */
r.delete('/:id', rota(async (req, res) => {
  if (req.usuario.papel !== 'admin')
    throw erro403('Só o administrador pode excluir uma ordem de serviço.');

  const id = inteiro(req.params.id, 'o id', { min: 1 });
  const s = await um(
    `SELECT s.id, s.veiculo_id, s.data, s.total, v.placa
     FROM servicos s JOIN veiculos v ON v.id = s.veiculo_id WHERE s.id = ?`, [id]);
  if (!s) throw erro404('Ordem não encontrada.');

  if (String(req.query.confirmar) !== '1')
    return res.status(409).json({
      erro: 'Confirme a exclusão.',
      detalhe: `Ordem de ${new Date(s.data).toLocaleDateString('pt-BR')} da placa ${s.placa}` +
               (s.total ? `, no valor de R$ ${Number(s.total).toFixed(2)}` : '') +
               '. Isso muda o faturamento do mês.',
      confirmar_com: `DELETE /api/servicos/${id}?confirmar=1`
    });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM servicos WHERE id = ?', [id]);
    await recalcular(conn, s.veiculo_id);
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally { conn.release(); }

  res.json({ ok: true, removida: { id, placa: s.placa, total: s.total } });
}));

/* POST /servicos/:id/itens — os extras (anel, fluido, palheta) */
r.post('/:id/itens', rota(async (req, res) => {
  const id = inteiro(req.params.id, 'o id', { min: 1 });
  const descricao = txt(req.body?.descricao).slice(0, 60);
  if (!descricao) throw erro400('Informe a descrição do item.');
  const valor = decimal(req.body?.valor, 'o valor', { min: 0, max: 20000 });

  const s = await um('SELECT id FROM servicos WHERE id = ?', [id]);
  if (!s) throw erro404('Ordem não encontrada.');

  const res1 = await q(
    'INSERT INTO itens_servico (servico_id, descricao, valor, origem) VALUES (?,?,?,?)',
    [id, descricao, valor, 'sistema']);
  res.status(201).json({ item: { id: res1.insertId, descricao, valor } });
}));

module.exports = r;
