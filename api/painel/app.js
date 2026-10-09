/* Painel de publicação de novidades — lógica.
 *
 * Esta página NÃO decide nada sozinha: todo pedido passa pela API com o login
 * normal, e publicar/apagar exige admin do lado do servidor. Se alguém sem ser
 * admin abrir esta URL, vê a tela e a API recusa (403) na hora de publicar.
 *
 * O token fica em sessionStorage: fechou a aba, acabou. É a mesma regra do
 * sistema — token não mora em disco.
 */
'use strict';

var CHAVE = 'farias.painel.token';
var token = null;
try { token = sessionStorage.getItem(CHAVE); } catch (e) { /* aba privada */ }

var $ = function (id) { return document.getElementById(id); };

function mostrar(id, sim) { $(id).classList.toggle('oculto', !sim); }

function aviso(el, texto, tipo) {
  el.textContent = texto;
  el.className = 'aviso ' + (tipo || '') + (texto ? '' : ' oculto');
}

/* Toda chamada à API num lugar só, já com o token e o tratamento de erro. */
function api(metodo, rota, corpo) {
  var opc = { method: metodo, headers: {} };
  if (token) opc.headers['Authorization'] = 'Bearer ' + token;
  if (corpo) { opc.headers['Content-Type'] = 'application/json'; opc.body = JSON.stringify(corpo); }
  return fetch('/api' + rota, opc).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (!r.ok) throw new Error(j.erro || ('Erro ' + r.status));
      return j;
    });
  });
}

/* ---------- login ---------- */
function entrar() {
  var u = $('usuario').value.trim();
  var s = $('senha').value;
  if (!u || !s) { aviso($('erro-login'), 'Informe usuário e senha.', 'erro'); return; }
  $('btn-entrar').disabled = true;
  aviso($('erro-login'), '', '');
  api('POST', '/auth/login', { usuario: u, senha: s }).then(function (r) {
    token = r.token;
    try { sessionStorage.setItem(CHAVE, token); } catch (e) {}
    $('senha').value = '';
    $('quem').textContent = 'conectado como ' + (r.usuario && r.usuario.nome ? r.usuario.nome : u);
    entrou();
  }).catch(function (e) {
    aviso($('erro-login'), e.message, 'erro');
  }).then(function () { $('btn-entrar').disabled = false; });
}

function sair() {
  token = null;
  try { sessionStorage.removeItem(CHAVE); } catch (e) {}
  mostrar('cartao-login', true);
  mostrar('cartao-publicar', false);
  mostrar('cartao-lista', false);
}

function entrou() {
  mostrar('cartao-login', false);
  mostrar('cartao-publicar', true);
  mostrar('cartao-lista', true);
  carregarLista();
}

/* ---------- publicar ---------- */
function publicar() {
  var titulo = $('titulo').value.trim();
  var corpo = $('corpo').value.trim();
  if (!titulo || !corpo) {
    aviso($('aviso-publicar'), 'Escreva o título e o que mudou.', 'erro'); return;
  }
  $('btn-publicar').disabled = true;
  aviso($('aviso-publicar'), '', '');
  api('POST', '/novidades', {
    titulo: titulo,
    corpo: corpo,
    versao: $('versao').value.trim() || null,
    a_pedido: $('a_pedido').checked,
    destaque: $('destaque').checked
  }).then(function () {
    $('titulo').value = ''; $('corpo').value = ''; $('versao').value = '';
    $('a_pedido').checked = false; $('destaque').checked = false;
    aviso($('aviso-publicar'), 'Publicado. Já aparece no sino da equipe.', 'ok');
    carregarLista();
  }).catch(function (e) {
    /* 403 = não é admin. A API é quem decide, não esta tela. */
    aviso($('aviso-publicar'),
      e.message.indexOf('403') >= 0 || /admin|permiss/i.test(e.message)
        ? 'Só o administrador pode publicar novidades.'
        : e.message, 'erro');
  }).then(function () { $('btn-publicar').disabled = false; });
}

/* ---------- lista do que já saiu ---------- */
function carregarLista() {
  api('GET', '/novidades').then(function (r) {
    var alvo = $('lista');
    alvo.textContent = '';
    if (!r.novidades || !r.novidades.length) {
      var v = document.createElement('p');
      v.className = 'vazio';
      v.textContent = 'Nada publicado ainda.';
      alvo.appendChild(v);
      return;
    }
    r.novidades.forEach(function (n) { alvo.appendChild(linhaNovidade(n)); });
  }).catch(function () {});
}

/* Monta cada item SEM innerHTML: texto do usuário vai por textContent, então
   um título com < ou > nunca vira marcação. */
function linhaNovidade(n) {
  var div = document.createElement('div');
  div.className = 'nov';

  var topo = document.createElement('div');
  topo.className = 'nov-topo';
  var t = document.createElement('span');
  t.className = 'nov-tit'; t.textContent = n.titulo;
  topo.appendChild(t);
  if (n.versao) { topo.appendChild(tag('tag-v', 'v' + n.versao)); }
  if (n.a_pedido) { topo.appendChild(tag('tag-p', 'o cliente pediu')); }
  div.appendChild(topo);

  var c = document.createElement('p');
  c.className = 'nov-corpo'; c.textContent = n.corpo;
  div.appendChild(c);

  var pe = document.createElement('div');
  pe.className = 'nov-pe';
  var d = document.createElement('span');
  d.className = 'nov-data'; d.textContent = formatarData(n.publicada_em);
  pe.appendChild(d);
  var apagar = document.createElement('button');
  apagar.className = 'btn-g'; apagar.type = 'button'; apagar.textContent = 'Apagar';
  apagar.addEventListener('click', function () { apagarNovidade(n.id, n.titulo); });
  pe.appendChild(apagar);
  div.appendChild(pe);

  return div;
}

function tag(classe, texto) {
  var s = document.createElement('span');
  s.className = 'tag ' + classe; s.textContent = texto;
  return s;
}

function apagarNovidade(id, titulo) {
  /* confirm() do navegador é aceitável aqui: é a ferramenta interna do Pedro,
     não a tela da oficina. */
  if (!window.confirm('Apagar a novidade "' + titulo + '"?')) return;
  api('DELETE', '/novidades/' + id).then(carregarLista).catch(function (e) {
    aviso($('aviso-publicar'), e.message, 'erro');
  });
}

function formatarData(iso) {
  try {
    var d = new Date(iso);
    return d.toLocaleDateString('pt-BR') + ' ' +
           d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return iso; }
}

/* ---------- ligações ---------- */
$('btn-entrar').addEventListener('click', entrar);
$('senha').addEventListener('keyup', function (e) { if (e.key === 'Enter') entrar(); });
$('btn-publicar').addEventListener('click', publicar);
$('btn-sair').addEventListener('click', sair);

/* Se já tem token da sessão, tenta entrar direto. Se o token estiver velho,
   a primeira chamada devolve 401 e volta para o login. */
if (token) {
  api('GET', '/auth/eu').then(function (r) {
    $('quem').textContent = 'conectado como ' + (r.usuario && r.usuario.nome ? r.usuario.nome : '');
    entrou();
  }).catch(sair);
}
