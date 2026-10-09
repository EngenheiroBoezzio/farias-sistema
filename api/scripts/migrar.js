/* ===========================================================
   Migração: Planilha1 -> MariaDB
   Lê a planilha inteira, normaliza, deduplica e carrega.
   Roda quantas vezes quiser: usa UPSERT, não duplica.

   node scripts/migrar.js /caminho/PLANILHA.xlsx
   =========================================================== */
'use strict';
require('../src/ambiente');
const path = require('path');
const XLSX = require('xlsx');
const mysql = require('mysql2/promise');

const HOJE = new Date();
const INTERVALO_DIAS = 219;          // intervalo real medido na base da Farias
const DDD_PADRAO = '55';             // Santa Maria/RS

/* ---------- normalizadores ---------- */
const limpa = v => String(v ?? '').replace(/\s+/g, ' ').trim();

const titulo = s => limpa(s).toLowerCase()
  .replace(/(^|\s|')([a-zà-ú])/g, (_, a, b) => a + b.toUpperCase());

function normPlaca(v) {
  const p = limpa(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p) ? p : (p.length >= 6 ? p.slice(0, 8) : null);
}

/** Devolve [telefone13, foiInferido] — inferido = o DDD foi deduzido. */
function normTelefone(v) {
  if (v == null || v === '') return [null, 0];
  let d = String(typeof v === 'number' ? Math.trunc(v) : v).replace(/\D/g, '');
  let inferido = 0;
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length === 9 && d[0] === '9') { d = DDD_PADRAO + d; inferido = 1; }
  else if (d.length === 8 && '6789'.includes(d[0])) { d = DDD_PADRAO + '9' + d; inferido = 1; }
  else if (d.length === 10 && '6789'.includes(d[2])) d = d.slice(0, 2) + '9' + d.slice(2);
  else if (d.length !== 11) return [null, 0];
  if (d.length !== 11 || d[2] !== '9') return [null, 0];
  return ['55' + d, inferido];
}

/** "35,729+5" -> 35729 · descarta absurdo */
function normKm(v) {
  if (v == null) return null;
  const s = String(v).split('+')[0].replace(/[^\d]/g, '');
  if (!s) return null;
  const n = parseInt(s, 10);
  return n > 100 && n < 999999 ? n : null;
}

function normData(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  if (typeof v === 'number') {                       // serial do Excel
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return isNaN(d) ? null : d;
  }
  return null;
}

const iso = d => d ? d.toISOString().slice(0, 10) : null;

function normValor(v) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  return v > 0 && v < 5000 ? Number(v.toFixed(2)) : null;
}

/** A coluna F.CABINE virou campo livre: "ANEL 10,00", "PALHETA 49,00".
 *  Separa em itens com valor. Devolve [] quando é só um preço solto. */
function extrairItens(v) {
  const s = limpa(v).toUpperCase();
  if (!s || /^[\d.,]+$/.test(s)) return [];
  const itens = [];
  const re = /([A-ZÇÃÕÁÉÍÓÚÂÊÔ][A-ZÇÃÕÁÉÍÓÚÂÊÔ.\s/+]{1,28}?)\s*(\d{1,4}[,.]\d{2})/g;
  let m;
  while ((m = re.exec(s))) {
    const desc = m[1].replace(/[\s.+/]+$/, '').trim();
    const valor = Number(m[2].replace(',', '.'));
    if (desc.length >= 3) itens.push({ descricao: desc.slice(0, 60), valor: valor || null });
  }
  if (!itens.length && s.length >= 3)          // texto sem valor: guarda mesmo assim
    itens.push({ descricao: s.slice(0, 60), valor: null });
  return itens;
}

/** "IDEIA 2010 1.8" -> {modelo:'Ideia', ano:2010, cilindrada:'1.8'} */
function partesCarro(v) {
  const t = limpa(v).toUpperCase();
  if (!t) return { modelo: null, ano: null, cilindrada: null };
  const ano = (t.match(/\b(19[89]\d|20[0-3]\d)\b/) || [])[1];
  const cil = (t.match(/\b([0-9])[.,]([0-9])\b/) || []).slice(1).join('.') || null;
  const modelo = titulo(t.replace(/\b(19[89]\d|20[0-3]\d)\b/g, '')
                        .replace(/\b[0-9][.,][0-9]\b/g, '')) || null;
  return { modelo, ano: ano ? +ano : null, cilindrada: cil };
}

function situacaoPor(ultima) {
  if (!ultima) return null;
  const dias = Math.floor((HOJE - ultima) / 86400000);
  if (dias <= INTERVALO_DIAS) return 'em_dia';
  if (dias <= 365) return 'vencido';
  if (dias <= 730) return 'parado';
  return 'frio';
}

/* ---------- migração ---------- */
async function main() {
  const arquivo = process.argv[2];
  if (!arquivo) { console.error('uso: node scripts/migrar.js <planilha.xlsx>'); process.exit(1); }

  const wb = XLSX.readFile(arquivo, { cellDates: true });
  const ws = wb.Sheets['Planilha1'];
  if (!ws) { console.error('aba "Planilha1" não encontrada'); process.exit(1); }

  // cabeçalho na linha 5, dados a partir da 6
  const linhas = XLSX.utils.sheet_to_json(ws, { header: 1, range: 4, blankrows: false });
  const [cab, ...corpo] = linhas;
  const col = {};
  cab.forEach((c, i) => { if (c) col[limpa(c).toUpperCase()] = i; });

  const pega = (r, nome) => r[col[nome]];
  const stats = { lidas: corpo.length, semNome: 0, semPlaca: 0, semData: 0, futuras: 0, ok: 0 };

  const clientes = new Map();   // nomeChave -> dados
  const veiculos = new Map();   // placa -> dados
  const servicos = [];

  for (const r of corpo) {
    const nome = titulo(pega(r, 'NOME'));
    const placa = normPlaca(pega(r, 'PLACA'));
    const data = normData(pega(r, 'DATA'));

    if (!nome) { stats.semNome++; continue; }
    if (!placa) { stats.semPlaca++; continue; }
    if (!data) { stats.semData++; continue; }
    if (data > HOJE) { stats.futuras++; continue; }

    const [tel, inferido] = normTelefone(pega(r, 'TELEFONE'));
    const nasc = normData(pega(r, 'DATA NASC.'));
    const km = normKm(pega(r, 'KM'));
    const carro = partesCarro(pega(r, 'CARRO'));

    const chaveCli = nome.toUpperCase();
    const cli = clientes.get(chaveCli) || { nome, telefone: null, tel_inferido: 0, nascimento: null };
    if (tel && !cli.telefone) { cli.telefone = tel; cli.tel_inferido = inferido; }
    if (nasc && !cli.nascimento) cli.nascimento = nasc;
    clientes.set(chaveCli, cli);

    const v = veiculos.get(placa) || {
      placa, cliente: chaveCli, modelo: carro.modelo, marca: null,
      cilindrada: carro.cilindrada, ano: carro.ano,
      ultima_troca: null, ultimo_km: null, ultimo_oleo: null, visitas: 0
    };
    v.visitas++;
    if (!v.modelo && carro.modelo) v.modelo = carro.modelo;
    if (!v.cilindrada && carro.cilindrada) v.cilindrada = carro.cilindrada;
    if (!v.ano && carro.ano) v.ano = carro.ano;
    if (!v.ultima_troca || data > v.ultima_troca) {
      v.ultima_troca = data;
      v.ultimo_km = km ?? v.ultimo_km;
      v.ultimo_oleo = limpa(pega(r, 'OLEO')).toUpperCase() || v.ultimo_oleo;
    }
    veiculos.set(placa, v);

    const corte = t => t ? String(t).slice(0, 60) : null;
    servicos.push({
      placa, cliente: chaveCli, data, km,
      oleo: limpa(pega(r, 'OLEO')).toUpperCase().slice(0, 30) || null,
      litros: typeof pega(r, 'Q.LITROS') === 'number' ? pega(r, 'Q.LITROS') : null,
      // A planilha usa estas colunas para PREÇO (e às vezes código junto).
      // Entram cruas; separar-valor-codigo.js reparte em valor_/cod_.
      bruto_filtro_oleo: corte(limpa(pega(r, 'F.OLEO'))) || null,
      bruto_filtro_ar: corte(limpa(pega(r, 'F.AR'))) || null,
      extras_bruto: corte(limpa(pega(r, 'F.CABINE'))) || null,
      total: normValor(pega(r, 'TOTAL')),
      itens: extrairItens(pega(r, 'F.CABINE'))
    });
    stats.ok++;
  }

  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'farias',
    multipleStatements: false
  });

  console.log(`\nlidas ${stats.lidas} · aproveitadas ${stats.ok}`);
  console.log(`descartadas: sem nome ${stats.semNome} · sem placa ${stats.semPlaca} · ` +
              `sem data ${stats.semData} · data futura ${stats.futuras}`);
  console.log(`clientes ${clientes.size} · veículos ${veiculos.size} · serviços ${servicos.length}\n`);

  // DELETE em vez de TRUNCATE: o usuário da API não tem (nem deve ter) DROP.
  // Na ordem das dependências, para não brigar com as chaves estrangeiras.
  for (const t of ['itens_servico', 'servicos', 'veiculos', 'clientes']) {
    const [r] = await db.query(`DELETE FROM ${t}`);
    if (r.affectedRows) console.log(`  limpou ${r.affectedRows} de ${t}`);
    await db.query(`ALTER TABLE ${t} AUTO_INCREMENT = 1`).catch(() => {});
  }

  // --- clientes em lote ---
  const idCliente = new Map();
  const listaCli = [...clientes.entries()];
  for (let i = 0; i < listaCli.length; i += 500) {
    const fatia = listaCli.slice(i, i + 500);
    const [res] = await db.query(
      'INSERT INTO clientes (nome, telefone, tel_inferido, nascimento) VALUES ?',
      [fatia.map(([, c]) => [c.nome, c.telefone, c.tel_inferido, iso(c.nascimento)])]
    );
    fatia.forEach(([chave], j) => idCliente.set(chave, res.insertId + j));
  }
  console.log(`clientes inseridos: ${idCliente.size}`);

  // --- veículos em lote ---
  const idVeiculo = new Map();
  const listaVei = [...veiculos.values()];
  for (let i = 0; i < listaVei.length; i += 500) {
    const fatia = listaVei.slice(i, i + 500);
    const [res] = await db.query(
      `INSERT INTO veiculos
       (cliente_id, placa, modelo, cilindrada, ano, ultima_troca, ultimo_km, ultimo_oleo, visitas, situacao)
       VALUES ?`,
      [fatia.map(v => [
        idCliente.get(v.cliente), v.placa, v.modelo, v.cilindrada, v.ano,
        iso(v.ultima_troca), v.ultimo_km, v.ultimo_oleo, v.visitas, situacaoPor(v.ultima_troca)
      ])]
    );
    fatia.forEach((v, j) => idVeiculo.set(v.placa, res.insertId + j));
  }
  console.log(`veículos inseridos: ${idVeiculo.size}`);

  // --- serviços em lote, guardando o id para ligar os itens ---
  let n = 0, nItens = 0;
  for (let i = 0; i < servicos.length; i += 1000) {
    const fatia = servicos.slice(i, i + 1000);
    const [res] = await db.query(
      `INSERT INTO servicos
       (veiculo_id, cliente_id, data, km, oleo, litros, bruto_filtro_oleo, bruto_filtro_ar, extras_bruto, total)
       VALUES ?`,
      [fatia.map(s => [
        idVeiculo.get(s.placa), idCliente.get(s.cliente), iso(s.data), s.km, s.oleo,
        s.litros, s.bruto_filtro_oleo, s.bruto_filtro_ar, s.extras_bruto, s.total
      ])]
    );
    // insertId é o primeiro da fatia; os demais seguem em sequência
    const itens = [];
    fatia.forEach((s, j) => {
      for (const it of s.itens) itens.push([res.insertId + j, it.descricao, it.valor, 'planilha']);
    });
    if (itens.length) {
      await db.query('INSERT INTO itens_servico (servico_id, descricao, valor, origem) VALUES ?', [itens]);
      nItens += itens.length;
    }
    n += fatia.length;
  }
  console.log(`serviços inseridos: ${n}`);
  console.log(`itens extras recuperados: ${nItens}`);

  const [[r]] = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM clientes) AS clientes,
       (SELECT COUNT(*) FROM veiculos) AS veiculos,
       (SELECT COUNT(*) FROM servicos) AS servicos,
       (SELECT COUNT(*) FROM veiculos WHERE situacao='vencido') AS vencidos,
       (SELECT COUNT(*) FROM clientes WHERE telefone IS NOT NULL) AS com_tel,
       (SELECT COUNT(*) FROM clientes WHERE tel_inferido=1) AS ddd_inferido,
       (SELECT COUNT(*) FROM clientes WHERE nascimento IS NOT NULL) AS com_nasc`);
  console.log('\nno banco:', r);
  console.log(`\natenção: ${r.ddd_inferido} telefones tiveram o DDD deduzido como ${DDD_PADRAO} ` +
              `— confira no balcão antes de usar para aviso.`);
  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
