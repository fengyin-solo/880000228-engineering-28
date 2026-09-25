<script setup>
import { computed, ref } from 'vue'

import { NOTE_MAX_LENGTH } from '../../data/restorationNotes.js'
import { useRepairNotes } from '../../composables/useRepairNotes.js'

const { panelRecords, recoveryReport, saveNote, reload } = useRepairNotes()

const editingId = ref(null)
const draft = ref('')
const baseVersion = ref(0)
const errorMessage = ref('')
const savingId = ref(null)
const lastSavedId = ref(null)
const recoveryDismissed = ref(false)

const remaining = computed(() => NOTE_MAX_LENGTH - draft.value.trim().length)
const showRecovery = computed(
  () =>
    (recoveryReport.value?.recovered ||
      recoveryReport.value?.fallback === false) &&
    !recoveryDismissed.value,
)
const recoveryText = computed(() => {
  if (recoveryReport.value?.recoverySource === 'backup') {
    return '检测到当前备注数据损坏，已自动恢复到上一有效版本。'
  }
  if (recoveryReport.value?.fallback === false) {
    return '本地存储不可用，备注仅保存在当前会话中，刷新后将回到示例数据。'
  }
  return '检测到本地备注数据无法读取，已重置为内置示例数据。'
})

function startEdit(record) {
  editingId.value = record.id
  draft.value = record.content
  baseVersion.value = record.version
  errorMessage.value = ''
}

function cancelEdit() {
  editingId.value = null
  draft.value = ''
  errorMessage.value = ''
}

async function submit(record) {
  if (savingId.value) return
  savingId.value = record.id
  errorMessage.value = ''
  try {
    saveNote(record.id, draft.value, baseVersion.value)
    editingId.value = null
    draft.value = ''
    lastSavedId.value = record.id
  } catch (error) {
    if (error.code === 'NOTE_VERSION_CONFLICT') {
      errorMessage.value = `${error.message} 已重新加载，请再次编辑。`
      reload()
      editingId.value = null
      draft.value = ''
    } else {
      errorMessage.value = error.message
    }
  } finally {
    savingId.value = null
  }
}

function formatTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <div class="note-panel">
    <p v-if="showRecovery" class="note-recovery" role="status">
      {{ recoveryText }}
      <button type="button" class="note-link" @click="recoveryDismissed = true">
        知道了
      </button>
    </p>

    <ul class="note-list">
      <li v-for="record in panelRecords" :key="record.id" class="note-item">
        <template v-if="editingId === record.id">
          <div class="note-edit">
            <label class="note-target" :for="`note-draft-${record.id}`">
              {{ record.target }}
            </label>
            <textarea
              :id="`note-draft-${record.id}`"
              v-model="draft"
              class="note-input"
              rows="3"
              :maxlength="NOTE_MAX_LENGTH"
            ></textarea>
            <div class="note-actions">
              <span :class="['note-counter', { 'note-counter--warn': remaining < 0 }]">
                剩余 {{ remaining }} 字
              </span>
              <button
                type="button"
                class="note-btn note-btn--primary"
                :disabled="savingId === record.id || draft.trim().length === 0 || remaining < 0"
                @click="submit(record)"
              >
                {{ savingId === record.id ? '保存中…' : '保存' }}
              </button>
              <button type="button" class="note-btn" @click="cancelEdit">
                取消
              </button>
            </div>
            <p v-if="errorMessage" class="note-error">{{ errorMessage }}</p>
          </div>
        </template>
        <template v-else>
          <div class="note-meta">
            <span class="note-target">{{ record.target }}</span>
            <span class="note-version">v{{ record.version }}</span>
          </div>
          <p class="note-content">{{ record.content }}</p>
          <div class="note-foot">
            <span class="note-time">更新于 {{ formatTime(record.updatedAt) }}</span>
            <div class="note-foot-actions">
              <span v-if="lastSavedId === record.id" class="note-saved">已保存</span>
              <button type="button" class="note-link" @click="startEdit(record)">
                编辑
              </button>
            </div>
          </div>
        </template>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.note-panel {
  display: grid;
  gap: 12px;
}

.note-recovery {
  margin: 0;
  padding: 10px 14px;
  border-radius: 12px;
  background: #f6e5b9;
  color: #8b6314;
  font-size: 0.86rem;
}

.note-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 12px;
}

.note-item {
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(79, 57, 32, 0.08);
}

.note-meta,
.note-foot,
.note-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.note-target {
  font-weight: 600;
  color: #5c4a33;
}

.note-version {
  font-size: 0.74rem;
  color: #82684b;
  background: #efe2ca;
  border-radius: 999px;
  padding: 3px 9px;
}

.note-content {
  margin: 8px 0 0;
  color: #5c4a33;
  white-space: pre-wrap;
}

.note-time {
  font-size: 0.78rem;
  color: #82684b;
}

.note-foot {
  margin-top: 10px;
}

.note-foot-actions {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.note-saved {
  font-size: 0.78rem;
  color: #366338;
}

.note-edit {
  display: grid;
  gap: 8px;
}

.note-input {
  resize: vertical;
  border-radius: 12px;
  border: 1px solid rgba(79, 57, 32, 0.18);
  padding: 10px 12px;
  font: inherit;
  color: #5c4a33;
  background: #fffdf8;
}

.note-input:focus {
  outline: 2px solid rgba(121, 88, 47, 0.35);
  outline-offset: 1px;
}

.note-counter {
  margin-right: auto;
  font-size: 0.76rem;
  color: #82684b;
}

.note-counter--warn {
  color: #913d2f;
}

.note-btn {
  border: 1px solid rgba(79, 57, 32, 0.2);
  background: #fffdf8;
  color: #5c4a33;
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 0.82rem;
  cursor: pointer;
}

.note-btn--primary {
  background: #6d5028;
  border-color: #6d5028;
  color: #fff8eb;
}

.note-btn--primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.note-link {
  border: none;
  background: none;
  padding: 0;
  color: #7e6038;
  text-decoration: underline;
  cursor: pointer;
  font-size: 0.8rem;
}

.note-error {
  margin: 0;
  color: #913d2f;
  font-size: 0.8rem;
}
</style>
