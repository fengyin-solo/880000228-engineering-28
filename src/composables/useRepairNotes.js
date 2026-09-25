import { computed, ref } from 'vue'

import {
  createBrowserStorage,
  createNoteStore,
  STORAGE_KEY,
} from '../services/noteStore.js'
import {
  restorationBatches,
  restorationTasks,
} from '../data/restorationData.js'
import { restorationNoteRefs } from '../data/restorationNotes.js'

// 整个工作台共享一个持久化单例，页面刷新 / 重新打开后从 localStorage 恢复。
let store = null
const records = ref([])
const envelopeUpdatedAt = ref(null)
const recoveryReport = ref(null)

function syncFromStore() {
  const snapshot = store.getSnapshot()
  records.value = snapshot.records
  envelopeUpdatedAt.value = snapshot.updatedAt
  recoveryReport.value = store.getReport()
}

export function useRepairNotes() {
  if (!store) {
    store = createNoteStore({ storage: createBrowserStorage() })
    syncFromStore()

    // 其他标签页写入后，重新执行可重复校验并刷新当前视图。
    if (typeof globalThis !== 'undefined' && globalThis.addEventListener) {
      globalThis.addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEY && event.key !== null) return
        store.verify()
        syncFromStore()
      })
    }
  }

  const noteById = computed(() => {
    const map = new Map()
    for (const record of records.value) map.set(record.id, record)
    return map
  })

  // 只覆盖既有业务对象的 note 字段，其它字段保持引用不变，
  // 因此所有现有组件的展示与业务字段都不受影响。
  const batches = computed(() =>
    restorationBatches.map((batch) => {
      const noteId = restorationNoteRefs.batches[batch.code]
      const persisted = noteId ? noteById.value.get(noteId) : null
      return { ...batch, note: persisted ? persisted.content : batch.note }
    }),
  )

  const tasks = computed(() =>
    restorationTasks.map((task, index) => {
      const ref = restorationNoteRefs.tasks[index]
      const persisted = ref ? noteById.value.get(ref.id) : null
      return { ...task, note: persisted ? persisted.content : task.note }
    }),
  )

  const panelRecords = computed(() => {
    const batchTitleByCode = new Map(
      restorationBatches.map((batch) => [batch.code, batch.title]),
    )
    return records.value.map((record) => {
      let target = ''
      if (record.scope === 'batch') {
        target = batchTitleByCode.get(record.refId) || record.refId
      } else {
        const ref = restorationNoteRefs.tasks.find((item) => item.id === record.refId)
        target = ref ? `${ref.title}（${ref.owner}）` : record.refId
      }
      return { ...record, target }
    })
  })

  function saveNote(id, content, expectedVersion) {
    const saved = store.save(id, content, expectedVersion)
    syncFromStore()
    return saved
  }

  // 冲突或外部变更后丢弃本地编辑基线，重新读取上一有效版本。
  function reload() {
    store.verify()
    syncFromStore()
  }

  return {
    records,
    envelopeUpdatedAt,
    recoveryReport,
    batches,
    tasks,
    panelRecords,
    saveNote,
    reload,
  }
}
