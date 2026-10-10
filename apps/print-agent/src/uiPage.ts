/** Tela do agente (HTML único, sem dependências). O JS usa concatenação de texto para não conflitar com o template literal. */
export const PAGE = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pediu Agente de Impressão</title>
<style>
  :root { --p:#0091ff; --bg:#f4f7fb; --fg:#0f172a; --mut:#64748b; --bd:#e2e8f0; --ok:#16a34a; --warn:#d97706; --bad:#dc2626; }
  * { box-sizing: border-box; }
  body { margin:0; font:16px/1.45 system-ui,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; background:var(--bg); color:var(--fg); }
  header { background:#fff; border-bottom:1px solid var(--bd); padding:14px 20px; display:flex; align-items:center; gap:12px; }
  header h1 { font-size:18px; margin:0; flex:1; }
  header small { color:var(--mut); }
  main { max-width:760px; margin:20px auto; padding:0 16px 40px; display:grid; gap:16px; }
  .card { background:#fff; border:1px solid var(--bd); border-radius:16px; padding:18px; }
  .card h2 { margin:0 0 4px; font-size:17px; }
  .muted { color:var(--mut); font-size:14px; margin:0 0 12px; }
  label { display:block; font-size:14px; font-weight:600; margin:10px 0 4px; }
  input, select { width:100%; padding:11px 14px; border:1px solid var(--bd); border-radius:999px; font:inherit; background:#fff; }
  input:focus { outline:2px solid var(--p); border-color:transparent; }
  button { font:inherit; font-weight:600; border:0; border-radius:999px; padding:11px 20px; background:var(--p); color:#fff; cursor:pointer; }
  button.ghost { background:#fff; color:var(--fg); border:1px solid var(--bd); }
  button.danger { background:#fff; color:var(--bad); border:1px solid #fecaca; }
  button:disabled { opacity:.5; cursor:default; }
  .pill { display:inline-flex; align-items:center; gap:6px; padding:5px 12px; border-radius:999px; font-size:14px; font-weight:600; }
  .pill i { width:9px; height:9px; border-radius:50%; background:currentColor; }
  .ok { background:#dcfce7; color:#166534; } .warn { background:#fef3c7; color:#92400e; } .bad { background:#fee2e2; color:#991b1b; } .off { background:#e2e8f0; color:#475569; }
  .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .row > .grow { flex:1; min-width:160px; }
  .item { display:flex; align-items:center; gap:10px; padding:10px 0; border-top:1px solid var(--bd); }
  .item:first-child { border-top:0; }
  .item b { display:block; } .item span { color:var(--mut); font-size:13px; }
  .msg { margin-top:10px; padding:10px 14px; border-radius:12px; font-size:14px; }
  .msg.e { background:#fee2e2; color:#991b1b; } .msg.s { background:#dcfce7; color:#166534; }
  pre { margin:0; max-height:180px; overflow:auto; background:#0f172a; color:#e2e8f0; padding:12px; border-radius:12px; font-size:12px; white-space:pre-wrap; }
  ol { margin:6px 0 0 18px; padding:0; color:var(--mut); font-size:14px; }
  .hide { display:none; }
  .big { text-align:center; padding:28px 20px; border:2px solid var(--p); }
  .big .ico { width:72px; height:72px; margin:0 auto 12px; border-radius:50%; background:#e0f2fe; color:var(--p); display:flex; align-items:center; justify-content:center; font-size:38px; }
  .big.done { border-color:var(--ok); } .big.done .ico { background:#dcfce7; color:var(--ok); }
  .big h2 { font-size:24px; margin:0 0 6px; } .big .muted { font-size:15px; }
  .big button { font-size:20px; padding:16px 44px; margin-top:8px; }
  .big #autoMsgPair .msg { text-align:left; }
</style></head>
<body>
<header><h1>Pediu Agente de Impressão</h1><small>versão __VERSION__</small><span id="pill" class="pill off"><i></i><span>Carregando…</span></span></header>
<main>
  <section class="card big hide" id="oneCard">
    <div class="ico" id="oneIco">🔌</div>
    <h2 id="oneTitle">Conectar este computador?</h2>
    <p class="muted" id="oneInfo"></p>
    <button id="oneBtn">Conectar</button>
    <div id="autoMsgPair"></div>
  </section>

  <section class="card" id="pairCard">
    <h2>1. Conectar este computador à sua loja</h2>
    <p class="muted">Você só faz isso uma vez. Depois o agente liga sozinho e continua conectado.</p>
    <p style="margin:0 0 8px"><b>Jeito mais fácil:</b> neste computador, abra o painel da sua loja, entre em <b>Impressão</b> e clique em <b>Conectar este computador</b>. O resto é automático.</p>
    <details id="manual"><summary style="cursor:pointer;font-weight:600">Conectar digitando o código</summary>
      <ol><li>No painel da loja, abra <b>Impressão</b> e clique em <b>Conectar este computador</b>.</li><li>Abra <b>Conectar com código</b> e copie o endereço e o código de 6 dígitos para os campos abaixo.</li></ol>
      <label for="url">Endereço da sua loja</label><input id="url" placeholder="https://minhaloja.com.br" inputmode="url">
      <label for="code">Código do painel</label><input id="code" placeholder="000000" inputmode="numeric" maxlength="7">
      <label for="name">Nome deste computador</label><input id="name" placeholder="Caixa">
      <div class="row" style="margin-top:14px"><button id="pairBtn">Conectar</button></div>
      <div id="pairMsg"></div>
    </details>
  </section>

  <section class="card hide" id="linkCard">
    <h2>Conectado à sua loja</h2>
    <p class="muted" id="linkInfo"></p>
    <div class="row"><button class="danger" id="unpairBtn">Desconectar este computador</button></div>
    <div id="linkMsg"></div>
  </section>

  <section class="card">
    <div class="row"><div class="grow"><h2>2. Impressoras deste computador</h2><p class="muted" style="margin:0">É isso que o painel enxerga quando você clica em “Puxar impressoras”.</p></div><button class="ghost" id="refresh">Atualizar</button></div>
    <div id="printers" style="margin-top:8px"></div>
    <div id="testMsg"></div>
    <details style="margin-top:12px"><summary style="cursor:pointer;font-weight:600">Impressora de rede (IP) — testar sem o painel</summary>
      <div class="row" style="margin-top:8px"><div class="grow"><input id="ip" placeholder="192.168.0.50:9100"></div><button class="ghost" id="ipTest">Imprimir teste</button></div>
    </details>
  </section>

  <section class="card">
    <h2>3. Iniciar junto com o computador</h2>
    <p class="muted">Assim o agente já está ligado quando a loja abrir, sem ninguém precisar lembrar.</p>
    <div class="row"><span id="autoPill" class="pill off"><i></i><span>…</span></span><button class="ghost" id="autoBtn">Ligar</button></div>
    <div id="autoMsg"></div>
  </section>

  <section class="card">
    <h2>Últimos pedidos impressos</h2>
    <div id="jobs"><p class="muted">Nada impresso ainda.</p></div>
    <details style="margin-top:10px"><summary style="cursor:pointer;color:var(--mut)">Registro técnico</summary><pre id="logs"></pre></details>
  </section>
</main>
<script>
(function () {
  var TOKEN = '__TOKEN__';
  var $ = function (id) { return document.getElementById(id); };
  function api(method, path, body) {
    return fetch(path, { method: method, headers: { 'x-ui-token': TOKEN, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Erro ' + r.status); return j; }); });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function msg(id, kind, text) { $(id).innerHTML = text ? '<div class="msg ' + kind + '">' + esc(text) + '</div>' : ''; }
  var LABEL = { 'sem-pareamento': ['off', 'Não pareado'], conectando: ['warn', 'Conectando…'], conectado: ['ok', 'Conectado'], reconectando: ['warn', 'Reconectando…'], recusado: ['bad', 'Pareamento recusado'], removido: ['bad', 'Removido no painel'] };
  var first = true;
  // Conexão com um clique: o painel abre esta tela com #conectar?url=…&code=…&loja=… (o # não vai para servidor nenhum e sai da barra de endereço na hora).
  // A pessoa confirma no botão: nenhum site consegue ligar este computador a uma loja sem ela ver.
  var one = null, oneDone = false;
  (function () {
    var m = /^#conectar\\?(.*)$/.exec(location.hash || '');
    if (!m) return;
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* segue com o # na barra */ }
    var q = new URLSearchParams(m[1]), url = (q.get('url') || '').trim(), code = (q.get('code') || '').replace(/\\D/g, '');
    if (!/^https?:\\/\\/[^\\s\\/]+$/i.test(url) || code.length !== 6) return;
    one = { url: url, code: code, loja: (q.get('loja') || '').slice(0, 80) };
  })();
  function renderOne(s) {
    if (!one) return;
    var same = s.paired && s.store.url === one.url && s.status !== 'recusado' && s.status !== 'removido';
    if (oneDone || same) {
      $('oneCard').className = 'card big done'; $('oneIco').textContent = '✓';
      $('oneTitle').textContent = 'Pronto! Computador conectado';
      $('oneInfo').textContent = 'Pode fechar esta aba e voltar para o painel da loja. O agente continua ligado sozinho.';
      $('oneBtn').className = 'hide'; $('pairCard').className = 'card hide';
      return;
    }
    $('oneCard').className = 'card big';
    $('oneTitle').textContent = one.loja ? 'Conectar à loja ' + one.loja + '?' : 'Conectar este computador à loja?';
    $('oneInfo').textContent = one.url + (s.paired ? ' · Este computador hoje está ligado a ' + s.store.url + ' e vai passar para a loja acima.' : ' · Os pedidos desta loja vão sair nas impressoras deste computador.');
    $('pairCard').className = 'card hide';
  }

  function render(s) {
    var l = LABEL[s.status] || ['off', s.status];
    $('pill').className = 'pill ' + l[0]; $('pill').lastChild.textContent = l[1];
    $('pairCard').className = 'card' + (s.paired && s.status !== 'recusado' && s.status !== 'removido' ? ' hide' : '');
    $('linkCard').className = 'card' + (s.paired ? '' : ' hide');
    if (s.paired) $('linkInfo').textContent = s.store.url + ' · este computador aparece como “' + s.store.name + '”.' + (s.status === 'recusado' || s.status === 'removido' ? ' O painel não reconhece mais este pareamento: gere um código novo e conecte de novo.' : '');
    if (first) { $('name').value = s.defaultName || ''; first = false; }
    renderOne(s);
    $('autoPill').className = 'pill ' + (s.autostart ? 'ok' : 'off'); $('autoPill').lastChild.textContent = s.autostart ? 'Ligado' : 'Desligado';
    $('autoBtn').textContent = s.autostart ? 'Desligar' : 'Ligar'; $('autoBtn').dataset.on = s.autostart ? '1' : '';
    $('jobs').innerHTML = s.jobs.length ? s.jobs.map(function (j) {
      return '<div class="item"><span class="pill ' + (j.ok ? 'ok' : 'bad') + '"><i></i>' + (j.ok ? 'Impresso' : 'Falhou') + '</span><div><b>' + esc(j.kind) + ' · ' + esc(j.printer) + '</b><span>' + new Date(j.at).toLocaleTimeString('pt-BR') + (j.error ? ' · ' + esc(j.error) : '') + '</span></div></div>';
    }).join('') : '<p class="muted">Nada impresso ainda.</p>';
    $('logs').textContent = s.logs.join('\\n');
  }
  function poll() { api('GET', '/api/status').then(render).catch(function () { $('pill').className = 'pill bad'; $('pill').lastChild.textContent = 'Agente parou'; }); }

  function loadPrinters() {
    $('printers').innerHTML = '<p class="muted">Procurando…</p>';
    api('GET', '/api/printers').then(function (r) {
      if (!r.printers.length) { $('printers').innerHTML = '<p class="muted">Nenhuma impressora encontrada neste computador. Se a sua é de rede, use o teste por IP abaixo.</p>'; return; }
      $('printers').innerHTML = r.printers.map(function (p, i) {
        return '<div class="item"><div style="flex:1"><b>' + esc(p.name) + '</b><span>' + esc(p.detail || p.kind) + '</span></div><button class="ghost" data-i="' + i + '">Imprimir teste</button></div>';
      }).join('');
      Array.prototype.forEach.call($('printers').querySelectorAll('button'), function (b) {
        b.onclick = function () { var p = r.printers[Number(b.dataset.i)]; test(p.kind === 'windows' ? 'windows' : 'cups', p.name); };
      });
    }).catch(function (e) { $('printers').innerHTML = ''; msg('testMsg', 'e', e.message); });
  }
  function test(connection, address) {
    msg('testMsg', 's', 'Enviando teste…');
    api('POST', '/api/test', { connection: connection, address: address }).then(function (r) {
      if (r.ok) msg('testMsg', 's', 'Teste enviado. Confira se o cupom saiu.');
      else msg('testMsg', 'e', r.error + (connection === 'windows' ? ' (No Windows a impressora precisa estar compartilhada.)' : ''));
    }).catch(function (e) { msg('testMsg', 'e', e.message); });
  }

  $('pairBtn').onclick = function () {
    $('pairBtn').disabled = true; msg('pairMsg', '', '');
    api('POST', '/api/pair', { url: $('url').value, code: $('code').value, name: $('name').value }).then(function () { $('code').value = ''; poll(); })
      .catch(function (e) { msg('pairMsg', 'e', e.message); }).then(function () { $('pairBtn').disabled = false; });
  };
  $('oneBtn').onclick = function () {
    if (!one) return;
    $('oneBtn').disabled = true; $('oneBtn').textContent = 'Conectando…'; msg('autoMsgPair', '', '');
    api('POST', '/api/pair', { url: one.url, code: one.code, name: '' }).then(function () {
      oneDone = true; poll();
      // já deixa ligado para abrir junto com o computador (dá para desligar no item 3)
      return api('POST', '/api/autostart', { on: true }).then(poll).catch(function () { /* sem início automático: a pessoa liga no item 3 */ });
    }).catch(function (e) {
      $('oneBtn').disabled = false; $('oneBtn').textContent = 'Tentar de novo';
      msg('autoMsgPair', 'e', e.message + ' Volte ao painel e clique em “Conectar este computador” para gerar um código novo.');
    });
  };
  $('unpairBtn').onclick = function () { if (confirm('Desconectar este computador da loja? Os pedidos deixam de sair aqui até parear de novo.')) api('POST', '/api/unpair').then(poll).catch(function (e) { msg('linkMsg', 'e', e.message); }); };
  $('refresh').onclick = loadPrinters;
  $('ipTest').onclick = function () { test('rede', $('ip').value); };
  $('autoBtn').onclick = function () { api('POST', '/api/autostart', { on: !$('autoBtn').dataset.on }).then(function (r) { msg('autoMsg', 's', r.message); poll(); }).catch(function (e) { msg('autoMsg', 'e', e.message); }); };

  poll(); loadPrinters(); setInterval(poll, 2000);
})();
</script></body></html>`;
