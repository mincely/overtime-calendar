/**
 * 工时计算的单元测试：node scripts/test-worktime.mjs
 *
 * 这块逻辑是这个软件最容易出错的地方（时段裁剪、跨午休、休息日），
 * 所以单独拉出来跑，不依赖 Electron。
 */

import assert from 'node:assert/strict';
import {
  toMinutes,
  toHHMM,
  formatDuration,
  computeSegments,
  overtimeMinutes,
  leaveMinutes,
  dayKind,
  buildMonthGrid,
  summarizeMonth,
  dateKey,
  DEFAULT_SCHEDULE,
  normalizeSchedule,
  scheduleDailyMinutes,
  describeWorkdays
} from '../src/shared/worktime.js';

let passed = 0;
const cases = [];

function test(name, fn) {
  cases.push({ name, fn });
}

const sum = (segs) => segs.reduce((s, x) => s + x.minutes, 0);
const hours = (m) => m / 60;

/* ------------------------------------------------------------ 时间换算 */

test('toMinutes 解析正常时间', () => {
  assert.equal(toMinutes('00:00'), 0);
  assert.equal(toMinutes('08:00'), 480);
  assert.equal(toMinutes('18:30'), 1110);
  assert.equal(toMinutes('23:59'), 1439);
});

test('toMinutes 拒绝非法输入', () => {
  assert.equal(toMinutes('24:00'), null);
  assert.equal(toMinutes('8:0'), null);
  assert.equal(toMinutes('abc'), null);
  assert.equal(toMinutes(null), null);
});

test('toHHMM 往返一致', () => {
  assert.equal(toHHMM(1110), '18:30');
  assert.equal(toHHMM(0), '00:00');
  assert.equal(toHHMM(toMinutes('14:05')), '14:05');
});

test('formatDuration 中文格式', () => {
  assert.equal(formatDuration(30), '30 分');
  assert.equal(formatDuration(120), '2 小时');
  assert.equal(formatDuration(210), '3 小时 30 分');
});

/* -------------------------------------------------------- 工作日的裁剪 */

test('工作日：18:00-21:30 全是加班 = 3.5h', () => {
  const segs = computeSegments([{ start: '18:00', end: '21:30' }], 'workday');
  assert.equal(sum(segs), 210);
  assert.equal(hours(sum(segs)), 3.5);
});

test('工作日：17:00-20:00 要扣掉 17:00-18:00，只剩 2h', () => {
  const segs = computeSegments([{ start: '17:00', end: '20:00' }], 'workday');
  assert.equal(sum(segs), 120);
});

test('工作日：07:00-09:00 要扣掉 08:00-09:00，只剩 1h', () => {
  const segs = computeSegments([{ start: '07:00', end: '09:00' }], 'workday');
  assert.equal(sum(segs), 60);
});

test('工作日：完全落在上班时段内 = 0 加班', () => {
  const segs = computeSegments([{ start: '09:00', end: '11:00' }], 'workday');
  assert.equal(sum(segs), 0);
});

test('工作日：跨早晚两段，只算两头', () => {
  // 07:00-09:00 早加班 1h；18:00-20:00 晚加班 2h
  const segs = computeSegments(
    [
      { start: '07:00', end: '09:00' },
      { start: '18:00', end: '20:00' }
    ],
    'workday'
  );
  assert.equal(sum(segs), 180);
});

test('工作日：跨整个白天也只扣掉 8h 正常工时', () => {
  // 07:00 - 21:00 共 14h，其中 08:00-12:00、14:00-18:00 共 8h 不算加班
  const segs = computeSegments([{ start: '07:00', end: '21:00' }], 'workday');
  assert.equal(sum(segs), 14 * 60 - 8 * 60);
});

test('工作日：午休时段工作算加班（12:00-14:00 在正常时段之外）', () => {
  const segs = computeSegments([{ start: '12:30', end: '13:30' }], 'workday');
  assert.equal(sum(segs), 60);
});

test('调休上班日按工作日算，同样要裁剪', () => {
  const segs = computeSegments([{ start: '17:00', end: '20:00' }], 'swap');
  assert.equal(sum(segs), 120);
});

/* -------------------------------------------------------- 休息日的整天 */

test('休息日：全天都算加班，不裁剪', () => {
  const segs = computeSegments([{ start: '09:00', end: '18:00' }], 'weekend');
  assert.equal(sum(segs), 9 * 60);
});

test('法定假日：同样不裁剪', () => {
  const segs = computeSegments([{ start: '08:00', end: '18:00' }], 'holiday');
  assert.equal(sum(segs), 10 * 60);
});

test('休息日：中间有断档也按填的算', () => {
  const segs = computeSegments(
    [
      { start: '09:00', end: '12:00' },
      { start: '14:00', end: '17:00' }
    ],
    'weekend'
  );
  assert.equal(sum(segs), 6 * 60);
});

/* ------------------------------------------------------------ 脏数据 */

test('end 早于 start 的段被忽略', () => {
  const segs = computeSegments([{ start: '20:00', end: '18:00' }], 'workday');
  assert.equal(segs.length, 0);
  assert.equal(sum(segs), 0);
});

test('缺字段的段被忽略', () => {
  const segs = computeSegments([{ start: '18:00' }, { end: '20:00' }, null], 'workday');
  assert.equal(segs.length, 0);
});

test('overtimeMinutes 对空记录返回 0', () => {
  assert.equal(overtimeMinutes(null, 'workday'), 0);
  assert.equal(overtimeMinutes({}, 'workday'), 0);
  assert.equal(overtimeMinutes({ overtime: [] }, 'workday'), 0);
});

test('leaveMinutes 按小时折算', () => {
  assert.equal(leaveMinutes({ leave: { type: 'annual', hours: 4 } }), 240);
  assert.equal(leaveMinutes({ leave: { type: 'annual', hours: 0 } }), 0);
  assert.equal(leaveMinutes({}), 0);
  assert.equal(leaveMinutes(null), 0);
});

/* ------------------------------------------------------------ 日期性质 */

test('dayKind：周一到周六是工作日', () => {
  // 2026-09-14 是周一
  for (let i = 0; i < 6; i += 1) {
    const d = new Date(2026, 8, 14 + i);
    assert.equal(dayKind(d, {}), 'workday', `${dateKey(d)} 应该是工作日`);
  }
});

test('dayKind：周日是休息日', () => {
  const sunday = new Date(2026, 8, 20);
  assert.equal(sunday.getDay(), 0);
  assert.equal(dayKind(sunday, {}), 'weekend');
});

test('dayKind：节假日数据会覆盖默认规则', () => {
  const d = new Date(2026, 0, 1);
  assert.equal(dayKind(d, {}), 'workday', '没有数据时 1 月 1 日按周四算工作日');
  assert.equal(dayKind(d, { '2026-01-01': { name: '元旦', off: true } }), 'holiday');
  // 调休上班：本来是周日，但要上班
  const sunday = new Date(2026, 8, 20);
  assert.equal(dayKind(sunday, { '2026-09-20': { name: '调休', off: false } }), 'swap');
});

/* ------------------------------------------------------------ 月份网格 */

test('buildMonthGrid：格子数是 7 的倍数且覆盖整月', () => {
  const cells = buildMonthGrid(2026, 8); // 2026 年 9 月
  assert.equal(cells.length % 7, 0);
  const inMonth = cells.filter((c) => c.inMonth);
  assert.equal(inMonth.length, 30, '9 月有 30 天');
  assert.equal(inMonth[0].date.getDate(), 1);
  assert.equal(inMonth[29].date.getDate(), 30);
});

test('buildMonthGrid：以周一打头', () => {
  const cells = buildMonthGrid(2026, 8);
  const first = cells.find((c) => c.inMonth);
  // 第一个在月内的格子前面应该是周一对齐
  assert.equal(cells[0].date.getDay(), 1, '第一个格子应该是周一');
  assert.ok(first.date.getDate() <= 7);
});

test('buildMonthGrid：二月闰年 29 天', () => {
  const cells = buildMonthGrid(2028, 1);
  assert.equal(cells.filter((c) => c.inMonth).length, 29);
});

/* ------------------------------------------------------------ 月度统计 */

test('summarizeMonth 汇总加班 / 请假 / 工作日', () => {
  const days = {
    '2026-09-03': { overtime: [{ start: '18:00', end: '21:00' }], leave: null }, // 周四 → 3h
    '2026-09-05': { overtime: [{ start: '09:00', end: '18:00' }], leave: null }, // 周六=工作日 → 只算午休那 2h
    '2026-09-16': { overtime: [], leave: { type: 'annual', hours: 8 } } // 请假 8h
  };
  const s = summarizeMonth(2026, 8, days, {});
  // 2026 年 9 月：周日 4 天，其余 26 天都是工作日（周一到周六）
  assert.equal(s.workdays, 26, '9 月工作日应为 26 天');
  assert.equal(s.overtime, 3 * 60 + 2 * 60, '周六是工作日，要按规则裁剪');
  assert.equal(s.leave, 8 * 60);
  assert.equal(s.restDaysWorked, 0, '周六不算休息日');
});

test('summarizeMonth 能数出休息日出勤的天数', () => {
  const days = {
    '2026-09-06': { overtime: [{ start: '09:00', end: '18:00' }], leave: null } // 周日
  };
  const s = summarizeMonth(2026, 8, days, {});
  assert.equal(s.restDaysWorked, 1);
  assert.equal(s.overtime, 9 * 60);
});

/* -------------------------------------------------- 自定义作息（向导） */

test('自定义作息：上午 09:00-12:00、下午 13:00-17:00', () => {
  const schedule = {
    workdays: [1, 2, 3, 4, 5],
    segments: [
      { start: '09:00', end: '12:00' },
      { start: '13:00', end: '17:00' }
    ]
  };
  // 17:00 才下班，之后全是加班
  assert.equal(sum(computeSegments([{ start: '17:00', end: '20:00' }], 'workday', schedule)), 180);
  // 新作息 9 点才上班，8-9 点算加班
  assert.equal(sum(computeSegments([{ start: '08:00', end: '09:00' }], 'workday', schedule)), 60);
  // 上班时段内不算加班
  assert.equal(sum(computeSegments([{ start: '10:00', end: '11:00' }], 'workday', schedule)), 0);
  // 午休 12:00-13:00 在作息之外，填了就算加班
  assert.equal(sum(computeSegments([{ start: '12:15', end: '12:45' }], 'workday', schedule)), 30);
});

test('自定义作息：只上周一到周五，周六变成休息日', () => {
  const schedule = { workdays: [1, 2, 3, 4, 5], segments: DEFAULT_SCHEDULE.segments };
  const saturday = new Date(2026, 8, 5);
  assert.equal(saturday.getDay(), 6);

  // 同一份数据，换作息后性质就变了
  assert.equal(dayKind(saturday, {}, schedule), 'weekend');
  assert.equal(dayKind(saturday, {}, DEFAULT_SCHEDULE), 'workday');
  // 休息日不裁剪
  assert.equal(sum(computeSegments([{ start: '09:00', end: '18:00' }], 'weekend', schedule)), 540);
});

test('自定义作息：一周上满七天', () => {
  const schedule = { workdays: [0, 1, 2, 3, 4, 5, 6], segments: DEFAULT_SCHEDULE.segments };
  const sunday = new Date(2026, 8, 6);
  assert.equal(sunday.getDay(), 0);
  assert.equal(dayKind(sunday, {}, schedule), 'workday');
  assert.equal(describeWorkdays(schedule), '每天');
});

test('自定义作息：单段作息（中午不休息）', () => {
  const schedule = { workdays: [1, 2, 3, 4, 5], segments: [{ start: '09:00', end: '18:00' }] };
  assert.equal(scheduleDailyMinutes(schedule), 540);
  assert.equal(sum(computeSegments([{ start: '18:00', end: '19:00' }], 'workday', schedule)), 60);
  // 这一段落在上班时段里，不算加班
  assert.equal(sum(computeSegments([{ start: '12:00', end: '13:00' }], 'workday', schedule)), 0);
});

test('normalizeSchedule 过滤脏数据', () => {
  assert.deepEqual(normalizeSchedule({ workdays: [1, 1, 9, -1, 3] }).workdays, [1, 3]);
  assert.deepEqual(normalizeSchedule({ workdays: [] }).workdays, DEFAULT_SCHEDULE.workdays);
  assert.deepEqual(normalizeSchedule(null).workdays, DEFAULT_SCHEDULE.workdays);
  // end 早于 start 的段被丢掉；全丢光就退回默认
  assert.equal(normalizeSchedule({ segments: [{ start: '20:00', end: '18:00' }] }).segments.length, 2);
  assert.equal(normalizeSchedule({ segments: [{ start: '09:00', end: '18:00' }] }).segments.length, 1);
});

test('describeWorkdays 说人话', () => {
  assert.equal(describeWorkdays({ workdays: [1, 2, 3, 4, 5, 6] }), '周一到周六');
  assert.equal(describeWorkdays({ workdays: [1, 2, 3, 4, 5] }), '周一到周五');
  assert.equal(describeWorkdays({ workdays: [1, 3, 5] }), '周一、周三、周五');
  assert.equal(describeWorkdays({ workdays: [0, 1, 2, 3, 4, 5, 6] }), '每天');
});

test('summarizeMonth 跟着作息变工作日数', () => {
  // 2026 年 9 月有 4 个周六 + 4 个周日
  const weekdaysOnly = { workdays: [1, 2, 3, 4, 5], segments: DEFAULT_SCHEDULE.segments };
  assert.equal(summarizeMonth(2026, 8, {}, {}, weekdaysOnly).workdays, 22);
  assert.equal(summarizeMonth(2026, 8, {}, {}, DEFAULT_SCHEDULE).workdays, 26);
});

/* ---------------------------------------------------------------- 跑 */

let failed = 0;
for (const { name, fn } of cases) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}`);
    console.log(`      ${error.message}`);
  }
}

console.log(`\n${passed} 通过 / ${failed} 失败（共 ${cases.length} 项）`);
process.exit(failed ? 1 : 0);
