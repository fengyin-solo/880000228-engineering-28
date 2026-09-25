// 修复备注本地持久化内核
//
// 存储模型：
//   主记录 localStorage[STORAGE_KEY]        —— 当前有效版本
//   备份   localStorage[BACKUP_STORAGE_KEY] —— 上一有效版本（回滚依据）
//
// 写入策略：先在内存中完成校验与版本比对，再落盘；
// 主记录写入失败时备份不动，调用方读取仍命中上一有效版本。
// 主记录解析/校验失败时，依次尝试备份、种子基线，并把有效版本重新落盘。

export const NOTE_SCHEMA_VERSION = 1
export const NOTE_MAX_LENGTH = 500

export const STORAGE_KEY = 'restoration:note-store:v1'
export const BACKUP_STORAGE_KEY = 'restoration:note-store:backup:v1'

export const NOTE_ERRORS = Object.freeze({
  INVALID_NOTE: 'INVALID_NOTE',
  EMPTY_NOTE: 'EMPTY_NOTE',
  NOTE_TOO_LONG: 'NOTE_TOO_LONG',
  UNKNOWN_ID: 'UNKNOWN_ID',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  SNAPSHOT_INVALID: 'SNAPSHOT_INVALID',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
})

export class NoteStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'NoteStoreError'
    this.code = code
    this.details = details
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const NOTE_ID_RE = /^(batch|task):[^\s|]+(?:\|[^\s|]+)?$/

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertNoteValue(note) {
  if (typeof note !== 'string') {
    throw new NoteStoreError(
      NOTE_ERRORS.INVALID_NOTE,
      '备注内容必须为字符串。',
    )
  }
  if (note.trim() === '') {
    throw new NoteStoreError(
      NOTE_ERRORS.EMPTY_NOTE,
      '备注内容不能为空白。',
    )
  }
  if (note.length > NOTE_MAX_LENGTH) {
    throw new NoteStoreError(
      NOTE_ERRORS.NOTE_TOO_LONG,
      `备注内容不能超过 ${NOTE_MAX_LENGTH} 个字符。`,
      { max: NOTE_MAX_LENGTH, actual: note.length },
    )
  }
}

/**
 * 校验单条备注记录。返回 true 或抛出包含失败原因的错误。
 */
export function assertValidNoteRecord(record, { knownIds = null } = {}) {
  if (!isPlainObject(record)) {
    throw new NoteStoreError(
      NOTE_ERRORS.SNAPSHOT_INVALID,
      '备注记录必须是对象。',
    )
  }
  const { id, note, revision, updatedAt } = record

  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    id.length > 200 ||
    !NOTE_ID_RE.test(id)
  ) {
    throw new NoteStoreError(
      NOTE_ERRORS.SNAPSHOT_INVALID,
      '备注记录的 id 非法。',
    )
  }
  if (knownIds && !knownIds.has(id)) {
    throw new NoteStoreError(
      NOTE_ERRORS.SNAPSHOT_INVALID,
      `存在未登记的备注 id：${id}`,
      { id },
    )
  }
  assertNoteValue(note)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new NoteStoreError(
      NOTE_ERRORS.SNAPSHOT_INVALID,
      '备注版本必须为不小于 1 的整数。',
    )
  }
  if (typeof updatedAt !== 'string' || !ISO_DATE_RE.test(updatedAt)) {
    throw new NoteStoreError(
      NOTE_ERRORS.SNAPSHOT_INVALID,
      'updatedAt 必须为 ISO 8601 UTC 时间字符串。',
    )
  }
  return true
}

/**
 * 严格校验整份快照。
 *  - knownIds：限制可接受的备注 id 集合，防止冲突/伪造写入
 *  - expectedIds：要求集合内每个 id 都有对应记录，防止丢数据
 *
 * 可重复执行：纯函数，无副作用，同一输入永远得到同一结论。
 */
export function validateNoteSnapshot(
  snapshot,
  { knownIds = null, expectedIds = null } = {},
) {
  if (!isPlainObject(snapshot)) {
    return { ok: false, reason: '快照必须是对象。' }
  }
  if (snapshot.schemaVersion !== NOTE_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `schema 版本不匹配：期望 ${NOTE_SCHEMA_VERSION}，实际 ${String(
        snapshot.schemaVersion,
      )}`,
    }
  }
  if (!Number.isInteger(snapshot.revision) || snapshot.revision < 1) {
    return { ok: false, reason: '快照版本号非法。' }
  }
  if (
    typeof snapshot.updatedAt !== 'string' ||
    !ISO_DATE_RE.test(snapshot.updatedAt)
  ) {
    return { ok: false, reason: '快照 updatedAt 非法。' }
  }
  if (!Array.isArray(snapshot.records)) {
    return { ok: false, reason: 'records 必须是数组。' }
  }

  const seen = new Set()
  for (const record of snapshot.records) {
    try {
      assertValidNoteRecord(record, { knownIds })
    } catch (error) {
      return { ok: false, reason: error.message }
    }
    if (seen.has(record.id)) {
      return { ok: false, reason: `备注 id 重复：${record.id}` }
    }
    seen.add(record.id)
  }

  if (expectedIds) {
    for (const id of expectedIds) {
      if (!seen.has(id)) {
        return { ok: false, reason: `缺少备注记录：${id}` }
      }
    }
  }
  return { ok: true }
}

function cloneSnapshot(snapshot) {
  return JSON.parse(JSON.stringify(snapshot))
}

function canonicalJson(value) {
  return JSON.stringify(value)
}

/** 纯内存存储，作为 localStorage 不可用（隐私模式 / 测试 / SSR）时的降级。 */
export function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      map.set(key, String(value))
    },
    removeItem(key) {
      map.delete(key)
    },
    clear() {
      map.clear()
    },
    key(index) {
      return Array.from(map.keys())[index] ?? null
    },
    get length() {
      return map.size
    },
  }
}

/** 优先使用 localStorage，访问受限或写入抛错时自动切换为内存存储。 */
export function createBrowserStorage(win = globalThis) {
  let native = null
  try {
    native = win?.localStorage ?? null
  } catch {
    native = null
  }
  const fallback = createMemoryStorage()

  const storage = {
    getItem(key) {
      try {
        return native ? native.getItem(key) : fallback.getItem(key)
      } catch {
        return fallback.getItem(key)
      }
    },
    setItem(key, value) {
      try {
        if (native) native.setItem(key, value)
        else fallback.setItem(key, value)
      } catch {
        native = null
        fallback.setItem(key, value)
      }
    },
    removeItem(key) {
      try {
        if (native) native.removeItem(key)
        else fallback.removeItem(key)
      } catch {
        native = null
        fallback.removeItem(key)
      }
    },
  }
  return storage
}

function readRaw(storage, key) {
  let raw
  try {
    raw = storage.getItem(key)
  } catch {
    return { ok: false, reason: '存储读取失败。' }
  }
  if (raw == null) return { ok: false, missing: true }
  try {
    return { ok: true, snapshot: JSON.parse(raw) }
  } catch {
    return { ok: false, reason: '存储内容不是合法 JSON。' }
  }
}

function buildSeedSnapshot(seedRecords, now) {
  const stampedAt = now()
  const records = seedRecords.map((record) => ({
    ...record,
    updatedAt: record.updatedAt || stampedAt,
  }))
  return {
    schemaVersion: NOTE_SCHEMA_VERSION,
    revision: 1,
    updatedAt: stampedAt,
    records,
  }
}

/**
 * 用种子基线对齐快照：
 *  - 丢弃未登记的记录（外部冲突写入 / 旧版本残留）
 *  - 补齐缺失记录（新增业务对象时向前兼容）
 * 不覆盖任何已登记且结构合法的备注。
 */
function reconcileWithSeeds(snapshot, seedRecords, now, knownIds) {
  const retained = snapshot.records.filter((record) => knownIds.has(record.id))
  const recordsById = new Map(retained.map((record) => [record.id, record]))
  let changed = retained.length !== snapshot.records.length

  for (const seed of seedRecords) {
    if (!recordsById.has(seed.id)) {
      recordsById.set(seed.id, { ...seed, updatedAt: now() })
      changed = true
    }
  }

  if (!changed) return snapshot

  const ordered = seedRecords
    .map((seed) => recordsById.get(seed.id))
    .filter(Boolean)
  return {
    ...snapshot,
    updatedAt: now(),
    records: ordered,
  }
}

/**
 * 创建备注存储实例。
 *
 * @param {object}   options
 * @param {Storage}  options.storage      类 localStorage 适配器
 * @param {Array}    options.seeds        种子备注记录（最小示例数据）
 * @param {Function} options.now          时间源，便于测试
 * @param {Function} options.onRecovered  触发损坏恢复回调（原因与来源）
 */
export function createNoteStore({
  storage,
  seeds,
  now = () => new Date().toISOString(),
  onRecovered = null,
} = {}) {
  if (!storage) {
    throw new NoteStoreError(
      NOTE_ERRORS.STORAGE_UNAVAILABLE,
      '缺少本地存储适配器。',
    )
  }
  if (!Array.isArray(seeds) || seeds.length === 0) {
    throw new NoteStoreError(
      NOTE_ERRORS.SNAPSHOT_INVALID,
      '缺少备注种子数据。',
    )
  }

  const knownIds = new Set(seeds.map((seed) => seed.id))
  const expectedIds = Array.from(knownIds)
  let current = null
  let lastRecovery = null

  const seedSnapshot = () => buildSeedSnapshot(cloneSnapshot(seeds), now)

  const inspectStrict = (snapshot) =>
    validateNoteSnapshot(snapshot, { knownIds, expectedIds })

  // 健康检查：允许快照携带“多出来但合法”的记录，只用于判断可读性
  const inspectReadable = (snapshot) => validateNoteSnapshot(snapshot)

  function persist(next) {
    // 双写策略：先更新备份为当前有效版本，再尝试写主记录。
    // 主记录写入抛错（如配额超限）时，备份仍是上一有效版本。
    if (current) {
      storage.setItem(BACKUP_STORAGE_KEY, canonicalJson(current))
    }
    try {
      storage.setItem(STORAGE_KEY, canonicalJson(next))
    } catch (error) {
      throw new NoteStoreError(
        NOTE_ERRORS.STORAGE_UNAVAILABLE,
        '备注写入本地存储失败。',
        { cause: error?.message },
      )
    }
    if (current) {
      storage.setItem(BACKUP_STORAGE_KEY, canonicalJson(next))
    }
    current = next
  }

  function setEffective(snapshot, source, reason) {
    current = snapshot
    if (canonicalJson(readRaw(storage, STORAGE_KEY).snapshot ?? null) !==
        canonicalJson(snapshot)) {
      // 主记录缺失或已损坏：直接以有效版本重建，不经过 persist 的备份前置逻辑
      try {
        storage.setItem(STORAGE_KEY, canonicalJson(snapshot))
        storage.setItem(BACKUP_STORAGE_KEY, canonicalJson(snapshot))
      } catch {
        // 存储完全不可写时仍以内存版本继续，至少保证当次会话可用
      }
    }
    if (source) {
      lastRecovery = { source, reason: reason ?? null, at: now() }
      if (typeof onRecovered === 'function') {
        onRecovered(lastRecovery)
      }
    }
    return snapshot
  }

  // 候选快照先与种子对齐，再严格复检；
  // 复检不过（内容损坏）时沿“备份 → 种子”链继续回退。
  function adopt(snapshot, source, reason) {
    const reconciled = reconcileWithSeeds(snapshot, seeds, now, knownIds)
    const check = inspectStrict(reconciled)
    if (check.ok) {
      return setEffective(reconciled, source, reason)
    }
    const backup = readRaw(storage, BACKUP_STORAGE_KEY)
    if (backup.ok && inspectReadable(backup.snapshot).ok) {
      const fromBackup = reconcileWithSeeds(backup.snapshot, seeds, now, knownIds)
      if (inspectStrict(fromBackup).ok) {
        return setEffective(fromBackup, 'backup', reason || check.reason)
      }
    }
    return setEffective(seedSnapshot(), 'seed', reason || check.reason)
  }

  function load() {
    if (current) return current

    const primary = readRaw(storage, STORAGE_KEY)

    if (!primary.ok && !primary.missing) {
      // 主记录已损坏：备份优先，其次种子基线
      const backup = readRaw(storage, BACKUP_STORAGE_KEY)
      if (backup.ok && inspectReadable(backup.snapshot).ok) {
        return adopt(backup.snapshot, 'backup', primary.reason)
      }
      return adopt(seedSnapshot(), 'seed', primary.reason)
    }

    if (primary.ok) {
      const strict = inspectStrict(primary.snapshot)
      if (strict.ok) {
        current = primary.snapshot
        return current
      }
      const readable = inspectReadable(primary.snapshot)
      if (readable.ok) {
        // 结构合法但与种子不一致：修复性对齐（去伪造、补缺失），不算数据损坏
        return adopt(primary.snapshot, null, strict.reason)
      }
      const backup = readRaw(storage, BACKUP_STORAGE_KEY)
      if (backup.ok && inspectReadable(backup.snapshot).ok) {
        return adopt(backup.snapshot, 'backup', strict.reason)
      }
      return adopt(seedSnapshot(), 'seed', strict.reason)
    }

    // 首次启动：以最小示例数据初始化，并生成备份
    const seeded = seedSnapshot()
    try {
      storage.setItem(STORAGE_KEY, canonicalJson(seeded))
      storage.setItem(BACKUP_STORAGE_KEY, canonicalJson(seeded))
    } catch {
      // 忽略：内存态仍可用
    }
    current = seeded
    return current
  }

  function getRecord(id) {
    load()
    return current.records.find((record) => record.id === id) || null
  }

  /**
   * 保存一条备注。
   * @param {string} id       备注 id
   * @param {string} note     新内容
   * @param {number} expectedRevision 调用方读取到的版本，用于冲突检测
   */
  function saveNote(id, note, expectedRevision) {
    load()
    if (typeof id !== 'string' || !knownIds.has(id)) {
      throw new NoteStoreError(
        NOTE_ERRORS.UNKNOWN_ID,
        `未登记的备注 id：${String(id)}`,
      )
    }
    assertNoteValue(note)
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      throw new NoteStoreError(
        NOTE_ERRORS.REVISION_CONFLICT,
        '保存时必须提供已读取到的备注版本。',
      )
    }

    const record = current.records.find((item) => item.id === id)
    if (!record) {
      throw new NoteStoreError(
        NOTE_ERRORS.UNKNOWN_ID,
        `缺少备注记录：${id}`,
      )
    }
    if (record.revision !== expectedRevision) {
      throw new NoteStoreError(
        NOTE_ERRORS.REVISION_CONFLICT,
        '备注已被其他写入更新，请刷新后重试。',
        {
          id,
          expected: expectedRevision,
          current: record.revision,
        },
      )
    }

    const nextRecord = {
      ...record,
      note,
      revision: record.revision + 1,
      updatedAt: now(),
    }
    const nextSnapshot = {
      schemaVersion: NOTE_SCHEMA_VERSION,
      revision: current.revision + 1,
      updatedAt: nextRecord.updatedAt,
      records: current.records.map((item) =>
        item.id === id ? nextRecord : item,
      ),
    }

    // 落盘前再次严格校验，杜绝任何脏快照进入本地存储
    const check = inspectStrict(nextSnapshot)
    if (!check.ok) {
      throw new NoteStoreError(NOTE_ERRORS.SNAPSHOT_INVALID, check.reason)
    }
    persist(nextSnapshot)
    return cloneSnapshot(nextRecord)
  }

  /**
   * 可重复执行的完整性校验。
   * 发现主记录损坏时，按 备份 → 种子 的顺序恢复并重建主记录；
   * 对健康存储连续执行结果完全一致（幂等）。
   */
  function verify() {
    const primary = readRaw(storage, STORAGE_KEY)
    const backup = readRaw(storage, BACKUP_STORAGE_KEY)

    const issues = []
    if (!primary.ok && !primary.missing) issues.push(`主记录损坏：${primary.reason}`)
    if (!backup.ok && !backup.missing) issues.push(`备份损坏：${backup.reason}`)

    let primaryHealthy = false
    if (primary.ok) {
      const strict = inspectStrict(primary.snapshot)
      if (strict.ok) {
        current = primary.snapshot
        primaryHealthy = true
      } else {
        const readable = inspectReadable(primary.snapshot)
        if (readable.ok) {
          // 仅与种子集合不一致：补齐即可，不算数据损坏
          adopt(primary.snapshot, null, strict.reason)
          primaryHealthy = true
        } else {
          issues.push(`主记录内容非法：${strict.reason}`)
        }
      }
    }

    if (!primaryHealthy) {
      const reason = issues.join('；') || null
      if (backup.ok && inspectReadable(backup.snapshot).ok) {
        adopt(backup.snapshot, 'backup', reason)
      } else {
        adopt(seedSnapshot(), 'seed', reason)
      }
    }

    const canonical = canonicalJson(current)
    if (
      readRaw(storage, STORAGE_KEY).missing ||
      canonicalJson(readRaw(storage, STORAGE_KEY).snapshot ?? null) !== canonical
    ) {
      try {
        storage.setItem(STORAGE_KEY, canonical)
      } catch {
        issues.push('主记录重建写入失败。')
      }
    }
    if (
      readRaw(storage, BACKUP_STORAGE_KEY).missing ||
      canonicalJson(readRaw(storage, BACKUP_STORAGE_KEY).snapshot ?? null) !==
        canonical
    ) {
      try {
        storage.setItem(BACKUP_STORAGE_KEY, canonical)
      } catch {
        issues.push('备份重建写入失败。')
      }
    }

    const finalPrimary = readRaw(storage, STORAGE_KEY)
    const finalBackup = readRaw(storage, BACKUP_STORAGE_KEY)
    const primaryValid =
      finalPrimary.ok && inspectStrict(finalPrimary.snapshot).ok
    const backupValid =
      finalBackup.ok && inspectStrict(finalBackup.snapshot).ok

    return {
      ok: primaryValid && backupValid,
      issues,
      recovery: lastRecovery ? { ...lastRecovery } : null,
      recordCount: current.records.length,
      revision: current.revision,
    }
  }

  return {
    load,
    verify,
    saveNote,
    getNote(id) {
      const record = getRecord(id)
      return record ? cloneSnapshot(record) : null
    },
    listNotes() {
      load()
      return cloneSnapshot(current.records)
    },
    getSnapshot() {
      load()
      return cloneSnapshot(current)
    },
    getLastRecovery() {
      return lastRecovery ? { ...lastRecovery } : null
    },
  }
}
