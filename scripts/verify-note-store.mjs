// 备注本地持久化链路的可重复执行校验（零第三方依赖，node --test）
//
// 运行：node scripts/verify-note-store.mjs
// 已挂到 npm run verify:notes，并作为 npm run build 的前置步骤。

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BACKUP_STORAGE_KEY,
  NOTE_MAX_LENGTH,
  NoteStoreError,
  STORAGE_KEY,
  createMemoryStorage,
  createNoteStore,
  validateNoteSnapshot,
} from '../src/utils/noteStore.js'
import {
  batchNoteId,
  buildRestorationNoteSeeds,
  taskNoteId,
} from '../src/data/restorationNoteSeeds.js'
import {
  restorationBatches,
  restorationTasks,
} from '../src/data/restorationData.js'

const BASE_TIME = '2026-01-01T00:00:00.000Z'

function createClock(startMs = Date.parse(BASE_TIME)) {
  let ms = startMs
  return {
    now() {
      const value = new Date(ms).toISOString()
      ms += 1000
      return value
    },
  }
}

function makeSeeds(clock = createClock()) {
  return buildRestorationNoteSeeds(() => clock.now())
}

function makeStore(storage = createMemoryStorage(), seeds = makeSeeds()) {
  const clock = createClock()
  const store = createNoteStore({
    storage,
    seeds,
    now: () => clock.now(),
  })
  return { store, storage, seeds, clock }
}

test('首次启动以最小示例数据初始化，主记录与备份同时落盘', () => {
  const { store, storage, seeds } = makeStore()

  const notes = store.listNotes()
  assert.equal(notes.length, seeds.length)
  assert.equal(storage.getItem(STORAGE_KEY)?.includes('"schemaVersion":1'), true)
  assert.ok(storage.getItem(BACKUP_STORAGE_KEY))

  const snapshot = store.getSnapshot()
  assert.equal(snapshot.schemaVersion, 1)
  assert.ok(Number.isInteger(snapshot.revision))
  for (const record of notes) {
    assert.ok(record.revision >= 1)
    assert.match(record.updatedAt, /^\d{4}-\d{2}-\d{2}T/)
  }
})

test('保存成功后版本递增、更新时间刷新，且模拟重启后仍可读取', () => {
  const storage = createMemoryStorage()
  const first = makeStore(storage)
  const target = first.seeds[0]

  const saved = first.store.saveNote(target.id, '新的修复备注内容', target.revision)
  assert.equal(saved.revision, target.revision + 1)
  assert.equal(saved.note, '新的修复备注内容')
  assert.notEqual(saved.updatedAt, target.updatedAt)

  // 模拟开发环境重启 / 重新打开工作台：新建实例复用同一底层存储
  const reopened = makeStore(storage, makeSeeds())
  const after = reopened.store.getNote(target.id)
  assert.equal(after.note, '新的修复备注内容')
  assert.equal(after.revision, saved.revision)
})

test('空值与纯空白备注被拒绝，现有数据保持不变', () => {
  const { store, seeds } = makeStore()
  const target = seeds[0]
  const before = store.getNote(target.id)

  for (const bad of ['', '   ', '\n\t ']) {
    assert.throws(
      () => store.saveNote(target.id, bad, before.revision),
      (error) => error.code === 'EMPTY_NOTE',
    )
  }
  assert.throws(
    () => store.saveNote(target.id, null, before.revision),
    (error) => error.code === 'INVALID_NOTE',
  )
  assert.throws(
    () => store.saveNote(target.id, 123, before.revision),
    (error) => error.code === 'INVALID_NOTE',
  )
  assert.deepEqual(store.getNote(target.id), before)
})

test('超长备注被拒绝且不落盘', () => {
  const { store, storage, seeds } = makeStore()
  const target = seeds[0]
  const revision = store.getNote(target.id).revision

  assert.throws(
    () => store.saveNote(target.id, '字'.repeat(NOTE_MAX_LENGTH + 1), revision),
    (error) => error.code === 'NOTE_TOO_LONG',
  )
  const boundary = store.saveNote(
    target.id,
    'a'.repeat(NOTE_MAX_LENGTH),
    revision,
  )
  assert.equal(boundary.note.length, NOTE_MAX_LENGTH)
  assert.ok(storage.getItem(STORAGE_KEY).includes('a'.repeat(NOTE_MAX_LENGTH)))
})

test('版本号冲突的写入被拒绝，后写不会覆盖先写', () => {
  const storage = createMemoryStorage()
  const first = makeStore(storage)
  const id = first.seeds[0].id

  first.store.saveNote(id, '第一次更新', first.seeds[0].revision)

  // 另一处仍拿着旧版本号写入
  const reopened = makeStore(storage, makeSeeds())
  assert.throws(
    () => reopened.store.saveNote(id, '冲突的覆盖写入', first.seeds[0].revision),
    (error) => {
      assert.ok(error instanceof NoteStoreError)
      assert.equal(error.code, 'REVISION_CONFLICT')
      assert.equal(error.details.expected, first.seeds[0].revision)
      assert.equal(error.details.current, first.seeds[0].revision + 1)
      return true
    },
  )
  assert.equal(reopened.store.getNote(id).note, '第一次更新')
})

test('未登记 id 的写入被拒绝，防止伪造数据污染存储', () => {
  const { store } = makeStore()
  assert.throws(
    () => store.saveNote('task:不存在|某人', '备注', 1),
    (error) => error.code === 'UNKNOWN_ID',
  )
  assert.throws(
    () => store.saveNote('evil:id', '备注', 1),
    (error) => error.code === 'UNKNOWN_ID',
  )
})

test('多次更新后备份始终跟随最近有效版本，回滚不丢已确认的更新', () => {
  const storage = createMemoryStorage()
  const first = makeStore(storage)
  const id = first.seeds[0].id

  const r1 = first.store.saveNote(id, '第一次更新', first.seeds[0].revision)
  const r2 = first.store.saveNote(id, '第二次更新', r1.revision)
  assert.equal(r2.revision, first.seeds[0].revision + 2)

  storage.setItem(STORAGE_KEY, '### 主记录被截断损坏 ###')

  const reopened = makeStore(storage, makeSeeds())
  const note = reopened.store.getNote(id)
  assert.equal(note.note, '第二次更新')
  assert.equal(note.revision, r2.revision)
  assert.equal(reopened.store.getLastRecovery().source, 'backup')
})

test('主记录 JSON 损坏时自动回到备份（上一有效版本）', () => {
  const storage = createMemoryStorage()
  const first = makeStore(storage)
  const id = first.seeds[1].id
  first.store.saveNote(id, '已确认的有效更新', first.seeds[1].revision)

  // 模拟主记录被外部写坏，备份保持上一有效版本
  storage.setItem(STORAGE_KEY, '{损坏的 JSON')

  const recovered = makeStore(storage, makeSeeds())
  const note = recovered.store.getNote(id)
  assert.equal(note.note, '已确认的有效更新')
  assert.equal(recovered.store.getLastRecovery().source, 'backup')

  const report = recovered.store.verify()
  assert.equal(report.ok, true)
  assert.deepEqual(report.recovery.source, 'backup')
})

test('主记录与备份都损坏时回退种子基线，并重建双份存储', () => {
  const storage = createMemoryStorage()
  const first = makeStore(storage)
  first.store.saveNote(first.seeds[0].id, '临时更新', first.seeds[0].revision)

  storage.setItem(STORAGE_KEY, 'not-json')
  storage.setItem(BACKUP_STORAGE_KEY, '{"schemaVersion":999}')

  const recovered = makeStore(storage, makeSeeds())
  assert.equal(
    recovered.store.getNote(first.seeds[0].id).note,
    first.seeds[0].note,
  )
  assert.equal(recovered.store.getLastRecovery().source, 'seed')

  // 主记录与备份都已重建为严格合法快照
  const report = recovered.store.verify()
  assert.equal(report.ok, true)
  assert.equal(report.recordCount, first.seeds.length)
})

test('verify 可重复执行且幂等：对健康存储连续执行结果一致', () => {
  const { store, storage } = makeStore()
  store.saveNote(store.listNotes()[2].id, '校验前更新', store.listNotes()[2].revision)

  const report1 = store.verify()
  const primaryAfter1 = storage.getItem(STORAGE_KEY)
  const backupAfter1 = storage.getItem(BACKUP_STORAGE_KEY)
  assert.equal(report1.ok, true)

  const report2 = store.verify()
  const report3 = store.verify()
  assert.equal(report2.ok, true)
  assert.equal(report3.ok, true)
  assert.equal(storage.getItem(STORAGE_KEY), primaryAfter1)
  assert.equal(storage.getItem(BACKUP_STORAGE_KEY), backupAfter1)
  assert.deepEqual(
    { ok: report2.ok, revision: report2.revision, count: report2.recordCount },
    { ok: report3.ok, revision: report3.revision, count: report3.recordCount },
  )
})

test('主记录含未登记 id 时校验失败，但不影响其他记录的读取', () => {
  const { store, storage, seeds } = makeStore()
  store.listNotes() // 触发首次初始化落盘
  const raw = JSON.parse(storage.getItem(STORAGE_KEY))
  raw.records.push({
    id: 'task:伪造对象|某人',
    note: '不应存在的备注',
    revision: 1,
    updatedAt: BASE_TIME,
  })
  storage.setItem(STORAGE_KEY, JSON.stringify(raw))

  // 严格校验明确报错
  const direct = validateNoteSnapshot(raw, {
    knownIds: new Set(seeds.map((seed) => seed.id)),
    expectedIds: seeds.map((seed) => seed.id),
  })
  assert.equal(direct.ok, false)

  // 实例自动修复并仍可读取全部合法记录
  const report = store.verify()
  assert.equal(report.ok, true)
  assert.equal(store.listNotes().length, seeds.length)
  assert.equal(store.getNote('task:伪造对象|某人'), null)
})

test('主记录写入失败（如配额超限）时整次保存回滚，备份保持上一有效版本', () => {
  const storage = createMemoryStorage()
  const failing = {
    getItem: (key) => storage.getItem(key),
    setItem(key, value) {
      if (key === STORAGE_KEY) throw new Error('QuotaExceededError')
      storage.setItem(key, value)
    },
    removeItem: (key) => storage.removeItem(key),
  }
  const seeds = makeSeeds()
  const clock = createClock()
  const store = createNoteStore({
    storage: failing,
    seeds,
    now: () => clock.now(),
  })
  const target = seeds[0]

  assert.throws(
    () => store.saveNote(target.id, '注定写不进去的备注', target.revision),
    (error) => error.code === 'STORAGE_UNAVAILABLE',
  )

  // 主记录未被污染，重新打开后仍是上一有效版本（种子内容）
  const reopened = makeStore(storage, seeds)
  assert.equal(reopened.store.getNote(target.id).note, target.note)
  assert.equal(reopened.store.getNote(target.id).revision, target.revision)
})

test('种子最小示例数据与业务数据的备注一一对应，业务字段保持原样', () => {
  const seeds = buildRestorationNoteSeeds(() => BASE_TIME)
  assert.equal(seeds.length, restorationBatches.length + restorationTasks.length)

  for (const batch of restorationBatches) {
    const record = seeds.find((item) => item.id === batchNoteId(batch.code))
    assert.ok(record, `批次 ${batch.code} 缺少种子备注`)
    assert.equal(record.note, batch.note)
    assert.equal(record.revision, 1)
    assert.equal(record.updatedAt, BASE_TIME)
  }
  for (const task of restorationTasks) {
    const record = seeds.find(
      (item) => item.id === taskNoteId(task.title, task.owner),
    )
    assert.ok(record)
    assert.equal(record.note, task.note)
  }

  // 校验器接受完整合法快照
  const snapshot = {
    schemaVersion: 1,
    revision: 1,
    updatedAt: BASE_TIME,
    records: seeds,
  }
  const knownIds = new Set(seeds.map((seed) => seed.id))
  assert.equal(
    validateNoteSnapshot(snapshot, {
      knownIds,
      expectedIds: [...knownIds],
    }).ok,
    true,
  )
})

test('损坏快照的各种形态都能被严格校验拦截', () => {
  const seeds = makeSeeds()
  const knownIds = new Set(seeds.map((seed) => seed.id))
  const expectedIds = seeds.map((seed) => seed.id)
  const validSnapshot = {
    schemaVersion: 1,
    revision: 1,
    updatedAt: BASE_TIME,
    records: seeds,
  }

  const badSnapshots = [
    null,
    [],
    { ...validSnapshot, schemaVersion: 2 },
    { ...validSnapshot, revision: 0 },
    { ...validSnapshot, updatedAt: '2026/01/01' },
    { ...validSnapshot, records: 'nope' },
    { ...validSnapshot, records: [{ ...seeds[0], note: '' }] },
    { ...validSnapshot, records: [{ ...seeds[0], note: 'x'.repeat(NOTE_MAX_LENGTH + 1) }] },
    { ...validSnapshot, records: [{ ...seeds[0], revision: '3.5' }] },
    { ...validSnapshot, records: [{ ...seeds[0], updatedAt: 'not-a-date' }] },
    { ...validSnapshot, records: [...seeds, seeds[0]] },
    { ...validSnapshot, records: seeds.slice(1) },
  ]

  for (const bad of badSnapshots) {
    const result = validateNoteSnapshot(bad, { knownIds, expectedIds })
    assert.equal(result.ok, false, `应当拦截：${JSON.stringify(bad).slice(0, 80)}`)
    assert.ok(result.reason)
  }
})
