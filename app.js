/* Hardware Runway Planner: UI wiring. All cash maths lives in lib/runway.js. */
(function () {
  'use strict';
  var R = window.Runway;
  var TEMPLATES = window.RUNWAY_TEMPLATES;
  var STORAGE_KEY = 'hrp.plan.v1';
  var SETUP_FIELDS = ['company', 'startingCash', 'startMonth', 'baseBurn', 'raiseAmount', 'raiseMonth'];

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    template: $('template'), stages: $('stages'), add: $('btn-add'), sentence: $('sentence'), cards: $('cards'),
    gantt: $('gantt'), chart: $('chart'), chartFallback: $('chartFallback'), table: $('cashTable'),
    tableDetails: $('tableDetails'), toast: $('toast'), announce: $('announce'), stageTotals: $('stageTotals'),
    raiseHint: $('raiseHint'), truncNote: $('truncNote')
  };

  /* ---------- state ---------- */
  // `raw` holds exactly what the user typed (strings allowed); everything shown comes from the normalised copy.
  var raw;
  var idCounter = 0;
  var chart = null;
  var toastTimer = null;

  function newId() { idCounter += 1; return 'st' + idCounter; }

  function defaultRaw() {
    var s = clone(TEMPLATES.generic.state);
    s.startMonth = nextMonthKey();
    s.stages.forEach(function (st) { st.id = newId(); });
    return s;
  }
  function nextMonthKey() {
    var d = R.addMonths(R.currentMonthKey(), 1);
    return d.year + '-' + String(d.month).padStart(2, '0');
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function adopt(state) { // normalised state -> fresh raw with unique ids
    var s = clone(state);
    s.stages.forEach(function (st) { st.id = newId(); });
    return s;
  }

  function load() {
    var m = /[#&]plan=([^&]+)/.exec(location.hash);
    if (m) {
      var shared = R.decodeState(m[1]);
      if (shared) return adopt(shared);
    }
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        var res = R.normalizeState(JSON.parse(saved));
        return adopt(res.state);
      }
    } catch (e) { /* storage blocked or corrupt: fall through to defaults */ }
    return defaultRaw();
  }

  function save(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }

  /* ---------- helpers ---------- */
  function h(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === false || v === null || v === undefined) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else n.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  var ICONS = {
    up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="3"/>'
  };
  function iconButton(kind, label, extra) {
    var b = h('button', Object.assign({ type: 'button', class: 'icon-btn ' + (extra && extra.class || ''), 'aria-label': label, title: label }, extra && extra.attrs));
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + ICONS[kind] + '</svg>';
    return b;
  }

  function announce(msg) { el.announce.textContent = ''; setTimeout(function () { el.announce.textContent = msg; }, 30); }
  function toast(msg) {
    el.toast.textContent = msg; el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 2600);
    announce(msg);
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  /* ---------- setup form ---------- */
  function writeSetup() {
    SETUP_FIELDS.forEach(function (f) { $(f).value = raw[f] === undefined ? '' : raw[f]; });
  }

  function bindSetup() {
    SETUP_FIELDS.forEach(function (f) {
      var input = $(f);
      input.addEventListener('input', function () { raw[f] = input.value; update(); });
      input.addEventListener('change', function () { // commit: replace invalid text with the safe value
        var res = R.normalizeState(raw);
        if (res.errors.some(function (e) { return e.field === f; })) { raw[f] = res.state[f]; input.value = res.state[f]; }
        update();
      });
    });
  }

  /* ---------- stage editor ---------- */
  function stageIndex(id) { return raw.stages.findIndex(function (s) { return s.id === id; }); }

  function renderStages(focus) {
    el.stages.textContent = '';
    var n = raw.stages.length;
    raw.stages.forEach(function (st, i) {
      var uid = st.id;
      var name = st.name || 'Stage ' + (i + 1);
      var path = 'stages.' + i + '.';
      var nameIn = h('input', { type: 'text', id: uid + '-name', maxlength: 60, 'data-field': path + 'name', autocomplete: 'off' });
      nameIn.value = st.name;
      var grip = iconButton('grip', 'Reorder ' + name + ': drag, or press arrow up or down', { class: 'grip handle', attrs: { 'data-act': 'grip', 'aria-keyshortcuts': 'ArrowUp ArrowDown' } });
      var up = iconButton('up', 'Move ' + name + ' up', { attrs: { 'data-act': 'up' } });
      var down = iconButton('down', 'Move ' + name + ' down', { attrs: { 'data-act': 'down' } });
      var del = iconButton('trash', 'Delete ' + name, { attrs: { 'data-act': 'del' } });
      if (i === 0) up.disabled = true;
      if (i === n - 1) down.disabled = true;
      if (n === 1) { del.disabled = true; del.title = 'At least one stage is required'; }

      function numField(key, label, step, money, max) {
        var input = h('input', { type: 'number', id: uid + '-' + key, inputmode: 'numeric', min: key === 'duration' ? 1 : 0, max: max, step: step, 'data-field': path + key });
        input.value = st[key];
        var wrap = money ? h('div', { class: 'money' }, [h('span', { 'aria-hidden': 'true', text: '$' }), input]) : input;
        return h('div', { class: 'field' }, [h('label', { for: uid + '-' + key, text: label }), wrap, h('p', { class: 'err', id: 'err-' + path + key })]);
      }
      var derIn = h('input', { type: 'text', id: uid + '-derisks', maxlength: 200, 'data-field': path + 'derisks', placeholder: 'What this stage proves' });
      derIn.value = st.derisks || '';

      var li = h('li', { class: 'stage', 'data-id': uid, role: 'group', 'aria-label': 'Stage ' + (i + 1) + ': ' + name }, [
        h('div', { class: 'stage-head' }, [
          grip, h('span', { class: 'stage-num', 'aria-hidden': 'true', text: String(i + 1) }),
          h('div', { class: 'stage-actions' }, [up, down, del]),
          h('div', { class: 'field name' }, [h('label', { for: uid + '-name', text: 'Stage name' }), nameIn, h('p', { class: 'err', id: 'err-' + path + 'name' })])
        ]),
        h('div', { class: 'stage-fields' }, [
          numField('duration', 'Duration (months)', 1, false, R.LIMITS.MAX_DURATION),
          numField('cost', 'One-time cost', 5000, true, R.LIMITS.MAX_MONEY),
          numField('extraBurn', 'Extra burn / month', 1000, true, R.LIMITS.MAX_MONEY),
          h('div', { class: 'field' }, [h('label', { for: uid + '-derisks', text: 'De-risks' }), derIn])
        ])
      ]);
      el.stages.appendChild(li);
    });
    el.add.disabled = n >= R.LIMITS.MAX_STAGES;
    el.add.title = n >= R.LIMITS.MAX_STAGES ? 'Maximum of ' + R.LIMITS.MAX_STAGES + ' stages' : '';
    if (focus) focusStage(focus.id, focus.act);
    update();
  }

  function focusStage(id, act) {
    var li = el.stages.querySelector('[data-id="' + id + '"]');
    if (!li) return;
    var target = act === 'name' ? li.querySelector('input[data-field$=".name"]') : li.querySelector('[data-act="' + act + '"]');
    if (target && target.disabled) target = li.querySelector('[data-act="grip"]');
    if (target) { target.focus(); if (act === 'name') target.select(); }
  }

  function moveStage(id, delta, act) {
    var from = stageIndex(id), to = from + delta;
    if (from < 0 || to < 0 || to >= raw.stages.length) return;
    raw.stages = R.moveItem(raw.stages, from, to);
    renderStages({ id: id, act: act });
    announce((raw.stages[to].name || 'Stage') + ' moved to position ' + (to + 1) + ' of ' + raw.stages.length);
  }

  function bindStages() {
    el.stages.addEventListener('input', function (e) {
      var f = e.target.getAttribute('data-field'); if (!f) return;
      var li = e.target.closest('li.stage'); var st = raw.stages[stageIndex(li.getAttribute('data-id'))];
      st[f.split('.')[2]] = e.target.value;
      update();
    });
    el.stages.addEventListener('change', function (e) { // commit: write safe values back into invalid fields
      var f = e.target.getAttribute('data-field'); if (!f) return;
      var res = R.normalizeState(raw);
      if (res.errors.some(function (er) { return er.field === f; })) {
        var parts = f.split('.'); var i = Number(parts[1]);
        raw.stages[i][parts[2]] = res.state.stages[i][parts[2]];
        e.target.value = res.state.stages[i][parts[2]];
        update();
      }
    });
    el.stages.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]'); if (!btn) return;
      var id = btn.closest('li.stage').getAttribute('data-id'); var act = btn.getAttribute('data-act');
      if (act === 'up') moveStage(id, -1, 'up');
      else if (act === 'down') moveStage(id, 1, 'down');
      else if (act === 'del') deleteStage(id);
    });
    el.stages.addEventListener('keydown', function (e) {
      var grip = e.target.closest('button[data-act="grip"]'); if (!grip) return;
      var id = grip.closest('li.stage').getAttribute('data-id');
      if (e.key === 'ArrowUp') { e.preventDefault(); moveStage(id, -1, 'grip'); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); moveStage(id, 1, 'grip'); }
    });
    bindDrag();
    el.add.addEventListener('click', function () {
      if (raw.stages.length >= R.LIMITS.MAX_STAGES) return;
      var st = { id: newId(), name: 'New stage', duration: 3, cost: 50000, extraBurn: 0, derisks: '' };
      raw.stages.push(st);
      renderStages({ id: st.id, act: 'name' });
      announce('Stage added. ' + raw.stages.length + ' stages.');
    });
  }

  function deleteStage(id) {
    if (raw.stages.length <= 1) return;
    var i = stageIndex(id); var name = raw.stages[i].name;
    raw.stages.splice(i, 1);
    var next = raw.stages[Math.min(i, raw.stages.length - 1)];
    renderStages({ id: next.id, act: 'grip' });
    announce('Deleted ' + name + '. ' + raw.stages.length + ' stages remain.');
  }

  // Mouse drag and drop on the grip. Touch relies on the up/down buttons, which always work.
  function bindDrag() {
    var dragId = null, drop = null;
    function clearMarks() { el.stages.querySelectorAll('.drop-before,.drop-after').forEach(function (n) { n.classList.remove('drop-before', 'drop-after'); }); }
    el.stages.addEventListener('pointerdown', function (e) {
      var g = e.target.closest('button[data-act="grip"]');
      if (g && e.pointerType === 'mouse') g.closest('li.stage').draggable = true;
    });
    el.stages.addEventListener('dragstart', function (e) {
      var li = e.target.closest && e.target.closest('li.stage'); if (!li || !li.draggable) return;
      dragId = li.getAttribute('data-id');
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId);
      li.classList.add('dragging');
    });
    el.stages.addEventListener('dragover', function (e) {
      if (!dragId) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      var li = e.target.closest('li.stage'); clearMarks(); if (!li) return;
      var r = li.getBoundingClientRect(); var before = e.clientY < r.top + r.height / 2;
      li.classList.add(before ? 'drop-before' : 'drop-after');
      drop = { id: li.getAttribute('data-id'), before: before };
    });
    el.stages.addEventListener('drop', function (e) {
      if (!dragId || !drop) return;
      e.preventDefault();
      var from = stageIndex(dragId), t = stageIndex(drop.id);
      var to = drop.before ? (from < t ? t - 1 : t) : (from < t ? t : t + 1);
      var id = dragId;
      if (to !== from) { raw.stages = R.moveItem(raw.stages, from, to); renderStages({ id: id, act: 'grip' }); announce('Moved to position ' + (to + 1)); }
    });
    el.stages.addEventListener('dragend', function () {
      dragId = null; drop = null; clearMarks();
      el.stages.querySelectorAll('li.stage').forEach(function (li) { li.draggable = false; li.classList.remove('dragging'); });
    });
  }

  /* ---------- error display ---------- */
  function showErrors(errors) {
    document.querySelectorAll('.err').forEach(function (p) { p.textContent = ''; });
    document.querySelectorAll('[aria-invalid]').forEach(function (i) { i.removeAttribute('aria-invalid'); i.removeAttribute('aria-describedby'); });
    errors.forEach(function (er) {
      var msg = $('err-' + er.field); if (msg) msg.textContent = er.message;
      var input = document.querySelector('[data-field="' + er.field + '"]');
      if (input && msg) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', msg.id); }
    });
  }

  /* ---------- outputs ---------- */
  var last = null; // {state, sum} for exports

  function update() {
    var res = R.normalizeState(raw);
    var state = res.state;
    var sum = R.summarize(state);
    last = { state: state, sum: sum };
    showErrors(res.errors);
    renderSummary(state, sum);
    renderGantt(state, sum);
    renderTable(state, sum);
    renderChart(state, sum);
    var totalMonths = state.stages.reduce(function (a, s) { return a + s.duration; }, 0);
    var oneTime = state.stages.reduce(function (a, s) { return a + s.cost; }, 0);
    el.stageTotals.textContent = plural(state.stages.length, 'stage') + ' · ' + plural(totalMonths, 'month') + ' · ' + R.formatMoney(oneTime) + ' one-time';
    el.raiseHint.textContent = state.raiseAmount > 0 ? '= ' + R.monthLabel(state.startMonth, state.raiseMonth) : 'Only used if the amount is above $0.';
    el.truncNote.hidden = !sum.truncated;
    $('printTitle').textContent = (state.company || 'Untitled company') + ': runway plan';
    $('printMeta').textContent = 'Starting cash ' + R.formatMoneyFull(state.startingCash) + ' · base burn ' + R.formatMoneyFull(state.baseBurn) +
      '/month · start ' + R.monthLabel(state.startMonth, 1) +
      (state.raiseAmount > 0 ? ' · raise ' + R.formatMoneyFull(state.raiseAmount) + ' in month ' + state.raiseMonth : '') +
      ' · printed ' + new Date().toLocaleDateString('en-US');
    if (el._first) { // skip the very first render so merely opening a shared link doesn't overwrite saved work
      if (/[#&]plan=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search); // edits supersede the shared link
      save(state);
    }
    el._first = true;
  }

  function card(label, big, sub, alert, tag) {
    return h('div', { class: 'card' + (alert ? ' alert' : '') }, [
      h('dl', { style: 'margin:0' }, [h('dt', { text: label }), h('dd', { class: 'big', text: big }), h('dd', { class: 'sub' }, [
        tag ? h('span', { class: 'tag', text: tag + ' ' }) : null, sub])])
    ]);
  }

  function renderSummary(state, sum) {
    el.sentence.textContent = R.describe(state, sum);
    el.cards.textContent = '';
    var out = sum.runway !== null;
    el.cards.appendChild(card('Runway',
      out ? plural(sum.runway, 'month') : (R.LIMITS.MAX_MONTHS + '+ months'),
      out ? 'Out of cash in Month ' + sum.cashOutMonth + ' (' + R.monthLabel(state.startMonth, sum.cashOutMonth) + ')' : 'No cash-out within ' + R.LIMITS.MAX_MONTHS + ' months',
      out && sum.cashOutMonth <= sum.planEnd, out && sum.cashOutMonth <= sum.planEnd ? 'Cash out before plan ends.' : ''));
    el.cards.appendChild(card('Milestone reached',
      sum.reachedStage ? sum.reachedStage.name : 'None yet',
      sum.reachedStage ? 'Completed in Month ' + sum.reachedStage.end + ' · ' + (sum.reachedIndex + 1) + ' of ' + sum.schedule.length + ' stages' : 'Cash runs out before the first stage finishes'));
    el.cards.appendChild(card('Total cash to finish',
      R.formatMoney(sum.totalNeeded), 'Over ' + plural(sum.planEnd, 'month') + ': burn, stage burn and one-time costs'));
    el.cards.appendChild(card('Funding gap',
      sum.gap > 0 ? R.formatMoney(sum.gap) : '$0',
      sum.gap > 0 ? 'More cash needed to finish all stages' + (state.raiseAmount > 0 ? ' (after planned raise)' : '') : 'Fully funded; ' + R.formatMoney(sum.endBalance) + ' left at the end'));
  }

  function renderGantt(state, sum) {
    var N = Math.max(sum.horizon, 1);
    var root = h('div', { class: 'gantt', style: '--months:' + N });
    // header: month numbers
    var months = h('div', { class: 'g-track', style: 'background-image:none' });
    for (var m = 1; m <= N; m++) {
      var d = R.addMonths(state.startMonth, m - 1);
      var lab = R.monthLabel(state.startMonth, m);
      months.appendChild(h('div', { class: 'g-month', title: 'Month ' + m + ': ' + lab }, [
        h('b', { text: String(m) }), h('span', { text: lab.slice(0, 3) }),
        h('i', { text: m === 1 || d.month === 1 ? String(d.year) : ' ' })]));
    }
    root.appendChild(h('div', { class: 'g-row g-head g-mark-row' }, [h('div', { class: 'g-label' }, [h('strong', { text: 'Stage' }), h('span', { text: 'Month' })]), h('div', { class: 'g-track', style: 'background-image:none' })]));
    root.appendChild(h('div', { class: 'g-row g-head' }, [h('div', { class: 'g-label', style: 'border-top:0' }), months]));
    sum.schedule.forEach(function (st) {
      var end = Math.min(st.end, N);
      var f = '100%', cls = 'g-bar';
      if (sum.runway !== null && st.end > sum.runway) {
        var funded = Math.max(0, Math.min(st.duration, sum.runway - st.start + 1));
        f = (funded / st.duration * 100) + '%';
        if (funded === 0) cls += ' unfunded';
      }
      var status = sum.runway === null || st.end <= sum.runway ? 'funded' : (sum.runway >= st.start ? 'partly funded' : 'not funded');
      var bar = h('div', { class: cls, style: 'grid-column:' + st.start + ' / ' + (end + 1) + ';--f:' + f, role: 'img',
        'aria-label': st.name + ': months ' + st.start + ' to ' + st.end + ', ' + status, title: st.name + ' (M' + st.start + '–M' + st.end + ', ' + status + ')' });
      var track = h('div', { class: 'g-track' }, [bar]);
      root.appendChild(h('div', { class: 'g-row' }, [
        h('div', { class: 'g-label' }, [h('strong', { text: st.name }),
          h('span', { text: 'M' + st.start + '–M' + st.end + ' · ' + R.formatMoney(st.cost) })]), track]));
    });
    root.appendChild(h('div', { class: 'g-row g-spacer' }, [h('div', { class: 'g-label' }), h('div', { class: 'g-track', style: 'background-image:none' })]));
    // overlay lines
    var ov = h('div', { class: 'g-overlay' });
    if (sum.runway !== null && sum.runway <= N) {
      var pos = sum.runway / N;
      ov.appendChild(h('div', { class: 'g-line cashout' + (pos > 0.6 ? ' flip' : ''), style: 'left:' + (pos * 100) + '%' }, [h('span', { class: 'g-tag', text: 'Cash out · Month ' + sum.cashOutMonth })]));
    }
    if (state.raiseAmount > 0 && state.raiseMonth <= N) {
      var rp = (state.raiseMonth - 0.5) / N;
      ov.appendChild(h('div', { class: 'g-line raise' + (rp > 0.6 ? ' flip' : ''), style: 'left:' + (rp * 100) + '%' }, [h('span', { class: 'g-tag', text: 'Raise +' + R.formatMoney(state.raiseAmount) })]));
    }
    root.appendChild(ov);
    el.gantt.textContent = '';
    el.gantt.appendChild(root);
  }

  function renderTable(state, sum) {
    var t = el.table; t.textContent = '';
    var cap = h('caption', { class: 'sr-only', text: 'Month-by-month cash table' });
    t.appendChild(cap);
    var hr = h('tr'); R.CSV_HEADERS.forEach(function (c) { hr.appendChild(h('th', { scope: 'col', text: c })); });
    t.appendChild(h('thead', {}, [hr]));
    var body = h('tbody'); var tot = { b: 0, e: 0, o: 0, r: 0, n: 0 };
    sum.rows.forEach(function (r) {
      tot.b += r.baseBurn; tot.e += r.extraBurn; tot.o += r.oneTime; tot.r += r.raise; tot.n += r.net;
      var tr = h('tr', { class: sum.cashOutMonth === r.month ? 'cashout-row' : '' });
      [r.month, R.monthLabel(state.startMonth, r.month), r.activeStages.join(' + ') || '—', R.formatMoneyFull(r.baseBurn), R.formatMoneyFull(r.extraBurn),
        R.formatMoneyFull(r.oneTime), r.raise ? R.formatMoneyFull(r.raise) : '—', R.formatMoneyFull(r.net)].forEach(function (v) { tr.appendChild(h('td', { text: String(v) })); });
      tr.appendChild(h('td', { class: r.balance < 0 ? 'neg' : '', text: R.formatMoneyFull(r.balance) + (r.balance < 0 ? ' (overdrawn)' : '') }));
      body.appendChild(tr);
    });
    t.appendChild(body);
    var end = sum.rows.length ? sum.rows[sum.rows.length - 1].balance : state.startingCash;
    var tf = h('tr');
    ['Total', '', '', tot.b, tot.e, tot.o, tot.r, tot.n, end].forEach(function (v, i) { tf.appendChild(h('td', { text: i < 3 ? v : R.formatMoneyFull(v) })); });
    t.appendChild(h('tfoot', {}, [tf]));
  }

  /* ---------- chart ---------- */
  var annotationPlugin = {
    id: 'runwayMarkers',
    afterDatasetsDraw: function (c, _a, opts) {
      if (!opts || !opts.lines) return;
      var ctx = c.ctx, x = c.scales.x, area = c.chartArea;
      opts.lines.forEach(function (ln) {
        var px = x.getPixelForValue(ln.x);
        if (px < area.left - 1 || px > area.right + 1) return;
        ctx.save();
        ctx.strokeStyle = ln.color; ctx.lineWidth = 2; if (ln.dash) ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(px, area.top); ctx.lineTo(px, area.bottom); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '600 11px ' + opts.font; ctx.textBaseline = 'top';
        var w = ctx.measureText(ln.label).width + 10;
        var flip = px + w + 4 > area.right;
        var bx = flip ? px - w - 4 : px + 4, by = area.top + (ln.row || 0) * 22 + 4;
        ctx.fillStyle = ln.fill; ctx.strokeStyle = ln.color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.rect(bx, by, w, 18); ctx.fill(); ctx.stroke();
        ctx.fillStyle = ln.color; ctx.fillText(ln.label, bx + 5, by + 3);
        ctx.restore();
      });
    }
  };

  function renderChart(state, sum) {
    var summary = 'Cash balance by month, starting at ' + R.formatMoney(state.startingCash) +
      (sum.runway !== null ? '; cash goes negative in month ' + sum.cashOutMonth : '; never negative in the plan') + '. Full data is in the table below.';
    el.chart.setAttribute('aria-label', summary);
    if (typeof window.Chart === 'undefined') { el.chartFallback.hidden = false; el.chart.hidden = true; return; }
    var accent = cssVar('--accent'), danger = cssVar('--danger'), text = cssVar('--text-2'), grid = cssVar('--border'), font = cssVar('--font') || 'sans-serif';
    var tint = cssVar('--accent-tint'), dtint = cssVar('--danger-tint');
    var data = [{ x: 0, y: state.startingCash }].concat(sum.rows.map(function (r) { return { x: r.month, y: r.balance }; }));
    var lines = [];
    if (sum.runway !== null) lines.push({ x: sum.runway, color: danger, fill: dtint, label: 'Cash out · Month ' + sum.cashOutMonth, row: 0 });
    if (state.raiseAmount > 0) lines.push({ x: state.raiseMonth - 0.5, color: accent, fill: tint, dash: true, label: 'Raise +' + R.formatMoney(state.raiseAmount), row: 1 });
    var ds = {
      label: 'Ending cash balance', data: data, borderColor: accent, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0,
      fill: { target: 'origin', above: tint, below: dtint },
      segment: { borderColor: function (c) { return c.p1.parsed.y < 0 || c.p0.parsed.y < 0 ? danger : accent; } }
    };
    var opts = {
      responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: {
        x: { type: 'linear', min: 0, max: sum.horizon, ticks: { color: text, includeBounds: false, stepSize: sum.horizon > 36 ? 12 : sum.horizon > 18 ? 3 : 1, callback: function (v) { return v === 0 ? 'Start' : 'M' + v; }, maxRotation: 0 }, grid: { color: grid }, title: { display: true, text: 'Plan month', color: text } },
        y: { ticks: { color: text, callback: function (v) { return R.formatMoney(v); } }, grid: { color: function (c) { return c.tick.value === 0 ? text : grid; } } }
      },
      plugins: {
        legend: { display: false },
        runwayMarkers: { lines: lines, font: font },
        tooltip: {
          callbacks: {
            title: function (items) { var m = items[0].parsed.x; return m === 0 ? 'Start' : 'Month ' + m + ' (' + R.monthLabel(state.startMonth, m) + ')'; },
            label: function (c) { return 'Ending balance: ' + R.formatMoneyFull(c.parsed.y); }
          }
        }
      }
    };
    if (chart) { chart.data.datasets[0] = ds; chart.options = opts; chart.update('none'); return; }
    chart = new window.Chart(el.chart, { type: 'line', data: { datasets: [ds] }, options: opts, plugins: [annotationPlugin] });
  }

  /* ---------- export ---------- */
  function slug(s) { return (s || 'plan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plan'; }

  function downloadCsv() {
    var csv = '﻿' + R.toCsv(last.state); // BOM so Excel reads UTF-8
    var url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    var a = h('a', { href: url, download: slug(last.state.company) + '-runway.csv' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('CSV downloaded');
  }

  function shareUrl() { return location.href.split('#')[0] + '#plan=' + R.encodeState(last.state); }

  function copyShare() {
    var url = shareUrl();
    function fallback() {
      var ta = h('textarea', { 'aria-hidden': 'true', style: 'position:fixed;opacity:0' }); ta.value = url;
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (ok) toast('Share link copied'); else window.prompt('Copy this link:', url);
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(function () { toast('Share link copied'); }, fallback);
    else fallback();
  }

  function printPage() { window.print(); }

  /* ---------- init ---------- */
  function init() {
    Object.keys(TEMPLATES).forEach(function (k) { el.template.appendChild(h('option', { value: k, text: TEMPLATES[k].label })); });
    raw = load();
    writeSetup();
    bindSetup();
    bindStages();
    renderStages();
    el.template.addEventListener('change', function () {
      var t = TEMPLATES[el.template.value]; if (!t) return;
      var keep = { company: raw.company, startMonth: raw.startMonth };
      raw = adopt(R.normalizeState(Object.assign({}, t.state, keep)).state);
      writeSetup(); renderStages();
      toast('Loaded template: ' + t.label);
      el.template.value = '';
    });
    $('btn-csv').addEventListener('click', downloadCsv);
    $('btn-share').addEventListener('click', copyShare);
    $('btn-print').addEventListener('click', printPage);
    // Print needs the table open and the chart sized to the page.
    var wasOpen = false;
    window.addEventListener('beforeprint', function () { wasOpen = el.tableDetails.open; el.tableDetails.open = true; if (chart) chart.resize(); });
    window.addEventListener('afterprint', function () { el.tableDetails.open = wasOpen; if (chart) chart.resize(); });
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var rerender = function () { if (last) renderChart(last.state, last.sum); };
      if (mq.addEventListener) mq.addEventListener('change', rerender); else if (mq.addListener) mq.addListener(rerender);
    }
    window.addEventListener('hashchange', function () {
      var m = /[#&]plan=([^&]+)/.exec(location.hash); var s = m && R.decodeState(m[1]);
      if (s) { raw = adopt(s); writeSetup(); renderStages(); }
    });
    window.__runway = { get state() { return last.state; }, get summary() { return last.sum; } }; // debugging aid
  }

  init();
})();
