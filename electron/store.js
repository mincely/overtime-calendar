'use strict';

/**
 * 状态：窗口位置 + 每天的加班/请假记录 + 已同步的节假日。
 * 存 %APPDATA%\加班日历\calendar-state.json
 */

const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const THEMES = ['strawberry', 'mint', 'lavender', 'lemon', 'blueberry'];

const DEFAULT_STATE = {
  version: 1,
  bounds: null,
  theme: THEMES[0],
  // 用户的作息表；null 表示还没设置过，前端会弹首次使用向导
  schedule: null,
  days: {},
  holidays: {},
  holidaysYear: null,
  holidaysSyncedAt: null,
  holidaysSource: null,
  // 便利贴程序的 exe 路径，由用户指定
  stickyExePath: null
};

/**
 * 结构层的校验（业务层的完整校验在渲染进程的 worktime.js 里做）。
 * 这里只保证存进来的是个形状正确的东西，挡掉明显坏掉的数据。
 */
function normalizeSchedule(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const workdays = Array.isArray(raw.workdays)
    ? [...new Set(raw.workdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    : [];

  const segments = (Array.isArray(raw.segments) ? raw.segments : [])
    .filter((seg) => seg && typeof seg.start === 'string' && typeof seg.end === 'string')
    .slice(0, 4)
    .map((seg) => ({ start: seg.start, end: seg.end }));

  if (!workdays.length || !segments.length) return null;
  return { workdays, segments };
}

let state = null;
let saveTimer = null;

const statePath = () => path.join(app.getPath('userData'), 'calendar-state.json');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;

/** 只留合法的加班时段，脏数据直接丢掉而不是让它污染统计 */
function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const overtime = (Array.isArray(raw.overtime) ? raw.overtime : [])
    .filter((seg) => seg && TIME_RE.test(String(seg.start || '')) && TIME_RE.test(String(seg.end || '')))
    .slice(0, 6)
    .map((seg) => ({ start: String(seg.start), end: String(seg.end) }));

  const leaveHours = Number(raw.leave?.hours);
  const leave = Number.isFinite(leaveHours) && leaveHours > 0
    ? { type: typeof raw.leave?.type === 'string' ? raw.leave.type : 'other', hours: Math.min(24, leaveHours) }
    : null;

  const note = typeof raw.note === 'string' ? raw.note.slice(0, 200) : '';

  if (!overtime.length && !leave && !note.trim()) return null;
  return { overtime, leave, note };
}

function normalizeDays(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    if (!DATE_RE.test(key)) continue;
    const record = normalizeRecord(value);
    if (record) out[key] = record;
  }
  return out;
}

function normalizeHolidays(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    if (!DATE_RE.test(key) || !value || typeof value !== 'object') continue;
    out[key] = { name: String(value.name || '假日').slice(0, 20), off: value.off !== false };
  }
  return out;
}

function normalizeBounds(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { x, y, width, height } = raw;
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width < 400 || height < 400) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function normalize(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    version: 1,
    bounds: normalizeBounds(source.bounds),
    theme: THEMES.includes(source.theme) ? source.theme : THEMES[0],
    schedule: normalizeSchedule(source.schedule),
    stickyExePath: typeof source.stickyExePath === 'string' ? source.stickyExePath : null,
    days: normalizeDays(source.days),
    holidays: normalizeHolidays(source.holidays),
    holidaysYear: Number.isFinite(source.holidaysYear) ? source.holidaysYear : null,
    holidaysSyncedAt: Number.isFinite(source.holidaysSyncedAt) ? source.holidaysSyncedAt : null,
    holidaysSource: typeof source.holidaysSource === 'string' ? source.holidaysSource : null
  };
}

function read() {
  try {
    state = normalize(JSON.parse(fs.readFileSync(statePath(), 'utf8')));
  } catch {
    state = normalize(null);
  }
  return state;
}

function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    console.error('[calendar] 保存失败:', error);
  }
}

function queueSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}

module.exports = {
  THEMES,
  read,
  flush,
  queueSave,
  get: () => state,
  statePath,
  normalize,
  normalizeRecord,
  normalizeSchedule
};
