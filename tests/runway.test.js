'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/runway.js');
const T = require('../data/templates.js');

const base = (o) => Object.assign(
  { company: 't', startMonth: '2027-01', startingCash: 0, baseBurn: 0, raiseAmount: 0, raiseMonth: 1, stages: [] }, o);
const stage = (name, duration, cost = 0, extraBurn = 0) => ({ id: name, name, duration, cost, extraBurn, derisks: '' });

test('$600k cash, $50k/month burn, no stages -> runway exactly 12 months', () => {
  const s = base({ startingCash: 600000, baseBurn: 50000 });
  assert.equal(R.runwayMonths(s), 12);
  const rows = R.monthlyCashflow(s, 13);
  assert.equal(rows[11].balance, 0);   // month 12 ends at exactly $0: still funded
  assert.equal(rows[12].balance, -50000); // month 13 goes negative
});

test('one-time costs hit in the stage first month only', () => {
  const s = base({ startingCash: 1000000, baseBurn: 10000, stages: [stage('A', 2, 100000), stage('B', 3, 50000, 5000)] });
  const rows = R.monthlyCashflow(s);
  assert.deepEqual(rows.map((r) => r.oneTime), [100000, 0, 50000, 0, 0]);
  assert.deepEqual(rows.map((r) => r.extraBurn), [0, 0, 5000, 5000, 5000]);
  assert.deepEqual(rows.map((r) => r.balance), [890000, 880000, 815000, 800000, 785000]);
});

test('a planned raise extends runway by raise / burn', () => {
  const noRaise = base({ startingCash: 600000, baseBurn: 50000 });
  const raise = base({ startingCash: 600000, baseBurn: 50000, raiseAmount: 300000, raiseMonth: 6 });
  assert.equal(R.runwayMonths(noRaise), 12);
  assert.equal(R.runwayMonths(raise), 18); // +$300k / $50k = +6 months
  assert.equal(R.monthlyCashflow(raise, 6)[5].raise, 300000);
});

test('stages run back to back with correct start/end after reordering', () => {
  const stages = [stage('A', 3), stage('B', 4), stage('C', 5)];
  assert.deepEqual(R.buildSchedule(stages).map((s) => [s.name, s.start, s.end]), [['A', 1, 3], ['B', 4, 7], ['C', 8, 12]]);
  const reordered = R.moveItem(stages, 2, 0); // C, A, B
  assert.deepEqual(R.buildSchedule(reordered).map((s) => [s.name, s.start, s.end]), [['C', 1, 5], ['A', 6, 8], ['B', 9, 12]]);
});

test('zero stages and zero burn do not crash or loop; runway is null (never runs out)', () => {
  const s = base({ startingCash: 100000 });
  assert.equal(R.runwayMonths(s), null);
  assert.equal(R.monthlyCashflow(s).length, 0);
  assert.equal(R.fundingGap(s), 0);
  const sum = R.summarize(Object.assign({}, s, { stages: [stage('A', 2)] }));
  assert.equal(sum.runway, null);
  assert.ok(sum.rows.length <= R.LIMITS.MAX_MONTHS);
  assert.ok(R.monthlyCashflow(s, 100000).length <= R.LIMITS.MAX_MONTHS);
});

test('zero starting cash runs out immediately (runway 0)', () => {
  assert.equal(R.runwayMonths(base({ baseBurn: 1000 })), 0);
});

test('funding gap and total cash needed', () => {
  const s = base({ startingCash: 100000, baseBurn: 10000, stages: [stage('A', 2, 50000), stage('B', 2, 0, 5000)] });
  // spend: 4*10k + 50k + 2*5k = 100k  -> exactly funded
  assert.equal(R.totalCashNeeded(s), 100000);
  assert.equal(R.fundingGap(s), 0);
  assert.equal(R.fundingGap(Object.assign({}, s, { startingCash: 70000 })), 30000);
  // a raise reduces the gap
  assert.equal(R.fundingGap(Object.assign({}, s, { startingCash: 70000, raiseAmount: 20000, raiseMonth: 1 })), 10000);
});

test('normalizeState never yields NaN, negatives or empty stage lists', () => {
  const { state, errors } = R.normalizeState({
    startingCash: 'abc', baseBurn: -5, raiseAmount: 1e15, raiseMonth: 999,
    stages: [{ name: '', duration: -3, cost: NaN, extraBurn: '12k' }]
  });
  assert.ok(errors.length >= 5);
  const nums = [state.startingCash, state.baseBurn, state.raiseAmount, state.raiseMonth,
    ...state.stages.flatMap((s) => [s.duration, s.cost, s.extraBurn])];
  nums.forEach((n) => assert.ok(Number.isFinite(n) && n >= 0));
  assert.equal(state.stages[0].duration, 1);
  assert.equal(R.normalizeState({}).state.stages.length, 1);
  assert.ok(R.normalizeState({ stages: Array(50).fill({ name: 'x', duration: 1 }) }).state.stages.length <= R.LIMITS.MAX_STAGES);
});

test('plan longer than the 120-month cap is truncated without looping', () => {
  const s = base({ startingCash: 1e9, stages: Array.from({ length: 20 }, (_, i) => stage('S' + i, 60)) });
  assert.equal(R.monthlyCashflow(s).length, R.LIMITS.MAX_MONTHS);
  assert.equal(R.summarize(s).truncated, true);
});

test('CSV has headers, one row per month and a totals row; free text is escaped', () => {
  const s = base({ startingCash: 1000, baseBurn: 100, stages: [stage('=evil, "x"', 2, 50)] });
  const lines = R.toCsv(s).trim().split('\r\n');
  assert.equal(lines[0], R.CSV_HEADERS.join(','));
  assert.equal(lines.length, 1 + R.summarize(s).rows.length + 1);
  assert.ok(lines[1].includes(`"'=evil, ""x"""`));
  assert.ok(lines[lines.length - 1].startsWith('Total,'));
});

test('share link round-trips', () => {
  const s = R.normalizeState(T.energy.state).state;
  s.company = 'Café Ünïcode ⚡';
  s.startMonth = '2027-03';
  const back = R.decodeState(R.encodeState(s));
  assert.equal(back.company, s.company);
  assert.deepEqual(back.stages.map(({ id, ...r }) => r), s.stages.map(({ id, ...r }) => r));
  assert.equal(back.raiseAmount, s.raiseAmount);
  assert.equal(R.decodeState('not-a-plan!!'), null);
});

test('default (generic) template hand check', () => {
  /*
   * Hand calculation. Base burn 60k. Stage extra burn: 5k, 10k, 15k, 5k, 20k.
   * Total one-time = 80+150+250+120+400 = $1,000k; 19 months total.
   * Base burn 19 x 60k = $1,140k; extra burn 3x5 + 4x10 + 5x15 + 3x5 + 4x20 = $225k.
   * Total cash needed = 1,000 + 1,140 + 225 = $2,365k; gap vs $1,000k = $1,365k.
   * Balances ($k): M1 1000-65-80=855, M2 790, M3 725 | M4 725-70-150=505, 435, 365, M7 295
   * M8 (Pilot starts) 295-75-250 = -30 -> first negative, so runway = 7 months.
   * Stage 2 (Engineering prototype) ends month 7 <= 7, so it is the last funded stage.
   */
  const s = R.normalizeState(T.generic.state).state;
  const sum = R.summarize(s);
  assert.equal(sum.planEnd, 19);
  assert.equal(sum.totalNeeded, 2365000);
  assert.equal(sum.runway, 7);
  assert.equal(sum.cashOutMonth, 8);
  assert.equal(sum.reachedStage.name, 'Engineering prototype');
  assert.equal(R.fundingGap(s), 1365000);
  assert.equal(sum.rows[6].balance, 295000);
  assert.equal(sum.rows[7].balance, -30000);
  assert.match(R.describe(s, sum), /^With \$1\.0M you reach the end of Engineering prototype in Month 7; you need \$1\.37M more to finish First production run\.$/);
});

test('all templates normalise without errors', () => {
  Object.values(T).forEach((t) => assert.deepEqual(R.normalizeState(t.state).errors, []));
});
