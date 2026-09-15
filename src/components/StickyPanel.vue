<script setup>
import { ref, computed, onMounted } from 'vue';

const api = window.calendar;

defineProps({
  open: { type: Boolean, default: false }
});

const emit = defineEmits(['close', 'toast']);

const state = ref({ loading: true, ok: false, source: '', todos: [], error: '' });
const info = ref({ exePath: null, exists: false });
const launching = ref(false);

const doneCount = computed(() => (state.value.todos || []).filter((t) => t.done).length);
const pending = computed(() => (state.value.todos || []).filter((t) => !t.done));
const finished = computed(() => (state.value.todos || []).filter((t) => t.done));

async function refresh() {
  state.value = { ...state.value, loading: true };
  try {
    const res = await api.stickyRead();
    state.value = { loading: false, ...res, todos: res.todos || [] };
  } catch (error) {
    state.value = { loading: false, ok: false, error: error.message, todos: [] };
  }
  info.value = await api.stickyInfo();
}

async function launch() {
  launching.value = true;
  try {
    const res = await api.stickyLaunch();
    if (!res.ok) emit('toast', res.error || '打不开便利贴', true);
  } finally {
    launching.value = false;
  }
}

async function locate() {
  const res = await api.stickyLocate();
  if (res?.ok) {
    info.value = await api.stickyInfo();
    emit('toast', '已经记住便利贴的位置');
  }
}

onMounted(refresh);
</script>

<template>
  <aside class="editor" :class="{ 'is-open': open }" :aria-hidden="String(!open)">
    <div class="editor__inner">
      <header class="editor__head">
        <div class="editor__titles">
          <h2 class="editor__date">便利贴</h2>
          <span class="editor__source">
            {{ state.loading ? '读取中…' : state.ok ? `来自「${state.source}」` : '未连接' }}
          </span>
        </div>
        <button class="tool" type="button" title="收起" aria-label="收起" @click="emit('close')">✕</button>
      </header>

      <div class="editor__body">
        <p v-if="state.loading" class="empty">正在读取…</p>

        <template v-else-if="state.ok">
          <p v-if="!state.todos.length" class="empty">便利贴里还没有事情</p>

          <template v-else>
            <ul class="todos">
              <li v-for="(t, i) in pending" :key="`p${i}`" class="todo">
                <span class="todo__box"></span>
                <span class="todo__text">{{ t.text }}</span>
              </li>
            </ul>

            <template v-if="finished.length">
              <p class="group">已完成 {{ finished.length }} 条</p>
              <ul class="todos">
                <li v-for="(t, i) in finished" :key="`d${i}`" class="todo is-done">
                  <span class="todo__box"></span>
                  <span class="todo__text">{{ t.text }}</span>
                </li>
              </ul>
            </template>

            <p class="summary">
              共 {{ state.todos.length }} 条 · 待办 {{ pending.length }} · 已完成 {{ doneCount }}
            </p>
          </template>
        </template>

        <div v-else class="empty">
          <p>{{ state.error || '没有找到便利贴的数据' }}</p>
          <p class="hint">便利贴把自己的待办存在它自己的目录里，先运行一次便利贴就会有了。</p>
        </div>
      </div>

      <footer class="editor__foot editor__foot--three">
        <button class="btn btn--ghost" type="button" :title="info.exePath || '还没指定程序位置'" @click="locate">
          {{ info.exists ? '换程序' : '指定程序' }}
        </button>
        <button class="btn btn--ghost" type="button" @click="refresh">刷新</button>
        <button class="btn btn--primary" type="button" :disabled="!info.exists || launching" @click="launch">
          打开便利贴
        </button>
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

.editor__source {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  color: var(--ink-soft);
}

.editor__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0 14px 10px;
  scrollbar-width: thin;
  scrollbar-color: var(--accent) transparent;
}

/* ------------------------------------------------------------ 待办列表 */

.todos {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.todo {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 9px;
  border-radius: var(--radius-xs);
  background: rgba(255, 255, 255, 0.66);
  animation: rowIn 0.24s cubic-bezier(0.34, 1.4, 0.64, 1) both;

  &.is-done {
    opacity: 0.6;

    .todo__text {
      text-decoration: line-through;
      text-decoration-color: var(--accent-strong);
      text-decoration-thickness: 2px;
    }

    .todo__box {
      background: var(--accent);
      border-color: var(--accent-strong);

      &::after {
        opacity: 1;
        transform: rotate(42deg) scale(1);
      }
    }
  }
}

.todo__box {
  position: relative;
  flex: 0 0 auto;
  width: 15px;
  height: 15px;
  margin-top: 2px;
  border: 2px solid var(--accent);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.6);

  &::after {
    content: '';
    position: absolute;
    left: 3px;
    top: -1px;
    width: 5px;
    height: 8px;
    border: solid #fff;
    border-width: 0 2px 2px 0;
    border-radius: 1px;
    opacity: 0;
    transform: rotate(42deg) scale(0.2);
    transition: transform 0.18s ease, opacity 0.14s ease;
  }
}

.todo__text {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  line-height: 1.45;
  overflow-wrap: anywhere;
  user-select: text;
}

.group {
  margin: 14px 0 6px;
  font-size: 11.5px;
  color: var(--ink-soft);
}

.summary {
  margin: 12px 0 0;
  font-size: 11.5px;
  color: var(--ink-faint);
}

.empty {
  margin: 6px 0 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--ink-soft);
}

.hint {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--ink-faint);
}

/* ---------------------------------------------------------------- 按钮 */

.editor__foot {
  display: flex;
  gap: 8px;
  padding: 10px 14px 14px;
  border-top: 1.5px dashed var(--rule-strong);

  &--three {
    .btn--primary {
      flex: 1 1 auto;
    }
  }
}

.btn {
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 700;
  border: 0;
  border-radius: 12px;
  transition: transform 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;

  &:active {
    transform: scale(0.96);
  }

  &:disabled {
    opacity: 0.45;
    cursor: default;

    &:active {
      transform: none;
    }
  }

  &--primary {
    color: #fff;
    background: var(--accent-strong);
    box-shadow: 0 4px 10px rgba(242, 100, 143, 0.3);

    &:hover:not(:disabled) {
      filter: brightness(1.06);
    }
  }

  &--ghost {
    flex: 0 0 auto;
    color: var(--ink-soft);
    background: rgba(255, 255, 255, 0.6);

    &:hover {
      background: #fff;
      color: var(--ink);
    }
  }
}

@keyframes rowIn {
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
