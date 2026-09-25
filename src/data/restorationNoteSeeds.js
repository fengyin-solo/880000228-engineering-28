import { restorationBatches, restorationTasks } from './restorationData.js'

// 备注记录使用稳定业务键生成标识，不新增、不改写任何业务字段
export function batchNoteId(code) {
  return `batch:${code}`
}

export function taskNoteId(title, owner) {
  return `task:${title}|${owner}`
}

function toSeedRecord(id, note, now) {
  return {
    id,
    note,
    revision: 1,
    updatedAt: now(),
  }
}

/**
 * 依据当前业务数据构造最小示例备注集合，
 * 作为本地持久化首次写入与损坏兜底的基线版本。
 */
export function buildRestorationNoteSeeds(now = () => new Date().toISOString()) {
  const batchSeeds = restorationBatches.map((item) =>
    toSeedRecord(batchNoteId(item.code), item.note, now),
  )
  const taskSeeds = restorationTasks.map((item) =>
    toSeedRecord(taskNoteId(item.title, item.owner), item.note, now),
  )
  return [...batchSeeds, ...taskSeeds]
}

export const restorationNoteSeeds = buildRestorationNoteSeeds()
