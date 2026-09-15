<script setup>
import { ref, computed, watch } from 'vue';
import {
  LEAVE_TYPES,
  KIND_LABELS,
  DEFAULT_SCHEDULE,
  isRestDay,
  computeSegments,
  formatDuration,
  parseKey,
  toMinutes,
  toHHMM
} from '@/shared/worktime';

const props = defineProps({
  open: { type: Boolean, default: false },
  dayKey: { type: String, default: '' },
  kind: { type: String, default: 'workday' },
  holidayName: { type: String, default: '' },
  record: { type: Object, default: null },
  /** 用户作息；null 就用 worktime 里的默认作息 */
  schedule: { type: Object, default: null }
});

const emit = defineEmits(['save', 'clear', 'close']);

const draft = ref({ overtime: [], leave: null, note: '' });

const restDay = computed(() => isRestDay(props.kind));

/** 每段一个稳定 id：用数组下标当 key 的话，删中间一段会让后面几段的输入框内容错位 */
let segSeq = 0;
const nextSegId = () => `seg-${(segSeq += 1)}`;

/**
 * 新记录给个顺手的默认时段。
 * 关键是「往下错开」：以前每次都给同一个 18:00-20:00，
 * 点「添加时段」后新的一条和上一条长得一模一样，
 * 看起来像没加上，而且两条重叠会被重复算成两倍工时。
 */
function defaultSegment() {
  const fallback = restDay.value ? { start: '09:00', end: '18:00' } : { start: '18:00', end: '20:00' };
  const list = draft.value.overtime;
  if (!list.length) return { id: nextSegId(), ...fallback };

  const last = list[list.length - 1];
  const lastEnd = toMinutes(last?.end);
  if (lastEnd == null) return { id: nextSegId(), ...fallback };

  // 从上一段的结束时间接着往后排一小时，最多排到 23:00
  const start = Math.min(lastEnd, 23 * 60);
  const end = Math.min(start + 60, 24 * 60);
  if (end - start < 15) return { id: nextSegId(), ...fallback };

  return { id: nextSegId(), start: toHHMM(start), end: toHHMM(end) };
}

watch(
  () => [props.open, props.dayKey],
  () => {
    if (!props.open) return;
    const record = props.record;
    draft.value = {
      overtime: (record?.overtime || []).map((s) => ({ id: nextSegId(), ...s })),
      leave: record?.leave ? { ...record.leave } : null,
      note: record?.note || ''
    };
    if (!draft.value.overtime.length) draft.value.overtime.push(defaultSegment());
  },
  { immediate: true }
);

const title = computed(() => {
  if (!props.dayKey) return '';
  const d = parseKey(props.dayKey);
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${weekday}`;
});

const kindLabel = computed(() => {
  if (props.holidayName) return `${KIND_LABELS[props.kind] || ''} · ${props.holidayName}`;
  return KIND_LABELS[props.kind] || '';
});

/** 按当前作息裁过之后的每段时长 */
const computedSegs = computed(() => computeSegments(draft.value.overtime, props.kind, props.schedule));
const totalMinutes = computed(() => computedSegs.value.reduce((sum, s) => sum + s.minutes, 0));

/** 说明文字要跟着用户改的作息走，不能写死 08:00-12:00 */
const scheduleHint = computed(() => {
  if (restDay.value) return '休息日 / 法定假日全天都算加班';
  const segments = props.schedule?.segments || DEFAULT_SCHEDULE.segments;
  const spans = segments.map((s) => `${s.start}-${s.end}`).join('、');
  return `已自动扣掉 ${spans} 的正常上班时段`;
});

function segLength(index) {
  const seg = computedSegs.value[index];
  if (!seg) return '';
  if (seg.minutes <= 0) return restDay.value ? '' : '不算加班';
  return formatDuration(seg.minutes);
}

function addSeg() {
  if (draft.value.overtime.length >= 6) return;
  draft.value.overtime.push(defaultSegment());
}

function removeSeg(index) {
  draft.value.overtime.splice(index, 1);
}

function toggleLeave(event) {
  draft.value.leave = event.target.checked ? { type: 'personal', hours: 8 } : null;
}

function save() {
  const clean = {
    // id 只是界面用来做 key 的，不往存储里写
    overtime: draft.value.overtime
      .filter((s) => s.start && s.end)
      .map((s) => ({ start: s.start, end: s.end })),
    leave: draft.value.leave,
    note: draft.value.note.trim()
  };
  const hasAnything =
    clean.overtime.length || (Number(clean.leave?.hours) > 0) || clean.note;
  if (!hasAnything) emit('clear');
  else emit('save', clean);
}
</script>

<template>
  <aside class="editor" :class="{ 'is-open': open }" :aria-hidden="String(!open)">
    <div class="editor__inner">
      <header class="editor__head">
        <div class="editor__titles">
          <h2 class="editor__date">{{ title }}</h2>
          <span class="editor__kind" :class="`is-${kind}`">{{ kindLabel }}</span>
        </div>
        <button class="tool" type="button" title="收起" aria-label="收起" @click="emit('close')">✕</button>
      </header>

      <div class="editor__body">
        <section class="field">
          <label class="field__label">加班时段</label>

          <ul class="segs">
            <li v-for="(seg, i) in draft.overtime" :key="seg.id" class="seg">
              <input v-model="seg.start" class="seg__time" type="time" step="300" />
              <span class="seg__dash">–</span>
              <input v-model="seg.end" class="seg__time" type="time" step="300" />
              <span class="seg__len" :class="{ 'is-zero': computedSegs[i]?.minutes <= 0 }">{{ segLength(i) }}</span>
              <button class="seg__del" type="button" title="删掉这段" @click="removeSeg(i)">✕</button>
            </li>
          </ul>

          <button v-if="draft.overtime.length < 6" class="ghost" type="button" @click="addSeg">＋ 添加时段</button>

          <p class="field__total">
            加班合计 <b>{{ formatDuration(totalMinutes) }}</b>
          </p>
          <p class="field__note">{{ scheduleHint }}</p>
        </section>

        <section class="field">
          <label class="field__label field__label--check">
            <input type="checkbox" :checked="!!draft.leave" @change="toggleLeave" />
            <span>请假</span>
          </label>

          <div v-if="draft.leave" class="leave">
            <select v-model="draft.leave.type" class="leave__type">
              <option v-for="t in LEAVE_TYPES" :key="t.key" :value="t.key">{{ t.label }}</option>
            </select>
            <input
              v-model.number="draft.leave.hours"
              class="leave__hours"
              type="number"
              min="0.5"
              max="24"
              step="0.5"
            />
            <span class="leave__unit">小时</span>
          </div>

          <p v-else class="field__hint">勾上可以记录事假 / 病假 / 年假等</p>
        </section>

        <section class="field">
          <label class="field__label">备注</label>
          <textarea
            v-model="draft.note"
            class="note"
            rows="2"
            maxlength="200"
            placeholder="比如：项目上线、补昨天的活…"
          ></textarea>
        </section>
      </div>

      <footer class="editor__foot">
        <button class="btn btn--ghost" type="button" @click="emit('clear')">清空这天</button>
        <button class="btn btn--primary" type="button" @click="save">保存</button>
      </footer>
    </div>
  </aside>
</template>

<style lang="scss" scoped>
.editor {
  flex: 0 0 auto;
  width: 0;
  overflow: hidden;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);

  &.is-open {
    width: 340px;
  }
}

.editor__inner {
  width: 340px;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-left: 1.5px dashed var(--rule-strong);
}

.editor__head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 12px 10px 14px;
}

.editor__titles {
  flex: 1 1 auto;
  min-width: 0;
}

.editor__date {
  margin: 0;
  font-size: 16.5px;
  font-weight: 700;
  letter-spacing: 0.4px;
}

.editor__kind {
  display: inline-block;
  margin-top: 3px;
  padding: 1px 8px;
  font-size: 11px;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.7);

  &.is-holiday {
    color: #fff;
    background: var(--accent-strong);
  }

  &.is-swap {
    color: #fff;
    background: var(--info);
  }
}

.editor__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0 14px 10px;
  scrollbar-width: thin;
  scrollbar-color: var(--accent) transparent;
}

/* ---------------------------------------------------------------- 字段 */

.field {
  margin-bottom: 16px;
}

.field__label {
  display: block;
  margin-bottom: 7px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink-soft);

  &--check {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;

    input {
      accent-color: var(--accent-strong);
      cursor: pointer;
    }
  }
}

.field__total {
  margin: 9px 0 0;
  font-size: 12.5px;
  color: var(--ink-soft);

  b {
    font-size: 15px;
    color: var(--accent-strong);
  }
}

.field__note {
  display: block;
  margin: 4px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--ink-faint);
}

.field__hint {
  margin: 0;
  font-size: 11.5px;
  color: var(--ink-faint);
}

/* ------------------------------------------------------------ 加班时段 */

.segs {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 0 7px;
  padding: 0;
  list-style: none;
}

.seg {
  display: flex;
  align-items: center;
  gap: 5px;
  animation: segIn 0.22s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.seg__time {
  // 宽度要放得下 "18:00" 加右侧的表盘图标，窄了会被截成 "18:0("
  width: 92px;
  padding: 3px 5px;
  font-size: 12.5px;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.88);
  border: 1.5px solid var(--rule-strong);
  border-radius: 8px;
  outline: 0;

  &:focus {
    border-color: var(--accent);
  }

  &::-webkit-calendar-picker-indicator {
    cursor: pointer;
    opacity: 0.45;
  }
}

.seg__dash {
  color: var(--ink-soft);
}

.seg__len {
  flex: 1 1 auto;
  font-size: 11.5px;
  color: var(--accent-strong);
  white-space: nowrap;

  &.is-zero {
    color: var(--ink-faint);
  }
}

.seg__del {
  width: 19px;
  height: 19px;
  padding: 0;
  font-size: 10px;
  line-height: 1;
  color: var(--ink-soft);
  background: transparent;
  border: 0;
  border-radius: 50%;
  transition: background 0.15s ease, color 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.9);
    color: var(--accent-strong);
  }
}

/* -------------------------------------------------------------- 请假 */

.leave {
  display: flex;
  align-items: center;
  gap: 6px;
}

.leave__type {
  flex: 1 1 auto;
  min-width: 0;
  padding: 4px 6px;
  font-size: 12.5px;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.88);
  border: 1.5px solid var(--rule-strong);
  border-radius: 8px;
  outline: 0;

  &:focus {
    border-color: var(--accent);
  }
}

.leave__hours {
  width: 62px;
  padding: 4px 6px;
  font-size: 12.5px;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.88);
  border: 1.5px solid var(--rule-strong);
  border-radius: 8px;
  outline: 0;

  &:focus {
    border-color: var(--accent);
  }
}

.leave__unit {
  font-size: 12px;
  color: var(--ink-soft);
}

/* -------------------------------------------------------------- 备注 */

.note {
  width: 100%;
  padding: 7px 9px;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.88);
  border: 1.5px solid var(--rule-strong);
  border-radius: 10px;
  outline: 0;
  resize: none;
  user-select: text;

  &:focus {
    border-color: var(--accent);
  }
}

/* -------------------------------------------------------------- 按钮 */

.ghost {
  padding: 4px 11px;
  font-size: 12px;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.6);
  border: 1.5px dashed var(--rule-strong);
  border-radius: 99px;
  transition: background 0.16s ease, border-color 0.16s ease, transform 0.16s ease;

  &:hover {
    background: #fff;
    border-style: solid;
    border-color: var(--accent);
    transform: translateY(-1px);
  }
}

.editor__foot {
  display: flex;
  gap: 8px;
  padding: 10px 14px 14px;
  border-top: 1.5px dashed var(--rule-strong);
}

.btn {
  flex: 1 1 auto;
  padding: 8px 0;
  font-size: 13.5px;
  font-weight: 700;
  border: 0;
  border-radius: 12px;
  transition: transform 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;

  &:active {
    transform: scale(0.96);
  }

  &--primary {
    color: #fff;
    background: var(--accent-strong);
    box-shadow: 0 4px 10px rgba(242, 100, 143, 0.3);

    &:hover {
      background: #e8557f;
    }
  }

  &--ghost {
    flex: 0 0 auto;
    padding: 8px 14px;
    color: var(--ink-soft);
    background: rgba(255, 255, 255, 0.6);

    &:hover {
      background: #fff;
      color: var(--fail);
    }
  }
}

@keyframes segIn {
  from {
    opacity: 0;
    transform: translateX(-6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
</style>
