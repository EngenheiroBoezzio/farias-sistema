/* Clientes: cadastro, edição e exclusão.
   Lista branca de campos; nada fora dela é gravável pelo cliente. */
'use strict';
const express = require('express');
const { pool, q, um } = require('../db');
const { rota, erro400, erro404, erro409 } = require('../meio/erros');
const { exigeLogin, exigeEscrita } = require('../meio/auth');
const {
  somente, exigeTexto, textoAte, telefoneValido, dataValida, inteiro, txt, paginacao, ordenacao
} = require('../meio/validar');

const r = express.Router();
r.use(exigeLogin, exigeEscrita('admin', 'atendente'));

const CAMPOS = ['nome', 'telefone', 'nascimento', 'aceita_aviso', 'obs'];

/** @param {boolean} parcial  true no PATCH: só valida o que veio */
function validar(corpo, { parcial = false } = {}) {
  const c = somente(corpo || {}, CAMPOS);
  const saida = {};

  if (!parcial || c.nome !== undefined)
    saida.nome = exigeTexto(c.nome, 'o nome do cliente', 120, 2);

  if (!parcial || c.telefone !== undefined)
    saida.telefone = telefoneValido(c.telefone);

  if (!parcial || c.nascimento !== undefined) {
    const d = dataValida(c.nascimento, 'a data de nascimento');
    if (d) {
      const ano = +d.slice(0, 4);
      const agora = new Date().getFullYear();
      if (ano < 1900 || ano > agora) throw erro400('Data de nascimento fora do razoável.');
    }
    saida.nascimento = d;
  }

  if (!parcial || c.aceita_aviso !== undefined)
    saida.aceita_aviso = c.aceita_aviso === undefined ? 1 : (c.aceita_aviso ? 1 : 0);

  if (!parcial || c.obs !== undefined)
    saida.obs = textoAte(c.obs, 'a observação', 255);

  if (parcial && !Object.keys(saida).length) throw erro400('Nada para alterar.');
  return saida;
}

/* GET /clientes */
r.get('/', rota(async (req, res) => {
  const { limite, offset, pagina } = paginacao(req.query);
  const busca = txt(req.query.busca);

  /* Ordenar por "quem sumiu faz mais tempo" é o padrão, e não por nome.
     A lista existe para saber quem chamar de volta; em ordem alfabética o
     cliente de dois anos atrás fica na letra dele, invisível. `ultima_visita`
     é a troca mais recente entre TODOS os carros da pessoa. */
  const { campo } = ordenacao(
    req.query, ['nome', 'criado_em', 'id', 'ultima_visita'], 'ultima_visita');
  /* Sem `dir` na consulta, a ordem e a MAIS ANTIGA primeiro: a lista existe
     para saber quem chamar de volta, e o cliente que voltou ontem nao precisa
     de ligacao. O ajudante `ordenacao` assume DESC quando nao mandam nada,
     que e o contrario do util aqui. */
  const dir = String(req.query.dir || '').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const ORDEM = {
    nome: 'c.nome',
    criado_em: 'c.criado_em',
    id: 'c.id',
    /* NULL é quem nunca trouxe carro nenhum: vai para o fim nos dois sentidos,
       porque "nunca veio" não é a mesma coisa que "veio há muito tempo". */
    ultima_visita: 'ultima_visita IS NULL, ultima_visita'
  };

  const onde = [], p = [];
  if (busca) {
    /* UM BUG QUE ESTAVA AQUI DESDE O COMECO, e que e provavelmente a maior
       parte da reclamacao do balcao:

         p.push(`%${busca}%`, `%${busca.replace(/\D/g, '')}%`)

       Buscar "maria" deixava o segundo parametro VAZIO, e `telefone LIKE
       '%%'` casa com todo cliente que tem telefone. Ou seja: digitar um nome
       devolvia a base inteira, com o cliente certo perdido no meio. A Raissa
       nao estava com dificuldade de ler a tela — a tela estava respondendo
       errado.

       Agora cada condicao so entra quando tem o que procurar. */
    const ou = [];

    ou.push('c.nome LIKE ?');
    p.push(`%${busca}%`);

    /* Telefone so entra quando o termo E um telefone: nada alem de digitos e
       pontuacao de telefone. Sem isso a placa ABC1D23 virava busca por "123"
       e casava com metade dos telefones da base — foi o que aconteceu no
       primeiro teste. Minimo de 4 digitos, que e o final de um numero. */
    const digitos = busca.replace(/\D/g, '');
    const pareceTelefone = /^[\d\s()+.\-]+$/.test(busca.trim());
    if (pareceTelefone && digitos.length >= 4) {
      ou.push("REPLACE(REPLACE(REPLACE(REPLACE(c.telefone,' ',''),'-',''),'(',''),')','') LIKE ?");
      p.push(`%${digitos}%`);
    }

    /* A BUSCA POR PLACA, que o campo prometia e o servidor nunca fez.
       Sem traco e em maiuscula dos dois lados: no balcao ela e digitada dos
       dois jeitos, e o cadastro antigo tem placa com e sem traco. */
    const placa = busca.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (placa.length >= 3) {
      ou.push(`EXISTS (SELECT 1 FROM veiculos v WHERE v.cliente_id = c.id
                        AND REPLACE(UPPER(v.placa), '-', '') LIKE ?)`);
      p.push(`%${placa}%`);
    }

    /* E pelo modelo do carro: "o Gol prata" chega no balcao antes do nome. */
    if (busca.trim().length >= 3) {
      ou.push(`EXISTS (SELECT 1 FROM veiculos v WHERE v.cliente_id = c.id
                        AND (UPPER(v.modelo) LIKE ? OR UPPER(v.marca) LIKE ?))`);
      p.push(`%${busca.toUpperCase()}%`, `%${busca.toUpperCase()}%`);
    }

    onde.push('(' + ou.join(' OR ') + ')');
  }
  if (String(req.query.sem_telefone) === '1') onde.push('c.telefone IS NULL');
  if (String(req.query.sem_nascimento) === '1') onde.push('c.nascimento IS NULL');
  const filtro = onde.length ? 'WHERE ' + onde.join(' AND ') : '';

  const [linhas, [{ total }]] = await Promise.all([
    q(`SELECT c.id, c.nome, c.telefone, c.tel_inferido, c.nascimento, c.aceita_aviso, c.obs,
              (SELECT COUNT(*) FROM veiculos v WHERE v.cliente_id = c.id) AS veiculos,
              (SELECT MAX(v.ultima_troca) FROM veiculos v WHERE v.cliente_id = c.id) AS ultima_visita
       FROM clientes c ${filtro}
       ORDER BY ${ORDEM[campo]} ${dir} LIMIT ? OFFSET ?`, [...p, limite, offset]),
    q(`SELECT COUNT(*) AS total FROM clientes c ${filtro}`, p)
  ]);

  /* OS CARROS DE CADA CLIENTE, em uma segunda consulta.

     Em JOIN na consulta de cima, um cliente com três carros viraria três
     linhas e estouraria a paginação — pedir 25 clientes devolveria 25 linhas
     que são 9 pessoas. Aqui são os carros APENAS dos clientes desta página.

     E o que vem junto é o que o balcão pergunta: quando esse carro passou
     aqui pela última vez, com quantos km, e se já está na hora. Antes a tela
     recebia só um COUNT — um número que não abre e não responde nada. */
  if (linhas.length) {
    const ids = linhas.map(l => l.id);
    const carros = await q(
      `SELECT id, cliente_id, placa, marca, modelo, ano,
              ultima_troca, ultimo_km, ultimo_oleo, situacao, visitas,
              DATEDIFF(CURDATE(), ultima_troca) AS dias
         FROM veiculos
        WHERE cliente_id IN (${ids.map(() => '?').join(',')})
        ORDER BY ultima_troca IS NULL, ultima_troca DESC, placa`, ids);

    const porCliente = new Map(ids.map(id => [id, []]));
    for (const v of carros) porCliente.get(v.cliente_id)?.push(v);
    for (const l of linhas) l.carros = porCliente.get(l.id) || [];
  }

  res.json({ total, pagina, limite, clientes: linhas });
}));

/* GET /clientes/:id */
r.get('/:id', rota(async (req, res) => {
  const id = inteiro(req.params.id, 'o id', { min: 1 });
  const c = await um(
    `SELECT id, nome, telefone, tel_inferido, nascimento, aceita_aviso, obs, criado_em
     FROM clientes WHERE id = ?`, [id]);
  if (!c) throw erro404('Cliente não encontrado.');

  const veiculos = await q(
    `SELECT id, placa, marca, modelo, cilindrada, ano, ultima_troca, ultimo_km,
            ultimo_oleo, visitas, situacao, filtro_oleo, filtro_ar, filtro_cabine, filtro_combustivel
     FROM veiculos WHERE cliente_id = ? ORDER BY ultima_troca DESC`, [id]);

  res.json({ cliente: c, veiculos });
}));

/* POST /clientes — pode criar o veículo junto, que é como acontece no balcão */
r.post('/', rota(async (req, res) => {
  const c = validar(req.body);

  // aviso de possível duplicado: não bloqueia, mas o atendente precisa saber
  let jaExiste = null;
  if (c.telefone)
    jaExiste = await um('SELECT id, nome FROM clientes WHERE telefone = ? LIMIT 1', [c.telefone]);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [ins] = await conn.query(
      'INSERT INTO clientes (nome, telefone, nascimento, aceita_aviso, obs) VALUES (?,?,?,?,?)',
      [c.nome, c.telefone, c.nascimento, c.aceita_aviso ?? 1, c.obs]);
    const clienteId = ins.insertId;

    let veiculo = null;
    if (req.body?.veiculo) {
      const v = req.body.veiculo;
      const placa = txt(v.placa).toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa)) {
        await conn.rollback();
        throw erro400('Placa inválida. Use ABC1234 ou ABC1D23.');
      }
      const [dup] = await conn.query('SELECT id FROM veiculos WHERE placa = ?', [placa]);
      if (dup.length) {
        await conn.rollback();
        throw erro409(`A placa ${placa} já está cadastrada.`);
      }
      const temFiltro = !!(v.filtro_oleo || v.filtro_ar || v.filtro_cabine || v.filtro_combustivel);
      const [iv] = await conn.query(
        `INSERT INTO veiculos
         (cliente_id, placa, marca, modelo, cilindrada, ano,
          filtro_oleo, filtro_ar, filtro_cabine, filtro_combustivel, filtros_por, filtros_em, obs)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [clienteId, placa, textoAte(v.marca, 'a marca', 40), textoAte(v.modelo, 'o modelo', 80),
         textoAte(v.cilindrada, 'a cilindrada', 4), v.ano ? +v.ano : null,
         (textoAte(v.filtro_oleo, 'o filtro de óleo', 40) || '').toUpperCase() || null,
         (textoAte(v.filtro_ar, 'o filtro de ar', 40) || '').toUpperCase() || null,
         (textoAte(v.filtro_cabine, 'o filtro de cabine', 40) || '').toUpperCase() || null,
         (textoAte(v.filtro_combustivel, 'o filtro de combustível', 40) || '').toUpperCase() || null,
         temFiltro ? req.usuario.username : null,
         temFiltro ? new Date() : null,
         textoAte(v.obs, 'a observação', 255)]);
      veiculo = { id: iv.insertId, placa };
    }

    await conn.commit();
    res.status(201).json({
      cliente: { id: clienteId, ...c },
      veiculo,
      aviso: jaExiste ? `Já existe "${jaExiste.nome}" com este telefone (id ${jaExiste.id}).` : null
    });
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}));

/* PATCH /clientes/:id */
r.patch('/:id', rota(async (req, res) => {
  const id = inteiro(req.params.id, 'o id', { min: 1 });
  const c = validar(req.body, { parcial: true });

  const atual = await um('SELECT id FROM clientes WHERE id = ?', [id]);
  if (!atual) throw erro404('Cliente não encontrado.');

  const campos = Object.keys(c);
  const sets = campos.map(k => `${k} = ?`).join(', ');
  // telefone digitado à mão deixa de ser inferido
  const extra = c.telefone !== undefined ? ', tel_inferido = 0' : '';
  await q(`UPDATE clientes SET ${sets}${extra} WHERE id = ?`, [...campos.map(k => c[k]), id]);

  const novo = await um(
    'SELECT id, nome, telefone, tel_inferido, nascimento, aceita_aviso, obs FROM clientes WHERE id = ?',
    [id]);
  res.json({ cliente: novo });
}));

/* DELETE /clientes/:id — só admin, e avisa o que vai junto */
r.delete('/:id', exigeEscrita('admin'), rota(async (req, res) => {
  const id = inteiro(req.params.id, 'o id', { min: 1 });
  const c = await um('SELECT nome FROM clientes WHERE id = ?', [id]);
  if (!c) throw erro404('Cliente não encontrado.');

  const [cont] = await q(
    `SELECT (SELECT COUNT(*) FROM veiculos WHERE cliente_id = ?) AS veiculos,
            (SELECT COUNT(*) FROM servicos WHERE cliente_id = ?) AS servicos`, [id, id]);

  if (String(req.query.confirmar) !== '1') {
    return res.status(409).json({
      erro: 'Confirme a exclusão.',
      detalhe: `Excluir "${c.nome}" apaga junto ${cont.veiculos} veículo(s) e ` +
               `${cont.servicos} ordem(ns) de serviço.`,
      confirmar_com: `DELETE /api/clientes/${id}?confirmar=1`
    });
  }

  await q('DELETE FROM clientes WHERE id = ?', [id]);
  res.json({ ok: true, removido: { cliente: c.nome, ...cont } });
}));

module.exports = r;
