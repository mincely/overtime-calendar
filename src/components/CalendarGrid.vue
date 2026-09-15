<script setup>
import { computed } from 'vue';
import DayCell from './DayCell.vue';
import {
  WEEKDAY_LABELS,
  dayKind,
  overtimeMinutes,
  leaveMinutes,
  leaveLabel
} from '@/shared/worktime';

const props = defineProps({
  cells: { type: Array, required: true },
  holidays: { type: Object, default: () => ({}) },
  days: { type: Object, default: () => ({}) },
  todayKey: { type: String, default: '' },
  selectedKey: { type: String, default: '' },
  gridKey: { type: String, default: '' },
  direction: { type: String, default: 'next' },
  /** 用户作息；null 就用 worktime 里的默认作息 */
  schedule: { type: Object, default: null }
});

const emit = defineEmits(['select']);

/** 每格的显示数据都在这里算好，DayCell 只负责画 */
const rows = computed(() =>
  props.cells.map((cell, index) => {
    const schedule = props.schedule;
    const kind = dayKind(cell.date, props.holidays, schedule);
    const record = props.days[cell.key];
    return {
      index,
      cell,
      kind,
      holidayName: props.holidays[cell.key]?.name || '',
      overtime: overtimeMinutes(record, kind, schedule),
      leave: leaveMinutes(record),
      leaveLabel: leaveLabel(record)
    };
  })
);
</script>

<template>
  <div class="grid-wrap">
    <div class="grid-head">
      <span
        v-for="(label, i) in WEEKDAY_LABELS"
        :key="label"
        class="grid-head__cell"
        :class="{ 'is-rest': i === 6 }"
      >
        {{ label }}
      </span>
    </div>

    <div class="grid-body">
      <!-- 翻月时整块网格滑动切换 -->
      <Transition :name="`slide-${direction}`">
        <div :key="gridKey" class="grid">
          <DayCell
            v-for="row in rows"
            :key="row.cell.key"
            :cell="row.cell"
            :kind="row.kind"
            :holiday-name="row.holidayName"
            :overtime="row.overtime"
            :leave="row.leave"
            :leave-label="row.leaveLabel"
            :is-today="row.cell.key === todayKey"
            :selected="row.cell.key === selectedKey"
            :index="row.index"
            @select="emit('select', $event)"
          />
        </div>
      </Transition>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.grid-wrap {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.grid-head {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 7px;
  padding: 0 2px 7px;
}

.grid-head__cell {
  text-align: center;
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-soft);

  &.is-rest {
    color: var(--accent-strong);
  }
}

.grid-body {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}

.grid {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  grid-auto-rows: 1fr;
  gap: 7px;
}

/* --------------------------------------------------------- 翻月动效 */

.slide-next-enter-active,
.slide-next-leave-active,
.slide-prev-enter-active,
.slide-prev-leave-active {
  transition: transform 0.26s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.26s ease;
}

.slide-next-enter-from {
  opacity: 0;
  transform: translateX(38px) scale(0.98);
}

.slide-next-leave-to {
  opacity: 0;
  transform: translateX(-38px) scale(0.98);
}

.slide-prev-enter-from {
  opacity: 0;
  transform: translateX(-38px) scale(0.98);
}

.slide-prev-leave-to {
  opacity: 0;
  transform: translateX(38px) scale(0.98);
}
</style>
