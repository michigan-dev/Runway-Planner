/*
 * Hardware Runway Planner: pure cash-flow functions.
 * No DOM access, so the same file runs in the browser (window.Runway) and in
 * Node's test runner (require).
 *
 * Month numbers are 1-based. "Month 1" is the start month. A stage that starts
 * in month 5 and lasts 3 months is active in months 5, 6 and 7.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Runway = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMITS = {
    MAX_MONTHS: 120, // simulation cap; also stops infinite loops on zero burn
    MAX_STAGES: 20,
    MAX_DURATION: 60,
    MAX_MONEY: 1e9,
    MAX_NAME: 60,
    MAX_NOTE: 200
  };

  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function round2(n) { return Math.round(n * 100) / 100; }

  /* ---------- input normalisation ---------- */

  function parseNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (typeof v === 'string' && v.trim() !== '') {
      var n = Number(v.replace(/[,$\s]/g, ''));
      return isFinite(n) ? n : NaN;
    }
    return NaN;
  }

  // Returns {value, error}. value is always a finite number inside [min, max].
  function clampField(raw, min, max, fallback, opts) {
    opts = opts || {};
    var n = parseNum(raw);
    var label = opts.label || 'Value';
    if (isNaN(n)) return { value: fallback, error: label + ' must be a number.' };
    if (n < min) return { value: min, error: label + ' cannot be below ' + fmtLimit(min, opts.money) + '.' };
    if (n > max) return { value: max, error: label + ' cannot exceed ' + fmtLimit(max, opts.money) + '.' };
    if (opts.integer && Math.floor(n) !== n) return { value: Math.round(n), error: label + ' must be a whole number.' };
    return { value: n, error: null };
  }

  function fmtLimit(n, money) {
    if (!money) return String(n);
    return n >= 1e9 ? '$1B' : '$' + n.toLocaleString('en-US');
  }

  function isValidMonthKey(s) { return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s); }

  /**
   * Make any input safe to simulate: never NaN, never negative, bounded.
   * @returns {{state: object, errors: Array<{field: string, message: string}>}}
   */
  function normalizeState(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var errors = [];
    function take(field, res) { if (res.error) errors.push({ field: field, message: res.error }); return res.value; }

    var s = {
      company: typeof raw.company === 'string' ? raw.company.slice(0, LIMITS.MAX_NAME) : '',
      startMonth: isValidMonthKey(raw.startMonth) ? raw.startMonth : currentMonthKey(),
      startingCash: take('startingCash', clampField(raw.startingCash, 0, LIMITS.MAX_MONEY, 0, { label: 'Starting cash', money: true })),
      baseBurn: take('baseBurn', clampField(raw.baseBurn, 0, LIMITS.MAX_MONEY, 0, { label: 'Monthly burn', money: true })),
      raiseAmount: take('raiseAmount', clampField(raw.raiseAmount === undefined || raw.raiseAmount === '' ? 0 : raw.raiseAmount, 0, LIMITS.MAX_MONEY, 0, { label: 'Raise amount', money: true })),
      raiseMonth: take('raiseMonth', clampField(raw.raiseMonth === undefined || raw.raiseMonth === '' ? 1 : raw.raiseMonth, 1, LIMITS.MAX_MONTHS, 1, { label: 'Raise month', integer: true })),
      stages: []
    };
    if (raw.startMonth !== undefined && !isValidMonthKey(raw.startMonth)) {
      errors.push({ field: 'startMonth', message: 'Choose a valid start month.' });
    }

    var list = Array.isArray(raw.stages) ? raw.stages : [];
    if (list.length > LIMITS.MAX_STAGES) {
      errors.push({ field: 'stages', message: 'At most ' + LIMITS.MAX_STAGES + ' stages are supported.' });
      list = list.slice(0, LIMITS.MAX_STAGES);
    }
    list.forEach(function (st, i) {
      st = st && typeof st === 'object' ? st : {};
      var p = 'stages.' + i + '.';
      var name = typeof st.name === 'string' ? st.name.trim().slice(0, LIMITS.MAX_NAME) : '';
      if (!name) { errors.push({ field: p + 'name', message: 'Give the stage a name.' }); name = 'Stage ' + (i + 1); }
      s.stages.push({
        id: typeof st.id === 'string' && st.id ? st.id : 's' + (i + 1),
        name: name,
        duration: take(p + 'duration', clampField(st.duration, 1, LIMITS.MAX_DURATION, 1, { label: 'Duration', integer: true })),
        cost: take(p + 'cost', clampField(st.cost === undefined || st.cost === '' ? 0 : st.cost, 0, LIMITS.MAX_MONEY, 0, { label: 'One-time cost', money: true })),
        extraBurn: take(p + 'extraBurn', clampField(st.extraBurn === undefined || st.extraBurn === '' ? 0 : st.extraBurn, 0, LIMITS.MAX_MONEY, 0, { label: 'Extra monthly burn', money: true })),
        derisks: typeof st.derisks === 'string' ? st.derisks.slice(0, LIMITS.MAX_NOTE) : ''
      });
    });
    if (s.stages.length === 0) {
      errors.push({ field: 'stages', message: 'Add at least one stage.' });
      s.stages.push({ id: 's1', name: 'Stage 1', duration: 1, cost: 0, extraBurn: 0, derisks: '' });
    }
    return { state: s, errors: errors };
  }

  /* ---------- dates ---------- */

  function currentMonthKey() {
    var d = new Date();
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  }

  // addMonths('2027-01', 0) -> {year: 2027, month: 1}
  function addMonths(monthKey, n) {
    var y = Number(monthKey.slice(0, 4));
    var m = Number(monthKey.slice(5, 7));
    var idx = y * 12 + (m - 1) + n;
    return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
  }

  // Calendar label for plan month number (1-based): month 1 -> start month.
  function monthLabel(startMonth, monthNumber) {
    var d = addMonths(startMonth, monthNumber - 1);
    return MONTH_NAMES[d.month - 1] + ' ' + d.year;
  }

  /* ---------- the model ---------- */

  /**
   * Stages run back to back from month 1, in the order given.
   * @returns stages with 1-based inclusive start and end months.
   */
  function buildSchedule(stages) {
    var cursor = 1;
    return (stages || []).map(function (st) {
      var dur = Math.max(1, Math.floor(Number(st.duration) || 1));
      var out = {
        id: st.id, name: st.name, duration: dur,
        cost: Math.max(0, Number(st.cost) || 0),
        extraBurn: Math.max(0, Number(st.extraBurn) || 0),
        derisks: st.derisks || '',
        start: cursor,
        end: cursor + dur - 1
      };
      cursor += dur;
      return out;
    });
  }

  function planEndMonth(state) {
    var sched = buildSchedule(state.stages);
    return sched.length ? sched[sched.length - 1].end : 0;
  }

  /**
   * Month-by-month cash table.
   * Each month: subtract base burn + extra burn of active stages; charge a
   * stage's one-time cost in its first month; add the planned raise in its month.
   * `months` defaults to the plan end and is capped at MAX_MONTHS.
   */
  function monthlyCashflow(state, months) {
    var sched = buildSchedule(state.stages);
    var end = sched.length ? sched[sched.length - 1].end : 0;
    var n = Math.min(LIMITS.MAX_MONTHS, Math.max(0, Math.floor(months === undefined ? end : months)));
    var baseBurn = Math.max(0, Number(state.baseBurn) || 0);
    var raiseAmount = Math.max(0, Number(state.raiseAmount) || 0);
    var raiseMonth = Math.floor(Number(state.raiseMonth) || 1);
    var balance = Math.max(0, Number(state.startingCash) || 0);
    var rows = [];
    for (var m = 1; m <= n; m++) {
      var extra = 0, oneTime = 0, active = [];
      for (var i = 0; i < sched.length; i++) {
        var st = sched[i];
        if (m >= st.start && m <= st.end) {
          extra += st.extraBurn;
          active.push(st.name);
          if (m === st.start) oneTime += st.cost;
        }
      }
      var raise = raiseAmount > 0 && m === raiseMonth ? raiseAmount : 0;
      var net = round2(raise - baseBurn - extra - oneTime);
      balance = round2(balance + net);
      rows.push({
        month: m, activeStages: active, baseBurn: baseBurn, extraBurn: round2(extra),
        oneTime: round2(oneTime), raise: raise, net: net, balance: balance
      });
    }
    return rows;
  }

  /**
   * Whole months the company is funded: the last month whose ending balance is
   * still >= 0. Returns null if cash never goes negative within MAX_MONTHS.
   */
  function runwayMonths(state) {
    var rows = monthlyCashflow(state, LIMITS.MAX_MONTHS);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].balance < 0) return rows[i].month - 1;
    }
    return null;
  }

  /** Total spend (burn + stage costs) from month 1 to the end of the last stage. */
  function totalCashNeeded(state) {
    var rows = monthlyCashflow(state);
    return round2(rows.reduce(function (sum, r) { return sum + r.baseBurn + r.extraBurn + r.oneTime; }, 0));
  }

  /**
   * Extra cash needed to finish every stage: the deepest point the balance
   * reaches (below zero) between month 1 and the end of the last stage.
   */
  function fundingGap(state) {
    var rows = monthlyCashflow(state);
    var min = Infinity;
    rows.forEach(function (r) { if (r.balance < min) min = r.balance; });
    if (min === Infinity) return 0;
    return min < 0 ? round2(-min) : 0;
  }

  /** How many months to show on charts/tables. */
  function horizonMonths(state) {
    var end = planEndMonth(state);
    var runway = runwayMonths(state);
    var h = Math.max(end, 6);
    if (runway !== null) h = Math.max(h, runway + 2);
    if (Number(state.raiseAmount) > 0) h = Math.max(h, Number(state.raiseMonth) || 1);
    return Math.min(LIMITS.MAX_MONTHS, h);
  }

  /** Everything the UI needs, computed once. */
  function summarize(state) {
    var schedule = buildSchedule(state.stages);
    var planEnd = schedule.length ? schedule[schedule.length - 1].end : 0;
    var runway = runwayMonths(state);
    var horizon = horizonMonths(state);
    var rows = monthlyCashflow(state, horizon);
    var gap = fundingGap(state);
    var reached = -1; // index of the last fully funded stage (funded stages form a prefix)
    for (var i = 0; i < schedule.length; i++) {
      if (runway === null || schedule[i].end <= runway) reached = i; else break;
    }
    var planRows = rows.filter(function (r) { return r.month <= planEnd; });
    var endBalance = planRows.length ? planRows[planRows.length - 1].balance : state.startingCash;
    return {
      schedule: schedule, rows: rows, planEnd: planEnd, horizon: horizon,
      runway: runway,
      cashOutMonth: runway === null ? null : runway + 1, // first month balance < 0
      reachedIndex: reached,
      reachedStage: reached >= 0 ? schedule[reached] : null,
      totalNeeded: totalCashNeeded(state),
      gap: gap,
      endBalance: endBalance,
      fullyFunded: gap === 0,
      truncated: schedule.length > 0 && state.stages.reduce(function (s, st) { return s + st.duration; }, 0) > LIMITS.MAX_MONTHS
    };
  }

  /* ---------- formatting ---------- */

  function formatMoney(n) {
    n = Number(n);
    if (!isFinite(n)) n = 0;
    var sign = n < 0 ? '−' : '';
    var a = Math.abs(n);
    var out;
    if (a >= 1e9) out = trim(Math.round(a / 1e7) / 100, 2) + 'B';
    else if (a >= 1e6) out = trim(Math.round(a / 1e4) / 100, 2) + 'M'; // scale first: toFixed(2) of 1.365 gives 1.36
    else if (a >= 1e3) out = (a < 1e5 ? trim(Math.round(a / 100) / 10, 1, true) : String(Math.round(a / 1e3))) + 'k';
    else out = String(Math.round(a));
    return sign + '$' + out;
  }
  // trim(1, 2) -> "1.0"; trim(1.37, 2) -> "1.37"; trim(295, 1, true) -> "295"
  function trim(x, digits, allowWhole) {
    var s = x.toFixed(digits);
    if (s.indexOf('.') < 0) return s;
    s = s.replace(/0+$/, '');
    if (s.endsWith('.')) s = allowWhole ? s.slice(0, -1) : s + '0';
    return s;
  }

  function formatMoneyFull(n) {
    n = Number(n);
    if (!isFinite(n)) n = 0;
    return (n < 0 ? '−' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  /** The one-sentence answer. */
  function describe(state, sum) {
    var sched = sum.schedule;
    var last = sched[sched.length - 1];
    var cash = formatMoney(state.startingCash);
    var raise = Number(state.raiseAmount) > 0
      ? ' plus a ' + formatMoney(state.raiseAmount) + ' raise in Month ' + state.raiseMonth : '';
    var lead = 'With ' + cash + raise;
    if (sum.fullyFunded) {
      return lead + ' you can complete all ' + plural(sched.length, 'stage') + ', finishing ' + last.name +
        ' in Month ' + sum.planEnd + ' with ' + formatMoney(sum.endBalance) + ' left.';
    }
    var need = formatMoney(sum.gap);
    if (sum.reachedStage) {
      return lead + ' you reach the end of ' + sum.reachedStage.name + ' in Month ' + sum.reachedStage.end +
        '; you need ' + need + ' more to finish ' + last.name + '.';
    }
    return lead + ' you run out of cash in Month ' + sum.cashOutMonth + ', before finishing ' + sched[0].name +
      '; you need ' + need + ' more to finish ' + last.name + '.';
  }

  /* ---------- CSV ---------- */

  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    // Neutralise spreadsheet formula injection in free-text cells.
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  var CSV_HEADERS = ['Month', 'Calendar month', 'Active stages', 'Base burn', 'Stage extra burn',
    'One-time costs', 'Planned raise', 'Net cash flow', 'Ending balance'];

  /** CSV text of the month-by-month table, with a totals row. Plain numbers, no currency symbols. */
  function toCsv(state) {
    var sum = summarize(state);
    var lines = [CSV_HEADERS.map(csvCell).join(',')];
    var t = { base: 0, extra: 0, one: 0, raise: 0, net: 0 };
    sum.rows.forEach(function (r) {
      t.base += r.baseBurn; t.extra += r.extraBurn; t.one += r.oneTime; t.raise += r.raise; t.net += r.net;
      lines.push([r.month, monthLabel(state.startMonth, r.month), r.activeStages.join(' + '),
        r.baseBurn, r.extraBurn, r.oneTime, r.raise, r.net, r.balance].map(csvCell).join(','));
    });
    var endBal = sum.rows.length ? sum.rows[sum.rows.length - 1].balance : state.startingCash;
    lines.push(['Total', '', '', round2(t.base), round2(t.extra), round2(t.one), round2(t.raise), round2(t.net), endBal]
      .map(csvCell).join(','));
    return lines.join('\r\n') + '\r\n';
  }

  /* ---------- share links ---------- */

  function compact(state) {
    return {
      v: 1, c: state.company, sm: state.startMonth, sc: state.startingCash, bb: state.baseBurn,
      ra: state.raiseAmount, rm: state.raiseMonth,
      st: state.stages.map(function (s) { return [s.name, s.duration, s.cost, s.extraBurn, s.derisks]; })
    };
  }

  function encodeState(state) {
    var json = JSON.stringify(compact(state));
    var bytes = new TextEncoder().encode(json);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /** Returns a normalised state, or null if the string is not a valid plan. */
  function decodeState(str) {
    try {
      var b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var o = JSON.parse(new TextDecoder().decode(bytes));
      if (!o || o.v !== 1 || !Array.isArray(o.st)) return null;
      return normalizeState({
        company: o.c, startMonth: o.sm, startingCash: o.sc, baseBurn: o.bb, raiseAmount: o.ra, raiseMonth: o.rm,
        stages: o.st.map(function (a, i) {
          return { id: 's' + (i + 1), name: a[0], duration: a[1], cost: a[2], extraBurn: a[3], derisks: a[4] };
        })
      }).state;
    } catch (e) {
      return null;
    }
  }

  /** Move item at index `from` to index `to` (new array). */
  function moveItem(arr, from, to) {
    var out = arr.slice();
    if (from < 0 || from >= out.length) return out;
    to = Math.max(0, Math.min(out.length - 1, to));
    var item = out.splice(from, 1)[0];
    out.splice(to, 0, item);
    return out;
  }

  return {
    LIMITS: LIMITS, normalizeState: normalizeState, buildSchedule: buildSchedule,
    monthlyCashflow: monthlyCashflow, runwayMonths: runwayMonths, fundingGap: fundingGap,
    totalCashNeeded: totalCashNeeded, horizonMonths: horizonMonths, summarize: summarize,
    describe: describe, toCsv: toCsv, CSV_HEADERS: CSV_HEADERS, encodeState: encodeState,
    decodeState: decodeState, moveItem: moveItem, monthLabel: monthLabel, addMonths: addMonths,
    currentMonthKey: currentMonthKey, formatMoney: formatMoney, formatMoneyFull: formatMoneyFull,
    planEndMonth: planEndMonth
  };
});
