'use strict';

/**
 * 加班日历 —— 主进程
 *
 * 窗口本身只做展示和交互，所有数据读写、节假日联网都在这里。
 */

const { app, BrowserWindow, ipcMain, screen, Menu, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const store = require('./store');
const holidays = require('./holidays');
const exportExcel = require('./export-excel');
const stickyLink = require('./sticky-link');

const DEV = process.argv.includes('--dev');
const SMOKE = process.argv.includes('--smoke');
const SHOT = process.argv.includes('--shot');
const ICON = process.argv.includes('--icon');

// 自检 / 截图模式换一个独立的 userData。
// 否则会和用户正在运行的实例抢单实例锁，程序会静默退出、什么也不做，
// 表现成「测试莫名其妙没输出」。
if (SMOKE || SHOT || ICON) {
  const testDir = path.join(os.tmpdir(), 'overtime-calendar-test');
  if (SMOKE || SHOT) {
    // 每轮都从干净状态开始：上一轮存下的作息会让「首次向导」不再弹出，
    // 测试就变成不可重复的了
    fs.rmSync(path.join(testDir, 'calendar-state.json'), { force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });
  app.setPath('userData', testDir);
}

const DEV_SERVER = 'http://127.0.0.1:5173';

const MIN_SIZE = { width: 640, height: 600 };
const DEFAULT_SIZE = { width: 900, height: 838 };

let win = null;
let resizeSession = null;

const isWindowAlive = () => Boolean(win && !win.isDestroyed());

// ------------------------------------------------------------------ 窗口

function defaultBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.min(DEFAULT_SIZE.width, workArea.width - 80);
  const height = Math.min(DEFAULT_SIZE.height, workArea.height - 80);
  return {
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2 - 20)
  };
}

function captureBounds() {
  if (!isWindowAlive() || win.isMinimized() || win.isMaximized()) return;
  const b = win.getBounds();
  store.get().bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
  store.queueSave();
}

function createWindow() {
  const saved = store.get().bounds;
  const fallback = defaultBounds();

  win = new BrowserWindow({
    width: saved?.width || fallback.width,
    height: saved?.height || fallback.height,
    x: Number.isFinite(saved?.x) ? saved.x : fallback.x,
    y: Number.isFinite(saved?.y) ? saved.y : fallback.y,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,

    // 和套件其它窗口一致：无边框 + 透明底 + 圆角
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: '加班日历',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  win.setMenuBarVisibility(false);

  win.once('ready-to-show', () => {
    if (SMOKE) win.showInactive();
    else win.show();
  });

  win.on('moved', () => { if (!resizeSession) captureBounds(); });
  win.on('resized', () => { if (!resizeSession) captureBounds(); });
  win.on('close', () => { captureBounds(); store.flush(); });
  win.on('closed', () => { win = null; });

  if (DEV) win.loadURL(DEV_SERVER);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  if (SMOKE) runSmokeTest();
  if (SHOT) runScreenshots();
}

// ------------------------------------------------------------ 图标生成

async function buildIcons() {
  const holder = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    useContentSize: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });

  holder.loadFile(path.join(__dirname, 'icon.html'));
  holder.once('ready-to-show', () => holder.showInactive());

  await new Promise((resolve, reject) => {
    holder.webContents.once('did-finish-load', () => setTimeout(resolve, 1200));
    holder.webContents.once('did-fail-load', (_e, code, desc) => reject(new Error(`${code} ${desc}`)));
  });

  const shot = await holder.webContents.capturePage();
  const icon = shot.resize({ width: 512, height: 512, quality: 'best' });
  holder.destroy();

  const outDir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, 'icon.png');
  fs.writeFileSync(target, icon.toPNG());

  console.log(`ICON_OK ${target}`);
  app.exit(0);
}

// ---------------------------------------------------------------- 冒烟测试

function runSmokeTest() {
  const problems = [];

  win.webContents.on('console-message', (event, level, message) => {
    const lvl = typeof event?.level === 'string' ? event.level : level;
    const msg = typeof event?.message === 'string' ? event.message : message;
    if (lvl === 'error' || lvl === 'warning' || (typeof lvl === 'number' && lvl >= 2)) {
      problems.push(`${lvl}: ${msg}`);
    }
  });

  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      let probe = null;
      try {
        probe = await win.webContents.executeJavaScript(`(() => ({
          mounted: !!document.querySelector('#app > *'),
          heading: (document.querySelector('h1') || {}).textContent?.trim() || '',
          bridge: typeof window.calendar,
          dayCells: document.querySelectorAll('.day').length,
          wizardOpen: !!document.querySelector('.wizard'),
          summary: (document.querySelector('.summary') || {}).textContent?.replace(/\\s+/g, ' ').trim() || ''
        }))()`);
        if (!probe.mounted) problems.push('Vue 没有挂载');
        if (probe.bridge !== 'object') problems.push('preload 桥接缺失');
        if (probe.dayCells < 28) problems.push(`月历格子太少：${probe.dayCells}`);
      } catch (error) {
        problems.push(`probe failed: ${error.message}`);
      }

      // 存一天再读回来
      let roundTrip = null;
      try {
        const key = '2099-12-31';
        const before = store.get().days[key];
        const saved = store.normalizeRecord({
          overtime: [{ start: '18:00', end: '21:30' }],
          leave: { type: 'annual', hours: 3 },
          note: '冒烟测试'
        });
        store.get().days[key] = saved;

        const reopened = store.normalize(JSON.parse(JSON.stringify(store.get())));
        roundTrip = {
          stored: Boolean(reopened.days[key]),
          overtime: reopened.days[key]?.overtime?.[0] || null,
          leaveHours: reopened.days[key]?.leave?.hours ?? null,
          note: reopened.days[key]?.note || ''
        };
        if (!roundTrip.stored) problems.push('日期记录没有存下来');
        if (roundTrip.overtime?.start !== '18:00' || roundTrip.overtime?.end !== '21:30') {
          problems.push('加班时段读回来不一致');
        }
        if (roundTrip.leaveHours !== 3) problems.push('请假时长读回来不一致');

        // 清理
        if (before) store.get().days[key] = before;
        else delete store.get().days[key];
        store.flush();
      } catch (error) {
        problems.push(`roundTrip failed: ${error.message}`);
      }

      // 联网同步只做「不崩」验证：断网时应该优雅返回失败，而不是抛异常
      let sync = null;
      try {
        const result = await holidays.syncYear(2026);
        sync = result.ok
          ? { ok: true, source: result.source, count: result.count }
          : { ok: false, errors: result.errors };
      } catch (error) {
        problems.push(`syncHolidays 抛异常了: ${error.message}`);
      }

      // 向导流程：用真实鼠标事件点「开始使用」。
      // 必须走 sendInputEvent 而不是 element.click()：前者有命中测试，
      // 能揪出「按钮被遮罩挡住」这类问题，后者会直接派发事件绕过去。
      let wizardCheck = null;
      try {
        const before = await win.webContents.executeJavaScript(`(() => {
          const overlay = document.querySelector('.wizard');
          const btn = document.querySelector('.wizard .btn--primary');
          const rect = btn ? btn.getBoundingClientRect() : null;
          return {
            overlay: !!overlay,
            overlayTop: overlay ? Math.round(overlay.getBoundingClientRect().top) : null,
            label: btn ? btn.textContent.trim() : null,
            rect: rect ? {
              x: Math.round(rect.x), y: Math.round(rect.y),
              w: Math.round(rect.width), h: Math.round(rect.height)
            } : null
          };
        })()`);

        if (before.rect) {
          const x = before.rect.x + Math.round(before.rect.w / 2);
          const y = before.rect.y + Math.round(before.rect.h / 2);

          // 这一点上最顶层的元素到底是谁
          const hit = await win.webContents.executeJavaScript(
            `(() => { const el = document.elementFromPoint(${x}, ${y}); return el ? (el.className || el.tagName) : 'null'; })()`
          );

          win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
          win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });

          await new Promise((r) => setTimeout(r, 900));

          const after = await win.webContents.executeJavaScript(`(() => ({
            overlay: !!document.querySelector('.wizard'),
            schedule: (document.querySelector('.summary__item--schedule') || {}).textContent?.trim() || '',
            toast: (document.querySelector('.toast') || {}).textContent?.trim() || ''
          }))()`);

          wizardCheck = { before, hitTopElement: hit, after };

          if (!before.overlay) problems.push('首次向导没有自动弹出');
          if (after.overlay) {
            problems.push(`点了「开始使用」向导没关掉（命中元素=${hit}，提示=${after.toast || '无'}）`);
          }
          if (!after.schedule) problems.push('保存后统计栏没显示作息');
        } else {
          wizardCheck = { before, error: '找不到主按钮' };
          problems.push('向导里找不到主按钮');
        }
      } catch (error) {
        problems.push(`向导流程测试异常: ${error.message}`);
      }

      // 保存某天：走一遍真实 UI（点开一天 → 点保存），
      // 专门验证带 Vue 响应式对象的参数能不能过 IPC
      let daySaveCheck = null;
      try {
        const result = await win.webContents.executeJavaScript(`(async () => {
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const cells = [...document.querySelectorAll('.day')];
          const target = cells[10] || cells[0];
          if (!target) return { ok: false, error: '日历里没有格子' };

          target.click();
          await wait(600);

          const saveBtn = document.querySelector('.editor .btn--primary');
          if (!saveBtn) return { ok: false, error: '没找到保存按钮' };

          saveBtn.click();
          await wait(800);

          return {
            ok: true,
            toast: (document.querySelector('.toast') || {}).textContent?.trim() || ''
          };
        })()`);

        daySaveCheck = result;
        if (!result.ok) problems.push(`保存某天失败: ${result.error}`);
        else if (/出错|失败|could not be cloned/i.test(result.toast)) {
          problems.push(`保存某天报错: ${result.toast}`);
        }
      } catch (error) {
        problems.push(`保存某天测试异常: ${error.message}`);
      }

      // 作息：存一份自定义作息再读回来，确认向导填的东西能落盘
      let scheduleCheck = null;
      try {
        const before = store.get().schedule;
        store.get().schedule = store.normalizeSchedule({
          workdays: [1, 2, 3, 4, 5],
          segments: [{ start: '09:00', end: '18:00' }]
        });
        const reopened = store.normalize(JSON.parse(JSON.stringify(store.get())));
        scheduleCheck = {
          stored: Boolean(reopened.schedule),
          workdays: reopened.schedule?.workdays || null,
          segments: reopened.schedule?.segments || null
        };
        if (!scheduleCheck.stored) problems.push('作息没有存下来');
        if (scheduleCheck.workdays?.length !== 5) problems.push('作息的工作日读回来不对');
        if (scheduleCheck.segments?.[0]?.start !== '09:00') problems.push('作息的时间段读回来不对');

        store.get().schedule = before;
        store.flush();
      } catch (error) {
        problems.push(`作息往返失败: ${error.message}`);
      }

      // 导出：真的造一个 xlsx 写出来，确认 exceljs 在当前环境里跑得通
      let exportCheck = null;
      try {
        const workbook = exportExcel.buildWorkbook({
          sheetName: '2026年9月',
          rows: [
            { date: '9 月 3 日', weekday: '周四', kind: '工作日', segments: '18:00-21:00', overtime: '3 小时', leaveType: '', leaveHours: '', note: '' },
            { date: '9 月 16 日', weekday: '周三', kind: '工作日', segments: '', overtime: '', leaveType: '年假', leaveHours: '8 小时', note: '' }
          ],
          summary: { workdays: 25, overtime: '3 小时', leave: '8 小时' }
        });
        const tmpFile = path.join(app.getPath('temp'), 'calendar-export-smoke.xlsx');
        await workbook.xlsx.writeFile(tmpFile);
        const size = fs.statSync(tmpFile).size;
        exportCheck = { ok: size > 0, size };
        fs.rmSync(tmpFile, { force: true });
        if (!exportCheck.ok) problems.push('导出的 xlsx 是空文件');
      } catch (error) {
        problems.push(`导出测试失败: ${error.message}`);
      }

      // 便利贴联动：先用临时目录造一份数据验证「读得到」，
      // 再读真实环境（用户可能压根没装便利贴，读不到也不该报错）
      let stickyCheck = null;
      try {
        const sandbox = path.join(app.getPath('temp'), 'sticky-link-smoke');
        const fakeDir = path.join(sandbox, '马卡龙便利贴');
        fs.mkdirSync(fakeDir, { recursive: true });
        fs.writeFileSync(
          path.join(fakeDir, 'sticky-note-state.json'),
          JSON.stringify({
            version: 1,
            theme: 'mint',
            todos: [
              { id: 'a', text: '把照片丢进收纳箱', done: false },
              { id: 'b', text: '导出给客户', done: true },
              { id: 'c', text: '   ', done: false }
            ]
          }),
          'utf8'
        );

        const fake = stickyLink.findStickyState(sandbox);
        const real = stickyLink.findStickyState();

        stickyCheck = {
          parseOk: fake.ok,
          parsedCount: fake.ok ? fake.todos.length : 0,
          trimmed: fake.ok && fake.todos.every((t) => t.text.trim() === t.text),
          firstText: fake.ok ? fake.todos[0]?.text : null,
          doneFlags: fake.ok ? fake.todos.map((t) => t.done) : null,
          realWorld: real.ok ? { ok: true, source: real.source, count: real.todos.length } : { ok: false }
        };

        // 空白待办应该被过滤掉，3 条进 2 条出
        if (!fake.ok) problems.push('便利贴读取测试失败：应该能读到');
        if (stickyCheck.parsedCount !== 2) problems.push(`空白待办没被过滤：期望 2 条，实际 ${stickyCheck.parsedCount}`);
        if (!stickyCheck.trimmed) problems.push('待办文本没有 trim');

        fs.rmSync(sandbox, { recursive: true, force: true });
      } catch (error) {
        problems.push(`便利贴读取测试异常: ${error.message}`);
      }

      const payload = {
        problems,
        probe,
        wizardCheck,
        daySaveCheck,
        roundTrip,
        scheduleCheck,
        sync,
        exportCheck,
        stickyCheck,
        statePath: store.statePath()
      };

      console.log('SMOKE_RESULT ' + JSON.stringify(payload, null, 2));
      try {
        fs.writeFileSync(
          path.join(require('node:os').tmpdir(), 'calendar-smoke.json'),
          JSON.stringify(payload, null, 2),
          'utf8'
        );
      } catch {
        /* 忽略 */
      }

      app.exit(problems.length ? 1 : 0);
    }, 2400);
  });
}

// ------------------------------------------------------------------ 截图

async function runScreenshots() {
  const outDir = path.join(__dirname, '..', '.shots');
  const shots = [
    // 第一张留作首次向导：此时还没设置过作息，向导是打开的
    { name: 'wizard', backdrop: '#eef0f4', script: '' },
    {
      name: 'month',
      backdrop: '#eef0f4',
      script: `document.body.dataset.theme = "strawberry";
        window.__setSchedule && window.__setSchedule({
          workdays: [1, 2, 3, 4, 5, 6],
          segments: [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }]
        })`
    },
    { name: 'editor', backdrop: '#eef0f4', script: 'window.__openDay && window.__openDay()' },
    { name: 'theme-mint', backdrop: '#eef0f4', script: 'document.body.dataset.theme = "mint"' },
    { name: 'sticky-panel', backdrop: '#eef0f4', script: 'window.__openSticky && window.__openSticky()' }
  ];

  try {
    fs.mkdirSync(outDir, { recursive: true });
    await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    await new Promise((r) => setTimeout(r, 1800));

    for (const shot of shots) {
      const info = await win.webContents.executeJavaScript(`(() => {
        document.documentElement.style.background = ${JSON.stringify(shot.backdrop)};
        document.body.style.background = ${JSON.stringify(shot.backdrop)};
        window.__demo && window.__demo();
        ${shot.script};
        const paper = document.querySelector('.paper');
        return {
          radius: paper ? getComputedStyle(paper).borderTopLeftRadius : 'none',
          days: document.querySelectorAll('.day').length,
          editorOpen: !!document.querySelector('.editor.is-open')
        };
      })()`);
      console.log(`SHOT_INFO ${shot.name} ${JSON.stringify(info)}`);
      await new Promise((r) => setTimeout(r, 600));
      fs.writeFileSync(path.join(outDir, `${shot.name}.png`), (await win.webContents.capturePage()).toPNG());
    }

    console.log('SHOT_OK ' + outDir);
  } catch (error) {
    console.error('SHOT_FAILED ' + error.message);
    app.exit(1);
    return;
  }
  app.exit(0);
}

// -------------------------------------------------------------------- IPC

function registerIpc() {
  ipcMain.handle('cal:state', () => {
    const s = store.get();
    return {
      theme: s.theme,
      schedule: s.schedule,
      days: s.days,
      holidays: s.holidays,
      holidaysYear: s.holidaysYear,
      holidaysSyncedAt: s.holidaysSyncedAt,
      holidaysSource: s.holidaysSource
    };
  });

  ipcMain.handle('cal:save-day', (_event, key, record) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key))) {
      return { ok: false, error: '日期不合法' };
    }
    const clean = record ? store.normalizeRecord(record) : null;
    if (clean) store.get().days[key] = clean;
    else delete store.get().days[key];
    store.queueSave();
    return { ok: true, record: clean };
  });

  ipcMain.handle('cal:sync-holidays', async (_event, year) => {
    const result = await holidays.syncYear(year);
    if (!result.ok) return result;

    const s = store.get();
    // 只替换同一年份的数据，别的年份留着
    const prefix = String(year);
    for (const key of Object.keys(s.holidays)) {
      if (key.startsWith(prefix)) delete s.holidays[key];
    }
    Object.assign(s.holidays, result.days);
    s.holidaysYear = Number(year);
    s.holidaysSyncedAt = Date.now();
    s.holidaysSource = result.source;
    store.queueSave();

    return { ok: true, count: result.count, source: result.source, days: result.days };
  });

  ipcMain.handle('cal:set-theme', (_event, theme) => {
    if (!store.THEMES.includes(theme)) return { ok: false, error: '未知配色' };
    store.get().theme = theme;
    store.queueSave();
    return { ok: true, theme };
  });

  /** 首次向导或「工作时间」面板保存作息 */
  ipcMain.handle('cal:set-schedule', (_event, schedule) => {
    const clean = store.normalizeSchedule(schedule);
    if (!clean) return { ok: false, error: '作息设置不完整：至少要选一天上班，并填好上下班时间' };
    store.get().schedule = clean;
    store.queueSave();
    return { ok: true, schedule: clean };
  });

  ipcMain.handle('cal:clear-holidays', () => {
    const s = store.get();
    s.holidays = {};
    s.holidaysYear = null;
    s.holidaysSyncedAt = null;
    s.holidaysSource = null;
    store.queueSave();
    return { ok: true };
  });

  /* ------------------------------------------------------- 导出 Excel */

  ipcMain.handle('cal:export-excel', (event, payload) => {
    const parent = BrowserWindow.fromWebContents(event.sender) || undefined;
    return exportExcel.exportMonth(parent, payload);
  });

  /* --------------------------------------------------- 便利贴联动 */

  ipcMain.handle('sticky:read', () => stickyLink.findStickyState());

  ipcMain.handle('sticky:info', () => {
    const exePath = store.get().stickyExePath;
    return {
      exePath: exePath || null,
      exists: Boolean(exePath && fs.existsSync(exePath))
    };
  });

  ipcMain.handle('sticky:locate', async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender) || undefined;
    const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
      title: '选择「便利贴」程序',
      properties: ['openFile'],
      filters: [{ name: '可执行文件', extensions: ['exe'] }]
    });
    if (canceled || !filePaths.length) return { ok: false, canceled: true };

    store.get().stickyExePath = filePaths[0];
    store.queueSave();
    return { ok: true, exePath: filePaths[0] };
  });

  ipcMain.handle('sticky:launch', async () => {
    const exePath = store.get().stickyExePath;
    if (!exePath || !fs.existsSync(exePath)) {
      return { ok: false, error: '还没指定便利贴程序的位置' };
    }
    // openPath 返回的是错误字符串，空串表示成功
    const error = await shell.openPath(exePath);
    return error ? { ok: false, error } : { ok: true };
  });

  ipcMain.on('window:minimize', () => {
    if (isWindowAlive()) win.minimize();
  });

  ipcMain.on('window:close', () => {
    if (isWindowAlive()) win.close();
  });

  // 无边框透明窗口在 Windows 上拖边缘不好使，右下角自定义拉伸
  ipcMain.on('window:resize-begin', () => {
    if (!isWindowAlive()) return;
    const b = win.getBounds();
    const cursor = screen.getCursorScreenPoint();
    resizeSession = { cursorX: cursor.x, cursorY: cursor.y, width: b.width, height: b.height };
  });

  ipcMain.on('window:resize-move', () => {
    if (!resizeSession || !isWindowAlive()) return;
    const cursor = screen.getCursorScreenPoint();
    const width = Math.max(MIN_SIZE.width, resizeSession.width + (cursor.x - resizeSession.cursorX));
    const height = Math.max(MIN_SIZE.height, resizeSession.height + (cursor.y - resizeSession.cursorY));
    win.setBounds({ width: Math.round(width), height: Math.round(height) });
  });

  ipcMain.on('window:resize-end', () => {
    if (!resizeSession) return;
    resizeSession = null;
    captureBounds();
  });
}

// ------------------------------------------------------------------ 生命周期

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!isWindowAlive()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.macaron.overtime-calendar');
    Menu.setApplicationMenu(null);

    store.read();
    registerIpc();

    if (ICON) {
      buildIcons().catch((error) => {
        console.error('ICON_FAILED ' + error.message);
        app.exit(1);
      });
      return;
    }

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', () => {
    captureBounds();
    store.flush();
  });
}
