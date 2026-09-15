'use strict';

/**
 * 节假日 / 调休数据（可选功能，不联网也能用）
 *
 * 三个源按顺序试，前一个失败就退到下一个：
 *   1. jsDelivr 上的 holiday-cn（国内访问快，数据来自国务院公告整理）
 *   2. GitHub Raw 上的同一份数据
 *   3. timor.tech 的 API
 *
 * 统一转成 { "2026-01-01": { name: "元旦", off: true } }，
 * off=true 是放假，off=false 是调休上班。
 */

const { net } = require('electron');

const SOURCES = [
  {
    id: 'jsdelivr',
    label: 'jsDelivr',
    url: (year) => `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`,
    parse: parseHolidayCn
  },
  {
    id: 'github',
    label: 'GitHub Raw',
    url: (year) => `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`,
    parse: parseHolidayCn
  },
  {
    id: 'timor',
    label: 'timor.tech',
    url: (year) => `https://timor.tech/api/holiday/year/${year}`,
    parse: parseTimor
  }
];

function parseHolidayCn(json) {
  if (!json || !Array.isArray(json.days)) return null;
  const out = {};
  for (const day of json.days) {
    if (!day || typeof day.date !== 'string') continue;
    out[day.date] = { name: day.name || '假日', off: day.isOffDay !== false };
  }
  return out;
}

function parseTimor(json) {
  if (!json || json.code !== 0 || !json.holiday || typeof json.holiday !== 'object') return null;
  const out = {};
  for (const item of Object.values(json.holiday)) {
    if (!item || typeof item.date !== 'string') continue;
    // timor 里 holiday:true 表示放假，false 表示调休要上班
    out[item.date] = { name: item.name || '假日', off: item.holiday !== false };
  }
  return out;
}

async function fetchJson(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await net.fetch(url, {
      signal: controller.signal,
      // GitHub Raw 不带 UA 有时会被拒
      headers: { 'User-Agent': 'overtime-calendar' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 同步某一年的节假日。
 * 返回 { ok, days, source, url } 或 { ok:false, errors:[...] }
 */
async function syncYear(year) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) {
    return { ok: false, errors: ['年份不合法'] };
  }

  const errors = [];
  for (const source of SOURCES) {
    const url = source.url(y);
    try {
      const json = await fetchJson(url);
      const days = source.parse(json);
      const count = days ? Object.keys(days).length : 0;
      if (!count) throw new Error('返回的数据是空的');
      return { ok: true, days, source: source.label, url, count };
    } catch (error) {
      const reason = error.name === 'AbortError' ? '请求超时' : error.message;
      errors.push(`${source.label}：${reason}`);
    }
  }

  return { ok: false, errors };
}

module.exports = { syncYear, SOURCES };
