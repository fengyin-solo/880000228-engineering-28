import {
  batchNoteId,
  restorationNoteSeeds,
  taskNoteId,
} from '../data/restorationNoteSeeds.js'
import {
  createBrowserStorage,
  createNoteStore,
  NOTE_ERRORS,
} from '../utils/noteStore.js'

// 工作台生命周期内共享同一份本地备注状态
const noteStore = createNoteStore({
  storage: createBrowserStorage(),
  seeds: restorationNoteSeeds,
})

/**
 * 启动时把本地持久化的备注回填到业务数据上。
 * 只覆盖 note（备注）字段，版本与更新时间保留在持久化层，
 * 不改动任何业务字段，也不改变备注的展示方式。
 */
export function hydrateRestorationNotes(batches, tasks) {
  const records = noteStore.listNotes()
  const noteById = new Map(records.map((record) => [record.id, record.note]))

  for (const batch of batches) {
    const note = noteById.get(batchNoteId(batch.code))
    if (typeof note === 'string') batch.note = note
  }
  for (const task of tasks) {
    const note = noteById.get(taskNoteId(task.title, task.owner))
    if (typeof note === 'string') task.note = note
  }
}

/** 应用启动后执行一次可重复校验，修复可能被外部污染的本地数据 */
export function verifyRestorationNotes() {
  return noteStore.verify()
}

export function saveBatchNote(code, note, expectedRevision) {
  return noteStore.saveNote(batchNoteId(code), note, expectedRevision)
}

export function saveTaskNote(title, owner, note, expectedRevision) {
  return noteStore.saveNote(taskNoteId(title, owner), note, expectedRevision)
}

export function getBatchNote(code) {
  return noteStore.getNote(batchNoteId(code))
}

export function getTaskNote(title, owner) {
  return noteStore.getNote(taskNoteId(title, owner))
}

export { NOTE_ERRORS }
