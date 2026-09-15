<script setup>
import { ref, computed, watch } from 'vue';
import {
  WEEKDAY_ORDER,
  WEEKDAY_NAMES,
  DEFAULT_SCHEDULE,
  normalizeSchedule,
  scheduleDailyMinutes,
  describeWorkdays,
  formatDuration,
  toMinutes
} from '@/shared/worktime';

const props = defineProps({
  open: { type: Boolean, default: false },
  schedule: { type: Object, default: null },
  /** true = 首次使用（没有取消按钮，文案也不同） */
  firstRun: { type: Boolean, default: false }
});

const emit = defineEmits(['save', 'cancel']);

const workdays = ref([...DEFAULT_SCHEDULE.workdays]);
const morningOn = ref(true);
const afternoonOn = ref(true);
const morning = ref({ start: '08:00', end: '12:00' });
const afternoon = ref({ start: '14:00', end: '18:00' });
const error = ref('');

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    const base = normalizeSchedule(props.schedule || DEFAULT_SCHEDULE);
    workdays.value = [...base.workdays];
    morning.value = { ...(base.segments[0] || { start: '08:00', end: '12:00' }) };
    afternoon.value = { ...(base.segments[1] || { start: '14:00', end: '18:00' }) };
    morningOn.value = base.segments.length > 0;
    afternoonOn.value = base.segments.length > 1;
    error.value = '';
  },
  { immediate: true }
);

function toggleDay(value) {
  const set = new Set(workdays.value);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  workdays.value = [...set];
}

const segments = computed(() => {
  const list = [];
  if (morningOn.value) list.push({ ...morning.value });
  if (afternoonOn.value) list.push({ ...afternoon.value });
  return list;
});

const dailyMinutes = computed(() => scheduleDailyMinutes({ segments: segments.value }));

/** 给用户一句人话确认，减少填错的概率 */
const preview = computed(() => {
  if (!workdays.value.length) return '还没选上班的日子';
  if (!segments.value.length) return '上午和下午至少要留一段';
  // 连续的一段会收成「周一到周六」，比逐个列出来好读
  const days = describeWorkdays({ workdays: workdays.value });
  const spans = segments.value.map((s) => `${s.start}-${s.end}`).join('、');
  return `${days} ${spans}`;
});

function save() {
  if (!workdays.value.length) {
    error.value = '至少要选一天上班';
    return;
  }
  if (!segments.value.length) {
    error.value = '上午和下午至少要留一段';
    return;
  }
  for (const seg of segments.value) {
    const start = toMinutes(seg.start);
    const end = toMinutes(seg.end);
    if (start == null || end == null) {
      error.value = '时间填得不对，格式应该是 09:00 这样';
      return;
    }
    if (end <= start) {
      error.value = '下班时间要晚于上班时间';
      return;
    }
  }

  error.value = '';
  // 展开成纯数组 / 纯对象再交出去：workdays.value 是 Vue 的 Proxy，
  // 直接传会被 IPC 的结构化克隆拒绝
  emit('save', {
    workdays: [...workdays.value],
    segments: segments.value.map((seg) => ({ start: seg.start, end: seg.end }))
  });
}
</script>

<template>
  <Transition name="wizard">
    <div v-if="open" class="wizard">
      <div class="wizard__card">
        <span class="pin" style="top: -13px"><i></i></span>

        <header class="wizard__head">
          <h2 class="wizard__title">先告诉我你的上班时间</h2>
          <p class="wizard__sub">
            <template v-if="firstRun">之后所有加班都按这套作息算，随时可以改。</template>
            <template v-else>改完立刻生效，已经记好的加班会按新作息重新折算。</template>
          </p>
        </header>

        <section class="field">
          <label class="field__label">每周哪几天上班？</label>
          <div class="days">
            <button
              v-for="d in WEEKDAY_ORDER"
              :key="d"
              class="day"
              :class="{ 'is-on': workdays.includes(d) }"
              type="button"
              :aria-pressed="String(workdays.includes(d))"
              @click="toggleDay(d)"
            >
              {{ WEEKDAY_NAMES[d].slice(1) }}
            </button>
          </div>
        </section>

        <section class="field">
          <label class="field__label">上下班时间</label>

          <div class="seg" :class="{ 'is-off': !morningOn }">
            <input v-model="morningOn" class="seg__toggle" type="checkbox" aria-label="启用上午" />
            <span class="seg__name">上午</span>
            <input v-model="morning.start" class="seg__time" type="time" :disabled="!morningOn" />
            <span class="seg__dash">–</span>
            <input v-model="morning.end" class="seg__time" type="time" :disabled="!morningOn" />
          </div>

          <div class="seg" :class="{ 'is-off': !afternoonOn }">
            <input v-model="afternoonOn" class="seg__toggle" type="checkbox" aria-label="启用下午" />
            <span class="seg__name">下午</span>
            <input v-model="afternoon.start" class="seg__time" type="time" :disabled="!afternoonOn" />
            <span class="seg__dash">–</span>
            <input v-model="afternoon.end" class="seg__time" type="time" :disabled="!afternoonOn" />
          </div>

          <p class="daily">
            每天正常上班 <b>{{ formatDuration(dailyMinutes) }}</b>
          </p>
          <p class="daily daily--hint">
            这段时间<b>以外</b>的算加班；休息日和法定假日全天算加班。
          </p>
        </section>

        <p class="preview">{{ preview }}</p>
        <p v-if="error" class="error">{{ error }}</p>

        <footer class="wizard__foot">
          <!-- 首次使用也给一条退路：不想现在填就用默认作息先进去，
               免得又变成一个出不去的弹窗 -->
          <button class="btn btn--ghost" type="button" @click="emit(firstRun ? 'skip' : 'cancel')">
            {{ firstRun ? '用默认作息' : '取消' }}
          </button>
          <button class="btn btn--primary" type="button" @click="save">
            {{ firstRun ? '开始使用' : '保存作息' }}
          </button>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<style lang="scss" scoped>
.wizard {
  position: absolute;
  inset: 0;
  // 关键：往下让开标题栏的高度。
  // 盖住标题栏的话，用户连右上角的 ✕ 都点不到，会被卡死在向导里出不去。
  top: 54px;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(96, 58, 78, 0.3);
  backdrop-filter: blur(3px);
}

.wizard__card {
  position: relative;
  width: 384px;
  max-width: 100%;
  padding: 26px 22px 18px;
  border-radius: var(--radius);
  background: linear-gradient(158deg, var(--paper-1) 0%, var(--paper-2) 100%);
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow: 0 20px 44px rgba(96, 58, 78, 0.32);
  animation: cardIn 0.34s cubic-bezier(0.34, 1.4, 0.64, 1) both;
}

.wizard__head {
  margin-bottom: 16px;
}

.wizard__title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.wizard__sub {
  margin: 5px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink-soft);
}

/* --------------------------------------------------------------- 字段 */

.field {
  margin-bottom: 16px;
}

.field__label {
  display: block;
  margin-bottom: 8px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink-soft);
}

/* ----------------------------------------------------------- 星期选择 */

.days {
  display: flex;
  gap: 6px;
}

.day {
  flex: 1 1 0;
  height: 38px;
  padding: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--ink-soft);
  background: rgba(255, 255, 255, 0.62);
  border: 1.5px solid transparent;
  border-radius: 11px;
  transition: transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.16s ease,
    color 0.16s ease, box-shadow 0.16s ease;

  &:hover {
    transform: translateY(-2px);
    background: #fff;
  }

  &:active {
    transform: scale(0.94);
  }

  &.is-on {
    color: #fff;
    background: var(--accent-strong);
    box-shadow: 0 4px 10px rgba(242, 100, 143, 0.3);
  }

  &:focus-visible {
    outline: 2px solid var(--accent-strong);
    outline-offset: 2px;
  }
}

/* ----------------------------------------------------------- 时间段 */

.seg {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 8px;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.58);
  transition: opacity 0.18s ease;

  &.is-off {
    opacity: 0.45;
  }
}

.seg__toggle {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  accent-color: var(--accent-strong);
  cursor: pointer;
}

.seg__name {
  flex: 0 0 auto;
  width: 30px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink-soft);
}

.seg__time {
  width: 92px;
  padding: 3px 5px;
  font-size: 12.5px;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.9);
  border: 1.5px solid var(--rule-strong);
  border-radius: 8px;
  outline: 0;

  &:focus {
    border-color: var(--accent);
  }

  &:disabled {
    cursor: default;
  }

  &::-webkit-calendar-picker-indicator {
    cursor: pointer;
    opacity: 0.45;
  }
}

.seg__dash {
  color: var(--ink-soft);
}

/* --------------------------------------------------------------- 汇总 */

.daily {
  margin: 9px 0 0;
  font-size: 12.5px;
  color: var(--ink-soft);

  b {
    font-size: 15px;
    color: var(--accent-strong);
  }

  &--hint {
    margin-top: 3px;
    font-size: 11px;
    line-height: 1.55;
    color: var(--ink-faint);

    b {
      font-size: inherit;
      color: var(--ink-soft);
    }
  }
}

.preview {
  margin: 0 0 10px;
  padding: 7px 10px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--ink-soft);
  background: rgba(255, 255, 255, 0.5);
  border-left: 3px solid var(--accent);
  border-radius: 6px;
  word-break: break-all;
}

.error {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--fail);
}

/* --------------------------------------------------------------- 按钮 */

.wizard__foot {
  display: flex;
  gap: 8px;
}

.btn {
  flex: 1 1 auto;
  padding: 10px 0;
  font-size: 14px;
  font-weight: 700;
  border: 0;
  border-radius: 12px;
  transition: transform 0.16s ease, filter 0.16s ease, background 0.16s ease;

  &:active {
    transform: scale(0.97);
  }

  &--primary {
    color: #fff;
    background: var(--accent-strong);
    box-shadow: 0 5px 12px rgba(242, 100, 143, 0.32);

    &:hover {
      filter: brightness(1.06);
    }
  }

  &--ghost {
    flex: 0 0 auto;
    padding: 10px 18px;
    color: var(--ink-soft);
    background: rgba(255, 255, 255, 0.6);

    &:hover {
      background: #fff;
      color: var(--ink);
    }
  }
}

/* --------------------------------------------------------------- 动效 */

.wizard-enter-active,
.wizard-leave-active {
  transition: opacity 0.24s ease;
}

.wizard-enter-from,
.wizard-leave-to {
  opacity: 0;
}

@keyframes cardIn {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
</style>
