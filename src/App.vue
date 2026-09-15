<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import CalendarGrid from './components/CalendarGrid.vue';
import DayEditor from './components/DayEditor.vue';
import SetupWizard from './components/SetupWizard.vue';
import StickyPanel from './components/StickyPanel.vue';
import SummaryBar from './components/SummaryBar.vue';
import {
  buildMonthGrid,
  computeSegments,
  dateKey,
  dayKind,
  daysInMonth,
  DEFAULT_SCHEDULE,
  describeSegments,
  describeWorkdays,
  formatDuration,
  KIND_LABELS,
  leaveLabel,
  leaveMinutes,
  monthKey,
  normalizeSchedule,
  overtimeMinutes,
  parseKey,
  scheduleDailyMinutes,
  summarizeMonth
} from '@/shared/worktime';

const api = window.calendar;

const today = new Date();
const todayKey = dateKey(today);

const year = ref(today.getFullYear());
const month = ref(today.getMonth());
const direction = ref('next');

const days = ref({});
const holidays = ref({});
const holidaysMeta = ref({ year: null, syncedAt: null, source: null });

const selectedKey = ref(todayKey);
const editorOpen = ref(false);
const panelTab = ref('day'); // day | sticky
const syncing = ref(false);
const exporting = ref(false);
const toast = ref('');
const toastError = ref(false);

const THEMES = ['strawberry', 'mint', 'lavender', 'lemon', 'blueberry'];
const theme = ref('strawberry');
const fxClass = ref('');

// 作息：null 表示还没设置过，会弹首次使用向导
const schedule = ref(null);
const wizardOpen = ref(false);
const firstRun = ref(false);

let toastTimer = null;
let fxTimer = null;
let resizeActive = false;

const cells = computed(() => buildMonthGrid(year.value, month.value));
const gridKey = computed(() => monthKey(year.value, month.value));
const monthLabel = computed(() => `${year.value} 年 ${month.value + 1} 月`);
const summary = computed(() =>
  summarizeMonth(year.value, month.value, days.value, holidays.value, schedule.value)
);

const selectedKind = computed(() =>
  selectedKey.value ? dayKind(parseKey(selectedKey.value), holidays.value, schedule.value) : 'workday'
);

/** 当前作息的一句话描述，摆在统计栏旁边，随时能确认按什么规则在算 */
const scheduleText = computed(() => {
  const s = schedule.value || DEFAULT_SCHEDULE;
  return `${describeWorkdays(s)} · ${describeSegments(s)}`;
});
const selectedRecord = computed(() => days.value[selectedKey.value] || null);
const selectedHolidayName = computed(() => holidays.value[selectedKey.value]?.name || '');

/* -------------------------------------------------------------- 工具 */

/**
 * IPC 只能传可以被「结构化克隆」的数据，而 Vue 的响应式对象是 Proxy，
 * 直接丢给 ipcRenderer.invoke 会抛 "An object could not be cloned"。
 * 所有跨进程的参数都先过这一道，转成纯数据。
 */
const toPlain = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

/* -------------------------------------------------------------- 提示 */

function flash(text, isError = false) {
  toast.value = text;
  toastError.value = isError;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = '';
  }, 2800);
}

/** 保存作息（首次向导和工作时间面板共用） */
async function saveSchedule(next) {
  try {
    if (!api?.setSchedule) {
      // 接口缺失时绝不能静默失败 —— 之前这里会直接抛异常，
      // 表现成「点了按钮没反应」，查起来非常费劲
      flash('保存接口不可用，preload 可能没加载上', true);
      return false;
    }

    const res = await api.setSchedule(toPlain(next));
    if (!res?.ok) {
      flash(res?.error || '保存作息失败', true);
      return false;
    }

    schedule.value = normalizeSchedule(res.schedule);
    wizardOpen.value = false;
    firstRun.value = false;
    flash('作息已保存，加班按新规则重算');
    return true;
  } catch (error) {
    flash(`保存作息出错：${error.message}`, true);
    return false;
  }
}

/** 首次向导里选「用默认作息」 */
function useDefaultSchedule() {
  saveSchedule({
    workdays: [...DEFAULT_SCHEDULE.workdays],
    segments: DEFAULT_SCHEDULE.segments.map((s) => ({ ...s }))
  });
}

function openScheduleWizard() {
  firstRun.value = false;
  wizardOpen.value = true;
}

/* -------------------------------------------------------------- 配色 */

function applyTheme() {
  document.body.dataset.theme = theme.value;
}

function cycleTheme() {
  const i = THEMES.indexOf(theme.value);
  theme.value = THEMES[(i + 1) % THEMES.length];
  applyTheme();
  api?.setTheme(theme.value);

  // 换色时轻轻弹一下
  fxClass.value = '';
  void document.body.offsetWidth;
  fxClass.value = 'is-swapping';
  clearTimeout(fxTimer);
  fxTimer = setTimeout(() => {
    fxClass.value = '';
  }, 340);
}

/* ------------------------------------------------------------ 翻月 */

function go(delta) {
  direction.value = delta > 0 ? 'next' : 'prev';
  const d = new Date(year.value, month.value + delta, 1);
  year.value = d.getFullYear();
  month.value = d.getMonth();
}

function goToday() {
  const nowIndex = today.getFullYear() * 12 + today.getMonth();
  const curIndex = year.value * 12 + month.value;
  direction.value = curIndex > nowIndex ? 'prev' : 'next';
  year.value = today.getFullYear();
  month.value = today.getMonth();
  selectedKey.value = todayKey;
  editorOpen.value = true;
}

/* ------------------------------------------------------------ 选中 / 存取 */

function select(cell) {
  selectedKey.value = cell.key;
  panelTab.value = 'day';
  editorOpen.value = true;
}

function openStickyPanel() {
  // 已经开着便利贴面板时再点一次就收起来
  if (panelTab.value === 'sticky' && editorOpen.value) {
    editorOpen.value = false;
    return;
  }
  panelTab.value = 'sticky';
  editorOpen.value = true;
}

/* ---------------------------------------------------------- 导出 Excel */

/**
 * 把当月有记录的日期整理成表格行。
 * 工时计算复用 worktime.js —— 主进程拿到的是算好的结果，不重复实现规则。
 */
function collectExportRows() {
  const rows = [];
  const total = daysInMonth(year.value, month.value);

  for (let day = 1; day <= total; day += 1) {
    const date = new Date(year.value, month.value, day);
    const key = dateKey(date);
    const record = days.value[key];
    const kind = dayKind(date, holidays.value, schedule.value);
    const overtime = overtimeMinutes(record, kind, schedule.value);
    const leave = leaveMinutes(record);
    const note = record?.note || '';

    // 没记录的日子不往表里塞，导出来清爽一点
    if (!overtime && !leave && !note) continue;

    const segments = computeSegments(record?.overtime || [], kind, schedule.value)
      .filter((seg) => seg.minutes > 0)
      .map((seg) => `${seg.raw.start}-${seg.raw.end}`)
      .join('、');

    rows.push({
      date: `${month.value + 1} 月 ${day} 日`,
      weekday: `周${'日一二三四五六'[date.getDay()]}`,
      kind: holidays.value[key]?.name || KIND_LABELS[kind] || '',
      segments,
      overtime: overtime ? formatDuration(overtime) : '',
      leaveType: leave ? leaveLabel(record) : '',
      leaveHours: leave ? formatDuration(leave) : '',
      note
    });
  }

  return rows;
}

async function doExport() {
  if (exporting.value) return;

  const rows = collectExportRows();
  if (!rows.length) {
    flash('这个月还没有任何记录', true);
    return;
  }

  exporting.value = true;
  try {
    const res = await api.exportExcel({
      sheetName: `${year.value}年${month.value + 1}月`,
      fileStamp: `${year.value}-${String(month.value + 1).padStart(2, '0')}`,
      rows,
      summary: {
        workdays: summary.value.workdays,
        overtime: formatDuration(summary.value.overtime),
        leave: formatDuration(summary.value.leave)
      }
    });

    if (res?.canceled) return;
    if (res?.ok) {
      const name = String(res.path).split(/[\\/]/).pop();
      flash(`已导出：${name}`);
    } else {
      flash(res?.error || '导出失败', true);
    }
  } catch (error) {
    flash(`导出出错：${error.message}`, true);
  } finally {
    exporting.value = false;
  }
}

async function saveRecord(record) {
  const key = selectedKey.value;
  // record 里带着 Vue 的响应式数组，不净化的话同样过不了 IPC
  const res = await api?.saveDay(key, record ? toPlain(record) : null);
  if (!res?.ok) {
    flash(res?.error || '保存失败', true);
    return;
  }
  if (res.record) days.value = { ...days.value, [key]: res.record };
  else {
    const next = { ...days.value };
    delete next[key];
    days.value = next;
  }
  flash('已保存');
}

async function clearRecord() {
  const key = selectedKey.value;
  const res = await api?.saveDay(key, null);
  if (!res?.ok) {
    flash(res?.error || '清空失败', true);
    return;
  }
  const next = { ...days.value };
  delete next[key];
  days.value = next;
  flash('已清空这天');
}

/* ------------------------------------------------------------ 节假日 */

async function syncHolidays() {
  if (syncing.value) return;
  syncing.value = true;
  try {
    const res = await api.syncHolidays(year.value);
    if (res?.ok) {
      const merged = { ...holidays.value };
      const prefix = String(year.value);
      for (const key of Object.keys(merged)) {
        if (key.startsWith(prefix)) delete merged[key];
      }
      Object.assign(merged, res.days);
      holidays.value = merged;
      holidaysMeta.value = { year: year.value, syncedAt: Date.now(), source: res.source };
      flash(`已同步 ${year.value} 年 ${res.count} 条节假日（${res.source}）`);
    } else {
      flash(res?.errors?.[0] || '同步失败，检查下网络', true);
    }
  } catch (error) {
    flash(`同步出错：${error.message}`, true);
  } finally {
    syncing.value = false;
  }
}

/* --------------------------------------------------------- 右下角拉伸 */

function onResizeStart(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  resizeActive = true;
  event.currentTarget.setPointerCapture(event.pointerId);
  api?.resizeBegin();
}

function onResizeMove() {
  if (resizeActive) api?.resizeMove();
}

function onResizeEnd(event) {
  if (!resizeActive) return;
  resizeActive = false;
  try {
    event.currentTarget.releasePointerCapture(event.pointerId);
  } catch {
    /* 指针已经释放 */
  }
  api?.resizeEnd();
}

/* ------------------------------------------------------------ 生命周期 */

onMounted(async () => {
  if (!api) return;

  const saved = await api.state();
  days.value = saved?.days || {};
  theme.value = THEMES.includes(saved?.theme) ? saved.theme : THEMES[0];
  applyTheme();

  // 没设置过作息 → 弹首次使用向导，让用户先定规则再看日历
  if (saved?.schedule) {
    schedule.value = normalizeSchedule(saved.schedule);
  } else {
    firstRun.value = true;
    wizardOpen.value = true;
  }
  holidays.value = saved?.holidays || {};
  holidaysMeta.value = {
    year: saved?.holidaysYear ?? null,
    syncedAt: saved?.holidaysSyncedAt ?? null,
    source: saved?.holidaysSource ?? null
  };

  const pad = (n) => String(n).padStart(2, '0');
  const inThisMonth = (day) => `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(day)}`;

  // 截图用的假数据
  window.__demo = () => {
    days.value = {
      [inThisMonth(3)]: { overtime: [{ start: '18:30', end: '21:30' }], leave: null, note: '' },
      [inThisMonth(8)]: { overtime: [{ start: '19:00', end: '22:00' }], leave: null, note: '' },
      [inThisMonth(11)]: {
        overtime: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '17:00' }],
        leave: null,
        note: '周末赶版本'
      },
      [inThisMonth(15)]: { overtime: [{ start: '18:00', end: '20:00' }], leave: null, note: '' },
      [inThisMonth(16)]: { overtime: [], leave: { type: 'annual', hours: 8 }, note: '' },
      [inThisMonth(22)]: { overtime: [{ start: '18:00', end: '21:00' }], leave: null, note: '' }
    };
    holidays.value = {
      ...holidays.value,
      [inThisMonth(11)]: { name: '周六值班', off: false }
    };
  };

  window.__openDay = () => {
    panelTab.value = 'day';
    editorOpen.value = true;
  };

  window.__openSticky = () => {
    panelTab.value = 'sticky';
    editorOpen.value = true;
  };

  window.__setSchedule = (next) => {
    schedule.value = normalizeSchedule(next);
    wizardOpen.value = false;
  };

  window.__openWizard = () => {
    firstRun.value = false;
    wizardOpen.value = true;
  };
});

onBeforeUnmount(() => {
  clearTimeout(toastTimer);
  clearTimeout(fxTimer);
  delete window.__demo;
  delete window.__openDay;
  delete window.__openSticky;
  delete window.__setSchedule;
  delete window.__openWizard;
});
</script>

<template>
  <div class="app">
    <!-- 图钉必须放在纸片外面：.paper 有 overflow:hidden（为了让内部滚动被圆角裁切），
         图钉的 top 是负值，放里面会被整个裁掉 -->
    <span class="pin" style="top: 7px"><i></i></span>

    <div class="paper" :class="fxClass">
      <header class="bar">
        <h1 class="bar__title">加班日历</h1>
        <div class="bar__tools">
          <button class="tool" type="button" title="换个颜色" aria-label="换个颜色" @click="cycleTheme">
            🎨
          </button>
          <button
            class="tool"
            type="button"
            title="导出本月汇总为 Excel"
            aria-label="导出 Excel"
            :disabled="exporting"
            @click="doExport"
          >
            {{ exporting ? '⏳' : '📊' }}
          </button>
          <button
            class="tool"
            :class="{ 'is-on': panelTab === 'sticky' && editorOpen }"
            type="button"
            title="看看便利贴"
            aria-label="便利贴"
            @click="openStickyPanel"
          >
            📌
          </button>
          <button
            class="tool"
            type="button"
            :title="`联网同步 ${year} 年节假日与调休`"
            :disabled="syncing"
            @click="syncHolidays"
          >
            {{ syncing ? '⏳' : '☁' }}
          </button>
          <button
            class="tool"
            type="button"
            title="修改工作时间"
            aria-label="修改工作时间"
            @click="openScheduleWizard"
          >
            ⚙️
          </button>
          <button class="tool" type="button" title="最小化" @click="api?.minimize()">–</button>
          <button class="tool tool--close" type="button" title="关闭" @click="api?.close()">✕</button>
        </div>
      </header>

      <div class="main">
        <div class="cal">
          <div class="month">
            <button class="month__nav" type="button" title="上个月" @click="go(-1)">◀</button>
            <h2 class="month__label">{{ monthLabel }}</h2>
            <button class="month__nav" type="button" title="下个月" @click="go(1)">▶</button>

            <button class="month__today" type="button" @click="goToday">今天</button>

            <span v-if="holidaysMeta.source" class="month__source" :title="`数据来源：${holidaysMeta.source}`">
              节假日已同步
            </span>
            <span v-else class="month__source month__source--off" title="点右上角的云朵按钮联网获取">
              未同步节假日
            </span>
          </div>

          <CalendarGrid
            :cells="cells"
            :holidays="holidays"
            :days="days"
            :today-key="todayKey"
            :selected-key="selectedKey"
            :grid-key="gridKey"
            :direction="direction"
            :schedule="schedule"
            @select="select"
          />

          <SummaryBar :summary="summary" :schedule-text="scheduleText" />
        </div>

        <DayEditor
          v-if="panelTab === 'day'"
          :open="editorOpen"
          :day-key="selectedKey"
          :kind="selectedKind"
          :holiday-name="selectedHolidayName"
          :record="selectedRecord"
          :schedule="schedule"
          @save="saveRecord"
          @clear="clearRecord"
          @close="editorOpen = false"
        />

        <StickyPanel
          v-else
          :open="editorOpen"
          @close="editorOpen = false"
          @toast="(message, isError) => flash(message, isError)"
        />
      </div>

      <SetupWizard
        :open="wizardOpen"
        :schedule="schedule"
        :first-run="firstRun"
        @save="saveSchedule"
        @skip="useDefaultSchedule"
        @cancel="wizardOpen = false"
      />

      <Transition name="toast">
        <div v-if="toast" class="toast" :class="{ 'is-error': toastError }">{{ toast }}</div>
      </Transition>

      <div
        class="grip"
        title="拖动改变大小"
        @pointerdown="onResizeStart"
        @pointermove="onResizeMove"
        @pointerup="onResizeEnd"
        @pointercancel="onResizeEnd"
      ></div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.app {
  position: relative;
  height: 100%;
  // 给图钉留出位置
  padding: 20px 15px 15px;
}

/* 换色时轻轻弹一下 */
.paper.is-swapping {
  animation: themePop 0.32s ease-out;
}

@keyframes themePop {
  0% {
    transform: scale(1);
  }
  45% {
    transform: scale(0.972);
  }
  100% {
    transform: scale(1);
  }
}

/* --------------------------------------------------------------- 标题栏 */

.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 13px 12px 4px 16px;
  -webkit-app-region: drag;
}

.bar__title {
  flex: 1 1 auto;
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.7);
}

.bar__tools {
  display: flex;
  gap: 3px;
  -webkit-app-region: no-drag;
}

.tool:disabled {
  opacity: 0.5;
  cursor: default;
  transform: none !important;
}

/* 面板开着时对应的按钮点亮 */
.tool.is-on {
  background: var(--accent-strong);
  color: #fff;
}

/* --------------------------------------------------------------- 主体 */

.main {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  padding: 0 10px 10px 14px;
}

.cal {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding-right: 10px;
}

/* ------------------------------------------------------------ 月份导航 */

.month {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 2px 10px;
}

.month__label {
  margin: 0;
  min-width: 118px;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-align: center;
}

.month__nav {
  width: 24px;
  height: 24px;
  padding: 0;
  font-size: 10px;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.6);
  border: 0;
  border-radius: 50%;
  transition: transform 0.15s ease, background 0.15s ease;

  &:hover {
    background: #fff;
    transform: scale(1.12);
  }

  &:active {
    transform: scale(0.9);
  }
}

.month__today {
  padding: 3px 11px;
  font-size: 12px;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.6);
  border: 1.5px solid transparent;
  border-radius: 99px;
  transition: background 0.16s ease, border-color 0.16s ease;

  &:hover {
    background: #fff;
    border-color: var(--accent);
  }
}

.month__source {
  margin-left: auto;
  font-size: 11px;
  color: var(--ink-soft);

  &--off {
    opacity: 0.65;
    text-decoration: underline dotted;
    text-underline-offset: 2px;
    cursor: help;
  }
}

/* --------------------------------------------------------------- 提示 */

.toast {
  position: absolute;
  left: 50%;
  bottom: 26px;
  z-index: 8;
  transform: translateX(-50%);
  padding: 7px 16px;
  font-size: 12.5px;
  color: #fff;
  background: var(--accent-strong);
  border-radius: 99px;
  box-shadow: 0 6px 16px rgba(96, 58, 78, 0.28);
  white-space: nowrap;

  &.is-error {
    background: var(--fail);
  }
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px) scale(0.94);
}
</style>
