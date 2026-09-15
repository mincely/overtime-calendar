<script setup>
import { formatHours } from '@/shared/worktime';

defineProps({
  summary: { type: Object, required: true },
  /** 当前作息的一句话描述，比如「周一到周六 · 08:00-12:00、14:00-18:00」 */
  scheduleText: { type: String, default: '' }
});
</script>

<template>
  <footer class="summary">
    <span class="summary__item">
      本月加班 <b>{{ formatHours(summary.overtime) }}</b> 小时
    </span>
    <span class="summary__sep">·</span>
    <span class="summary__item">
      请假 <b>{{ formatHours(summary.leave) }}</b> 小时
    </span>
    <span class="summary__sep">·</span>
    <span class="summary__item summary__item--muted">工作日 {{ summary.workdays }} 天</span>
    <span v-if="summary.restDaysWorked" class="summary__item summary__item--muted">
      含 {{ summary.restDaysWorked }} 天休息日出勤
    </span>
    <span v-if="scheduleText" class="summary__item summary__item--muted summary__item--schedule" :title="scheduleText">
      {{ scheduleText }}
    </span>
  </footer>
</template>

<style lang="scss" scoped>
.summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 4px 2px;
  font-size: 12.5px;
  color: var(--ink-soft);
}

.summary__item {
  b {
    font-size: 15.5px;
    color: var(--accent-strong);
  }

  &--muted {
    font-size: 11.5px;
    opacity: 0.8;
  }

  /* 当前作息靠右摆，随时能确认按什么规则在算 */
  &--schedule {
    margin-left: auto;
    opacity: 0.65;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.summary__sep {
  opacity: 0.4;
}
</style>
