'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('calendar', {
  state: () => ipcRenderer.invoke('cal:state'),

  /** record 传 null 表示把这天的记录清掉 */
  saveDay: (key, record) => ipcRenderer.invoke('cal:save-day', key, record),

  /** 记住当前配色 */
  setTheme: (theme) => ipcRenderer.invoke('cal:set-theme', theme),

  /** 保存作息表（首次向导 / 工作时间面板） */
  setSchedule: (schedule) => ipcRenderer.invoke('cal:set-schedule', schedule),

  /** 联网拉某一年的节假日 / 调休；失败会返回 { ok:false, errors:[...] } 而不是抛异常 */
  syncHolidays: (year) => ipcRenderer.invoke('cal:sync-holidays', year),
  clearHolidays: () => ipcRenderer.invoke('cal:clear-holidays'),

  /** 导出月度汇总为 xlsx（主进程负责铺表格 + 弹保存框） */
  exportExcel: (payload) => ipcRenderer.invoke('cal:export-excel', payload),

  /** 与「便利贴」联动 */
  stickyRead: () => ipcRenderer.invoke('sticky:read'),
  stickyInfo: () => ipcRenderer.invoke('sticky:info'),
  stickyLocate: () => ipcRenderer.invoke('sticky:locate'),
  stickyLaunch: () => ipcRenderer.invoke('sticky:launch'),

  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  resizeBegin: () => ipcRenderer.send('window:resize-begin'),
  resizeMove: () => ipcRenderer.send('window:resize-move'),
  resizeEnd: () => ipcRenderer.send('window:resize-end')
});
