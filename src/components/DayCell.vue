<script setup>
import { computed } from 'vue';
import { formatHours, formatDuration } from '@/shared/worktime';

const props = defineProps({
  cell: { type: Object, required: true },
  kind: { type: String, default: 'workday' },
  holidayName: { type: String, default: '' },
  overtime: { type: Number, default: 0 },
  leave: { type: Number, default: 0 },
  leaveLabel: { type: String, default: '' },
  isToday: { type: Boolean, default: false },
  selected: { type: Boolean, default: false },
  index: { type: Number, default: 0 }
});

const emit = defineEmits(['select']);

const dayNumber = computed(() => props.cell.date.getDate());
const hasOvertime = computed(() => props.overtime > 0);
const hasLeave = computed(() => props.leave > 0);

const tooltip = computed(() => {
  const parts = [];
  if (props.holidayName) parts.push(props.holidayName);
  if (hasOvertime.value) parts.push(`加班 ${formatDuration(props.overtime)}`);
  if (hasLeave.value) parts.push(`${props.leaveLabel || '请假'} ${formatDuration(props.leave)}`);
  return parts.join(' · ');
});
</script>

<template>
  <button
    class="day"
    :class="[
      `is-${kind}`,
      {
        'is-other': !cell.inMonth,
        'is-today': isToday,
        'is-selected': selected,
        'has-overtime': hasOvertime,
        'has-leave': hasLeave
      }
    ]"
    type="button"
    :title="tooltip"
    :style="{ '--i': index }"
    @click="emit('select', cell)"
  >
    <span class="day__top">
      <span class="day__num">{{ dayNumber }}</span>
      <span v-if="holidayName" class="day__holiday">{{ holidayName }}</span>
    </span>

    <span class="day__marks">
      <span v-if="hasOvertime" class="mark mark--ot">+{{ formatHours(overtime) }}h</span>
      <span v-if="hasLeave" class="mark mark--leave">{{ leaveLabel || '请假' }}</span>
    </span>

    <span v-if="isToday" class="day__pulse" aria-hidden="true"></span>
  </button>
</template>

<style lang="scss" scoped>
.day {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 4px;
  padding: 7px 8px 8px;
  min-height: 0;
  text-align: left;
  color: var(--ink);
  background: var(--cell-work);
  border: 1.5px solid transparent;
  border-radius: var(--radius-sm);
  overflow: hidden;
  cursor: pointer;
  // 入场时按顺序错开，像多米诺一样铺开
  animation: cellIn 0.32s cubic-bezier(0.34, 1.4, 0.64, 1) both;
  animation-delay: calc(var(--i, 0) * 8ms);
  transition:
    transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1),
    box-shadow 0.16s ease,
    border-color 0.16s ease,
    opacity 0.16s ease;

  &:hover {
    transform: translateY(-2px) scale(1.035);
    z-index: 2;
    box-shadow: 0 8px 18px rgba(96, 58, 78, 0.18);
    border-color: var(--accent);
  }

  &:active {
    transform: scale(0.96);
  }

  &:focus-visible {
    outline: 2px solid var(--accent-strong);
    outline-offset: 1px;
  }

  /* 上/下个月补位的格子 */
  &.is-other {
    opacity: 0.4;
  }

  &.is-weekend {
    background: var(--cell-weekend);
  }

  &.is-holiday {
    background: var(--cell-holiday);
  }

  &.is-swap {
    background: var(--cell-swap);
  }

  &.is-selected {
    border-color: var(--accent-strong);
    box-shadow: 0 0 0 3px rgba(242, 100, 143, 0.18);
  }

  &.has-overtime {
    // 有加班的那天，左下角挑一道色
    &::after {
      content: '';
      position: absolute;
      left: 0;
      bottom: 0;
      width: 100%;
      height: 3px;
      background: linear-gradient(90deg, var(--accent-strong), var(--accent));
    }
  }
}

.day__top {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
}

.day__num {
  font-size: 15px;
  font-weight: 700;
  // 手写体的字面比常规字体高，行高给紧了会被 overflow:hidden 切掉底部
  line-height: 1.3;
}

.day__holiday {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 10.5px;
  color: var(--accent-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.day__marks {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.mark {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  font-size: 10.5px;
  font-weight: 700;
  line-height: 1.5;
  border-radius: 99px;
  white-space: nowrap;
  animation: markIn 0.24s cubic-bezier(0.34, 1.56, 0.64, 1) both;

  &--ot {
    color: #fff;
    background: var(--accent-strong);
  }

  &--leave {
    color: var(--ink);
    background: rgba(255, 255, 255, 0.85);
    border: 1px solid var(--rule-strong);
  }
}

/* 今天：一圈慢慢扩散的光环 */
.day__pulse {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  border: 2px solid var(--accent-strong);
  pointer-events: none;
  animation: pulse 2.4s ease-out infinite;
}

.day.is-today {
  background: #fff;
  border-color: var(--accent-strong);
}

.day.is-today .day__num {
  color: var(--accent-strong);
}

@keyframes cellIn {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.94);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes markIn {
  from {
    opacity: 0;
    transform: scale(0.7);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes pulse {
  0% {
    opacity: 0.7;
    transform: scale(1);
  }
  70% {
    opacity: 0;
    transform: scale(1.14);
  }
  100% {
    opacity: 0;
    transform: scale(1.14);
  }
}
</style>
