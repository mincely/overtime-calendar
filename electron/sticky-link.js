'use strict';

/**
 * 与「便利贴」联动
 *
 * 读数据：依次尝试几个可能的 userData 目录，谁有待办数据就用谁。
 *   %APPDATA%\马卡龙便利贴\sticky-note-state.json   ← 独立便利贴（打包版）
 *   %APPDATA%\macaron-sticky-notes\...              ← 独立便利贴（开发版）
 *   %APPDATA%\马卡龙套件\suite-state.json            ← 套件里的便利贴模块
 *
 * 启动程序：exe 路径由用户在界面上指定，记在 store 里。
 */

const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

function readTodos(raw) {
  if (Array.isArray(raw?.todos)) return raw.todos;
  // 套件把便利贴的数据放在 sticky 字段下
  if (Array.isArray(raw?.sticky?.todos)) return raw.sticky.todos;
  return null;
}

function candidates(baseDir) {
  // baseDir 只给测试用，正常走 app.getPath('appData')
  const appData = baseDir || app.getPath('appData');
  return [
    {
      file: path.join(appData, '马卡龙便利贴', 'sticky-note-state.json'),
      source: '便利贴'
    },
    {
      file: path.join(appData, 'macaron-sticky-notes', 'sticky-note-state.json'),
      source: '便利贴（开发版）'
    },
    {
      file: path.join(appData, '马卡龙套件', 'suite-state.json'),
      source: '马卡龙套件'
    }
  ];
}

/** 找到第一份能读的便利贴数据 */
function findStickyState(baseDir) {
  const tried = [];

  for (const candidate of candidates(baseDir)) {
    if (!fs.existsSync(candidate.file)) {
      tried.push({ file: candidate.file, reason: '文件不存在' });
      continue;
    }

    try {
      // 先剥掉 BOM：有些工具（比如 PowerShell 的 Set-Content -Encoding UTF8）写出来的
      // JSON 会带 BOM，直接 JSON.parse 会抛错
      const text = fs.readFileSync(candidate.file, 'utf8').replace(/^\uFEFF/, '');
      const raw = JSON.parse(text);
      const todos = readTodos(raw);
      if (!todos) {
        tried.push({ file: candidate.file, reason: '里面没有待办数据' });
        continue;
      }

      return {
        ok: true,
        source: candidate.source,
        file: candidate.file,
        updatedAt: fs.statSync(candidate.file).mtimeMs,
        todos: todos
          .filter((item) => item && typeof item.text === 'string' && item.text.trim())
          .map((item) => ({
            text: String(item.text).slice(0, 200),
            done: Boolean(item.done)
          }))
      };
    } catch (error) {
      tried.push({ file: candidate.file, reason: error.message });
    }
  }

  return { ok: false, error: '没有找到便利贴的数据', tried };
}

/** 便利贴自己的颜色主题，可以拿来给面板上个色（暂时没用上，先带着） */
function findStickyTheme(baseDir) {
  for (const candidate of candidates(baseDir)) {
    try {
      const text = fs.readFileSync(candidate.file, 'utf8').replace(/^\uFEFF/, '');
      const raw = JSON.parse(text);
      const theme = raw?.theme || raw?.sticky?.theme;
      if (typeof theme === 'string' && theme) return theme;
    } catch {
      /* 忽略 */
    }
  }
  return null;
}

module.exports = { findStickyState, findStickyTheme };
