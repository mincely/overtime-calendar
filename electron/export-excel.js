'use strict';

/**
 * 导出月度加班汇总为 .xlsx
 *
 * 注意职责划分：工时的计算全部发生在渲染进程（那边有 worktime.js 和它的单测），
 * 这里只负责把算好的行数据铺进表格。主进程里再实现一遍规则是大忌 ——
 * 两处逻辑一旦不一致，导出的数字和界面上看到的对不上，会非常难查。
 */

const { app, dialog } = require('electron');
const path = require('node:path');
const ExcelJS = require('exceljs');

const HEADER_FILL = 'FFFFD9E3';
const TOTAL_FILL = 'FFFFF0F5';
const LINE = { style: 'thin', color: { argb: 'FFE8C4D0' } };
const BORDER = { top: LINE, left: LINE, bottom: LINE, right: LINE };

const COLUMNS = [
  { header: '日期', key: 'date', width: 13 },
  { header: '星期', key: 'weekday', width: 7 },
  { header: '性质', key: 'kind', width: 12 },
  { header: '加班时段', key: 'segments', width: 28 },
  { header: '加班时长', key: 'overtime', width: 11 },
  { header: '请假类型', key: 'leaveType', width: 11 },
  { header: '请假时长', key: 'leaveHours', width: 11 },
  { header: '备注', key: 'note', width: 26 }
];

/** 纯函数：给定行数据，造出一个 workbook（不碰磁盘，方便测试） */
function buildWorkbook(payload) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '加班日历';
  workbook.created = new Date();

  const sheetName = String(payload.sheetName || '加班记录').replace(/[[\]:*?/\\]/g, '').slice(0, 30);
  const sheet = workbook.addWorksheet(sheetName || '加班记录', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  sheet.columns = COLUMNS;

  const header = sheet.getRow(1);
  header.height = 22;
  header.font = { bold: true, size: 11 };
  header.alignment = { vertical: 'middle', horizontal: 'center' };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  });

  for (const row of payload.rows || []) {
    sheet.addRow({
      date: row.date || '',
      weekday: row.weekday || '',
      kind: row.kind || '',
      segments: row.segments || '',
      overtime: row.overtime || '',
      leaveType: row.leaveType || '',
      leaveHours: row.leaveHours || '',
      note: row.note || ''
    });
  }

  const summary = payload.summary || {};
  const total = sheet.addRow({
    date: '合计',
    kind: `${summary.workdays ?? 0} 个工作日`,
    overtime: summary.overtime || '0 小时',
    leaveHours: summary.leave || '0 小时'
  });
  total.font = { bold: true };
  total.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } };
  });

  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = BORDER;
    });
  });

  // 数字列居中，长文本列自动换行
  for (const index of [1, 2, 3, 5, 6, 7]) {
    sheet.getColumn(index).alignment = { horizontal: 'center', vertical: 'middle' };
  }
  sheet.getColumn(4).alignment = { vertical: 'middle', wrapText: true };
  sheet.getColumn(8).alignment = { vertical: 'middle', wrapText: true };

  return workbook;
}

/** 弹保存对话框并写出文件 */
async function exportMonth(parentWindow, payload) {
  if (!payload || !Array.isArray(payload.rows)) {
    return { ok: false, error: '没有可导出的数据' };
  }
  if (!payload.rows.length) {
    return { ok: false, error: '这个月还没有任何记录' };
  }

  const stamp = payload.fileStamp || 'export';
  const { canceled, filePath } = await dialog.showSaveDialog(parentWindow, {
    title: '导出加班汇总',
    defaultPath: path.join(app.getPath('documents'), `加班记录-${stamp}.xlsx`),
    filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
  });

  if (canceled || !filePath) return { ok: false, canceled: true };

  try {
    const workbook = buildWorkbook(payload);
    await workbook.xlsx.writeFile(filePath);
    return { ok: true, path: filePath };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = { exportMonth, buildWorkbook, COLUMNS };
