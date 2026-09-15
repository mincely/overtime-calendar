// ─────────────────────────────────────────────────────────────
// 工时规则与计算
//
// 作息不再是写死的：首次使用时向导会问清楚「周几到周几上班」
// 和上下班时间，存进 schedule，之后所有计算都跟着这份作息走。
//
// 默认值就是原来那套：周一到周六上班，上午 08:00-12:00、下午 14:00-18:00。
// 时间一律换算成「分钟数」再算，避免浮点和跨小时加减的麻烦。
// ─────────────────────────────────────────────────────────────

/** 周一开头的一周顺序（Date.getDay() 里 0 是周日，所以顺序不是 0-6） */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** 表头用：周一 ~ 周日 */
export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

export const WEEKDAY_NAMES = {
  0: '周日',
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六'
};

export const DEFAULT_SCHEDULE = {
  // 0=周日 … 6=周六
  workdays: [1, 2, 3, 4, 5, 6],
  segments: [
    { start: '08:00', end: '12:00' },
    { start: '14:00', end: '18:00' }
  ]
};

export const LEAVE_TYPES = [
  { key: 'personal', label: '事假' },
  { key: 'sick', label: '病假' },
  { key: 'annual', label: '年假' },
  { key: 'compensatory', label: '调休' },
  { key: 'marriage', label: '婚假' },
  { key: 'maternity', label: '产假' },
  { key: 'other', label: '其他' }
];

/* ------------------------------------------------------------ 时间换算 */

export function toMinutes(hhmm) {
  if (typeof hhmm !== 'string') return null;
  const matched = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!matched) return null;
  const h = Number(matched[1]);
  const m = Number(matched[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export function toHHMM(minutes) {
  const total = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** 3 小时 30 分 */
export function formatDuration(minutes) {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} 分`;
  if (!m) return `${h} 小时`;
  return `${h} 小时 ${m} 分`;
}

/** 3.5 —— 统计栏用，紧凑 */
export function formatHours(minutes) {
  const value = Math.max(0, minutes) / 60;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/* ------------------------------------------------------------ 作息表 */

/** 把用户填的作息校验并规范成内部结构 */
export function normalizeSchedule(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};

  const workdays = Array.isArray(source.workdays)
    ? [...new Set(source.workdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    : [...DEFAULT_SCHEDULE.workdays];

  const segments = (Array.isArray(source.segments) ? source.segments : DEFAULT_SCHEDULE.segments)
    .filter((seg) => {
      if (!seg) return false;
      const start = toMinutes(seg.start);
      const end = toMinutes(seg.end);
      return start != null && end != null && end > start;
    })
    .slice(0, 4)
    .map((seg) => ({ start: seg.start, end: seg.end }));

  return {
    // 一天都不选的作息没法算加班，退回默认
    workdays: workdays.length ? workdays : [...DEFAULT_SCHEDULE.workdays],
    segments: segments.length ? segments : DEFAULT_SCHEDULE.segments.map((s) => ({ ...s }))
  };
}

/** 这份作息每天正常上班多少分钟 */
export function scheduleDailyMinutes(schedule) {
  const list = schedule?.segments || DEFAULT_SCHEDULE.segments;
  return list.reduce((sum, seg) => {
    const start = toMinutes(seg.start);
    const end = toMinutes(seg.end);
    return sum + (start != null && end != null && end > start ? end - start : 0);
  }, 0);
}

/** 「周一到周六」「周二、周四」这种人类可读的说法 */
export function describeWorkdays(schedule) {
  const days = [...(schedule?.workdays || DEFAULT_SCHEDULE.workdays)].sort((a, b) => a - b);
  if (!days.length) return '不固定';
  if (days.length === 7) return '每天';

  // 连续的一段就用「周X到周X」表达
  const sorted = WEEKDAY_ORDER.filter((d) => days.includes(d));
  const consecutive = sorted.every((d, i) => {
    if (i === 0) return true;
    const prevIndex = WEEKDAY_ORDER.indexOf(sorted[i - 1]);
    return WEEKDAY_ORDER.indexOf(d) === (prevIndex + 1) % 7;
  });

  if (consecutive && sorted.length > 2) {
    const from = WEEKDAY_NAMES[sorted[0]];
    const to = WEEKDAY_NAMES[sorted[sorted.length - 1]];
    return `${from}到${to}`;
  }

  return sorted.map((d) => WEEKDAY_NAMES[d]).join('、');
}

/** 「08:00-12:00、14:00-18:00」 */
export function describeSegments(schedule) {
  const list = schedule?.segments || DEFAULT_SCHEDULE.segments;
  return list.map((seg) => `${seg.start}-${seg.end}`).join('、');
}

/* ------------------------------------------------------------ 日期工具 */

export function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function monthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

export function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

/** 这个月排成周历需要多少格（周一开头），前后用相邻月补满整周 */
export function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  // getDay() 里 0 是周日，转成「周一开头」的 0-6
  const lead = (first.getDay() + 6) % 7;
  const total = daysInMonth(year, month);
  const cells = [];

  for (let i = 0; i < lead; i += 1) {
    const d = new Date(year, month, 1 - (lead - i));
    cells.push({ date: d, key: dateKey(d), inMonth: false });
  }
  for (let day = 1; day <= total; day += 1) {
    const d = new Date(year, month, day);
    cells.push({ date: d, key: dateKey(d), inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const d = new Date(year, month, total + (cells.length - lead - total) + 1);
    cells.push({ date: d, key: dateKey(d), inMonth: false });
  }

  return cells;
}

/* ------------------------------------------------------------ 日期性质 */

/**
 * workday 正常上班日
 * weekend 休息日
 * holiday 法定假日（放假）
 * swap    调休上班（本来是假日但要上班，按工作日算）
 */
export function dayKind(date, holidays = {}, schedule = DEFAULT_SCHEDULE) {
  const entry = holidays[dateKey(date)];
  if (entry) return entry.off ? 'holiday' : 'swap';
  const workdays = schedule?.workdays || DEFAULT_SCHEDULE.workdays;
  return workdays.includes(date.getDay()) ? 'workday' : 'weekend';
}

export function isRestDay(kind) {
  return kind === 'weekend' || kind === 'holiday';
}

export const KIND_LABELS = {
  workday: '工作日',
  weekend: '休息日',
  holiday: '法定假日',
  swap: '调休上班'
};

/* ------------------------------------------------------------ 加班计算 */

/**
 * 把填的时段按作息裁一遍。
 * 上班日要减掉作息里的正常时段（那几段不算加班）；
 * 休息日和法定假日全天都算加班，不裁。
 */
export function computeSegments(segments, kind, schedule = DEFAULT_SCHEDULE) {
  const parsed = (Array.isArray(segments) ? segments : [])
    .map((s) => ({ raw: s, start: toMinutes(s?.start), end: toMinutes(s?.end) }))
    .filter((s) => s.start != null && s.end != null && s.end > s.start);

  if (isRestDay(kind)) {
    return parsed.map((s) => ({ ...s, minutes: s.end - s.start, pieces: [[s.start, s.end]] }));
  }

  const blocks = (schedule?.segments || DEFAULT_SCHEDULE.segments)
    .map((s) => ({ start: toMinutes(s.start), end: toMinutes(s.end) }))
    .filter((s) => s.start != null && s.end != null && s.end > s.start);

  return parsed.map((seg) => {
    // 从整段里挖掉正常上班时段，剩下的就是加班
    let free = [[seg.start, seg.end]];
    for (const block of blocks) {
      const next = [];
      for (const [a, b] of free) {
        if (block.end <= a || block.start >= b) {
          next.push([a, b]);
          continue;
        }
        if (block.start > a) next.push([a, block.start]);
        if (block.end < b) next.push([block.end, b]);
      }
      free = next;
    }
    const minutes = free.reduce((sum, [a, b]) => sum + (b - a), 0);
    return { ...seg, minutes, pieces: free };
  });
}

/** 一天记录的加班总分钟数 */
export function overtimeMinutes(record, kind, schedule = DEFAULT_SCHEDULE) {
  if (!record || !Array.isArray(record.overtime)) return 0;
  return computeSegments(record.overtime, kind, schedule).reduce((sum, s) => sum + s.minutes, 0);
}

/** 一天记录的请假分钟数 */
export function leaveMinutes(record) {
  const hours = Number(record?.leave?.hours);
  return Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : 0;
}

export function leaveLabel(record) {
  const key = record?.leave?.type;
  if (!key) return '';
  return LEAVE_TYPES.find((t) => t.key === key)?.label || '请假';
}

/** 一条记录算不算「空的」——空的就从存储里删掉，别留一堆空对象 */
export function isEmptyRecord(record) {
  if (!record) return true;
  const hasOvertime = Array.isArray(record.overtime) && record.overtime.some((s) => s?.start && s?.end);
  const hasLeave = leaveMinutes(record) > 0;
  const hasNote = typeof record.note === 'string' && record.note.trim();
  return !hasOvertime && !hasLeave && !hasNote;
}

/* ------------------------------------------------------------ 月度统计 */

export function summarizeMonth(year, month, days, holidays, schedule = DEFAULT_SCHEDULE) {
  const total = daysInMonth(year, month);
  let overtime = 0;
  let leave = 0;
  let workdays = 0;
  let restDaysWorked = 0;

  for (let day = 1; day <= total; day += 1) {
    const date = new Date(year, month, day);
    const kind = dayKind(date, holidays, schedule);
    if (!isRestDay(kind)) workdays += 1;

    const record = days?.[dateKey(date)];
    const ot = overtimeMinutes(record, kind, schedule);
    if (ot > 0) {
      overtime += ot;
      if (isRestDay(kind)) restDaysWorked += 1;
    }
    leave += leaveMinutes(record);
  }

  return { overtime, leave, workdays, restDaysWorked, total };
}
