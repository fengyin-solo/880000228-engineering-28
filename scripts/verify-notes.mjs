// 构建期校验：修复备注本地持久化链路。
// 可重复执行（纯内存存储，不触碰浏览器 / 真实 localStorage）。
// 运行：node scripts/verify-notes.mjs   （npm run build 前由 prebuild 自动执行）

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  restorationBatches,
  restorationTasks,
} from '../src/data/restorationData.js'
import {
  NOTE_MAX_LENGTH,
  NOTE_SCHEMA_VERSION,
  restorationNoteRefs,
  restorationSeedNotes,
} from '../src/data/restorationNotes.js'
import {
  NoteConflictError,
  NoteValidationError,
  STORAGE_BACKUP_KEY,
  STORAGE_KEY,
  buildSeedEnvelope,
  createMemoryStorage,
  createNoteStore,
  normalizeNoteContent,
  parseEnvelope,
  stableSerialize,
  validateEnvelope,
  validateNoteRecord,
} from '../src/services/noteStore.js'

const seedEnvelope = buildSeedEnvelope()

function bootStore(initial = {}, clock = () => '2026-09-25T08:00:00.000Z') {
  const storage = createMemoryStorage(initial)
  const store = createNoteStore({ storage, clock })
  return { storage, store }
}

test('内置示例数据必须通过信封校验且内容与静态业务数据一致', () => {
  assert.doesNotThrow(() => validateEnvelope(seedEnvelope))
  assert.equal(seedEnvelope.schemaVersion, NOTE_SCHEMA_VERSION)
  assert.equal(seedEnvelope.records.length, restorationSeedNotes.length)

  for (const batch of restorationBatches) {
    const noteId = restorationNoteRefs.batches[batch.code]
    const record = seedEnvelope.records.find((item) => item.id === noteId)
    assert.ok(record, `批次 ${batch.code} 缺少备注记录`)
    assert.equal(record.content, batch.note)
    assert.equal(record.scope, 'batch')
    assert.equal(record.version, 1)
  }
  for (const [index, task] of restorationTasks.entries()) {
    const ref = restorationNoteRefs.tasks[index]
    const record = seedEnvelope.records.find((item) => item.id === ref.id)
    assert.ok(record, `任务 ${task.title} 缺少备注记录`)
    assert.equal(record.content, task.note)
    assert.equal(record.scope, 'task')
  }
})

test('空存储首次启动写入示例数据，重启后仍可读取', () => {
  const { storage, store } = bootStore()
  assert.equal(storage.getItem(STORAGE_KEY), stableSerialize(seedEnvelope))
  assert.equal(store.list().length, restorationSeedNotes.length)
  // 首次播种不属于损坏恢复。
  assert.equal(store.getReport().recovered, false)
  assert.equal(store.getReport().fallback, true)

  // 模拟工作台关闭后重新打开：用同一份底层存储新建 store。
  const reopened = createNoteStore({
    storage: createMemoryStorage(storage._dump()),
  })
  assert.deepEqual(reopened.list(), store.list())
  assert.equal(reopened.getReport().recovered, false)
})

test('保存备注：版本自增、更新时间刷新并持久化，旧版本进入 backup', () => {
  const { storage, store } = bootStore()
  const saved = store.save('task-01', '  新的修复备注内容  ', 1)
  assert.equal(saved.content, '新的修复备注内容')
  assert.equal(saved.version, 2)
  assert.equal(saved.updatedAt, '2026-09-25T08:00:00.000Z')

  const reopened = createNoteStore({ storage: createMemoryStorage(storage._dump()) })
  assert.equal(reopened.get('task-01').content, '新的修复备注内容')
  assert.equal(reopened.get('task-01').version, 2)
  assert.ok(storage.getItem(STORAGE_BACKUP_KEY))
  const backup = parseEnvelope(storage.getItem(STORAGE_BACKUP_KEY))
  assert.equal(backup.records.find((r) => r.id === 'task-01').version, 1)
})

test('空值 / 纯空白备注被拒绝且现有数据不被污染', () => {
  const { store } = bootStore()
  const before = store.get('task-01')
  for (const bad of ['', '   ', '\n\t', null, undefined, 0]) {
    assert.throws(() => store.save('task-01', bad, before.version), NoteValidationError)
  }
  assert.deepEqual(store.get('task-01'), before)
  assert.throws(() => normalizeNoteContent('   '), /不能为空/)
})

test('超长备注（超过 200 字）被拒绝，200 字可以保存', () => {
  const { store } = bootStore()
  const before = store.get('batch-a-03')
  assert.throws(
    () => store.save('batch-a-03', '纸'.repeat(NOTE_MAX_LENGTH + 1), 1),
    /不能超过 200/,
  )
  assert.deepEqual(store.get('batch-a-03'), before)

  const saved = store.save('batch-a-03', '纸'.repeat(NOTE_MAX_LENGTH), 1)
  assert.equal(saved.content.length, NOTE_MAX_LENGTH)
})

test('冲突写入：版本号不匹配时拒绝，当前数据保持不变', () => {
  const { store } = bootStore()
  const before = store.get('task-02')
  assert.throws(
    () => store.save('task-02', '别的标签页写来的内容', 99),
    (error) => {
      assert.ok(error instanceof NoteConflictError)
      assert.equal(error.currentVersion, 1)
      return true
    },
  )
  assert.deepEqual(store.get('task-02'), before)

  // 基于过期版本连写：第一次成功后，第二次必须冲突。
  store.save('task-02', '第一次更新', 1)
  assert.throws(() => store.save('task-02', '第二次更新', 1), NoteConflictError)
  assert.equal(store.get('task-02').version, 2)
})

test('主副本损坏时自动回退到 backup 上一有效版本', () => {
  const { storage, store } = bootStore()
  store.save('task-01', '第二次有效内容', 1)

  // 模拟主副本损坏（例如写入中断、扩展程序污染）。
  storage.setItem(STORAGE_KEY, '{损坏的 JSON')
  const recovered = createNoteStore({ storage: createMemoryStorage(storage._dump()) })
  const report = recovered.getReport()
  assert.equal(report.recovered, true)
  assert.equal(report.recoverySource, 'backup')
  assert.equal(recovered.get('task-01').version, 1)
  assert.equal(recovered.get('task-01').content, '虫道贯穿标题栏，需先固色。')

  // 恢复后主副本已被重写为有效数据，再次校验无需恢复。
  assert.equal(recovered.verify().recovered, false)
})

test('主副本与 backup 同时损坏时重置为内置示例数据', () => {
  const storage = createMemoryStorage({
    [STORAGE_KEY]: 'not-json',
    [STORAGE_BACKUP_KEY]: JSON.stringify({ schemaVersion: 99, records: [] }),
  })
  const store = createNoteStore({ storage })
  assert.deepEqual(store.getReport(), {
    recovered: true,
    recoverySource: 'seed',
    fallback: true,
  })
  assert.deepEqual(store.list(), seedEnvelope.records)
  assert.doesNotThrow(() => parseEnvelope(storage.getItem(STORAGE_KEY)))
})

test('结构合法但夹带额外备注记录的数据包会被拒绝并重置', () => {
  const poisoned = {
    schemaVersion: NOTE_SCHEMA_VERSION,
    updatedAt: '2026-09-25T00:00:00.000Z',
    records: [
      ...seedEnvelope.records,
      {
        id: 'injected-note',
        scope: 'task',
        refId: 'task-x',
        content: '外部注入的非法备注槽位',
        version: 1,
        updatedAt: '2026-09-25T00:00:00.000Z',
      },
    ],
  }
  const storage = createMemoryStorage({ [STORAGE_KEY]: JSON.stringify(poisoned) })
  const store = createNoteStore({ storage })
  assert.equal(store.getReport().recovered, true)
  assert.deepEqual(store.list(), seedEnvelope.records)
  assert.equal(store.get('injected-note'), null)
})

test('写入抛错时回滚：磁盘与内存都停留在上一有效版本', () => {
  const memory = createMemoryStorage()
  // 启动阶段正常，模拟本地存储在引导成功后开始写入失败（如配额耗尽）。
  let failing = false
  const flakyStorage = {
    getItem: (key) => memory.getItem(key),
    setItem(key, value) {
      if (failing) throw new Error('QuotaExceededError')
      memory.setItem(key, value)
    },
    removeItem: (key) => memory.removeItem(key),
  }
  const store = createNoteStore({ storage: flakyStorage })
  failing = true
  assert.throws(() => store.save('task-01', '注定失败的写入', 1), NoteValidationError)

  // 内存中的有效副本不变。
  assert.equal(store.get('task-01').version, 1)
  assert.equal(store.get('task-01').content, '虫道贯穿标题栏，需先固色。')
  // 磁盘主副本仍是示例数据。
  assert.equal(memory.getItem(STORAGE_KEY), stableSerialize(seedEnvelope))

  // 用同一份存储重新打开，校验链路正常，读不到失败内容。
  const reopened = createNoteStore({ storage: createMemoryStorage(memory._dump()) })
  assert.equal(reopened.get('task-01').content, '虫道贯穿标题栏，需先固色。')
})

test('落盘后复读不一致时回滚，并能从 backup 恢复', () => {
  const memory = createMemoryStorage()
  const corruptingStorage = {
    getItem: (key) => memory.getItem(key),
    setItem(key, value) {
      // 模拟主副本写入后被外部改写，backup 正常。
      memory.setItem(
        key,
        key === STORAGE_KEY ? `${value}<!-- tampered -->` : value,
      )
    },
    removeItem: (key) => memory.removeItem(key),
  }
  const store = createNoteStore({ storage: corruptingStorage })
  assert.throws(() => store.save('task-01', '被污染的写入', 1), /落盘校验失败/)
  assert.equal(store.get('task-01').version, 1)

  const reopened = createNoteStore({ storage: createMemoryStorage(memory._dump()) })
  assert.equal(reopened.getReport().recovered, true)
  assert.equal(reopened.getReport().recoverySource, 'backup')
  assert.equal(reopened.get('task-01').content, '虫道贯穿标题栏，需先固色。')
})

test('verify 可重复执行：健康数据稳定，损坏数据自愈后再执行不再恢复', () => {
  const { storage, store } = bootStore()
  store.save('task-03', '有效更新', 1)

  assert.equal(store.verify().recovered, false)
  assert.equal(store.verify().recovered, false)

  storage.setItem(STORAGE_KEY, '###')
  assert.equal(store.verify().recoverySource, 'backup')
  assert.equal(store.verify().recovered, false)
  assert.equal(store.get('task-03').content, '等待封套尺寸确认。')
})

test('记录级校验拦截非法字段', () => {
  const base = { ...seedEnvelope.records[0] }
  const badRecords = [
    null,
    [],
    'text',
    { ...base, id: 'BAD ID' },
    { ...base, scope: 'unknown' },
    { ...base, content: '' },
    { ...base, version: 0 },
    { ...base, version: 1.5 },
    { ...base, updatedAt: 'not-a-date' },
    { ...base, extra: true },
    { ...base, content: undefined },
  ]
  for (const bad of badRecords) {
    assert.throws(() => validateNoteRecord(bad), NoteValidationError)
  }
  assert.doesNotThrow(() => validateNoteRecord(base))
})

test('信封级校验拦截重复 id、错误 schemaVersion 与畸形 JSON', () => {
  assert.throws(
    () =>
      validateEnvelope({
        schemaVersion: NOTE_SCHEMA_VERSION,
        updatedAt: '2026-09-25T00:00:00.000Z',
        records: [seedEnvelope.records[0], seedEnvelope.records[0]],
      }),
    /重复/,
  )
  assert.throws(() => parseEnvelope('{'), /JSON/)
  assert.throws(() => parseEnvelope(''), /为空/)
})

test('无存储适配时降级为内存模式并给出 fallback 报告', () => {
  const store = createNoteStore({ storage: null })
  assert.deepEqual(store.list(), seedEnvelope.records)
  assert.equal(store.getReport().fallback, false)
  const saved = store.save('task-01', '仅当前会话有效', 1)
  assert.equal(saved.version, 2)
  assert.equal(store.get('task-01').version, 2)
})
