// 修复备注的本地持久化核心（框架无关，可在 Node / 浏览器中运行）。
//
// 存储结构：
//   localStorage[STORAGE_KEY]         当前有效版本
//   localStorage[STORAGE_BACKUP_KEY]  上一有效版本（写入成功后轮换）
//
// 数据信封：
//   { schemaVersion: 1, updatedAt: string, records: NoteRecord[] }
// NoteRecord：
//   { id, scope: 'batch'|'task', refId, content(1..200), version(>=1 整数), updatedAt(ISO) }
//
// 每次启动 / 跨标签页变更都会执行可重复运行的 verify：当前副本损坏则
// 回退到 backup；backup 也损坏则重置为内置示例数据。任何写入都先在内存中
// 构造并校验，再落盘并重新读取确认，失败时恢复上一有效版本。

import {
  NOTE_MAX_LENGTH,
  NOTE_SCHEMA_VERSION,
  restorationNoteRefs,
  restorationSeedNotes,
} from '../data/restorationNotes.js'

export const STORAGE_KEY = 'restoration:repair-notes:v1'
export const STORAGE_BACKUP_KEY = 'restoration:repair-notes:v1:backup'

const SCOPES = ['batch', 'task']
const RECORD_KEYS = ['id', 'scope', 'refId', 'content', 'version', 'updatedAt']
const ENVELOPE_KEYS = ['schemaVersion', 'updatedAt', 'records']

export class NoteValidationError extends Error {
  constructor(message, code = 'NOTE_INVALID') {
    super(message)
    this.name = 'NoteValidationError'
    this.code = code
  }
}

export class NoteConflictError extends Error {
  constructor(message, currentVersion) {
    super(message)
    this.name = 'NoteConflictError'
    this.code = 'NOTE_VERSION_CONFLICT'
    this.currentVersion = currentVersion
  }
}

export function isValidIsoTimestamp(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !Number.isNaN(Date.parse(value))
  )
}

// 规范化内容：不允许空值 / 纯空白，最大 200 字符。
export function normalizeNoteContent(content) {
  if (typeof content !== 'string') {
    throw new NoteValidationError('备注内容必须是字符串。', 'NOTE_CONTENT_EMPTY')
  }
  const trimmed = content.trim()
  if (trimmed.length === 0) {
    throw new NoteValidationError('备注内容不能为空。', 'NOTE_CONTENT_EMPTY')
  }
  if (trimmed.length > NOTE_MAX_LENGTH) {
    throw new NoteValidationError(
      `备注内容不能超过 ${NOTE_MAX_LENGTH} 个字符。`,
      'NOTE_CONTENT_TOO_LONG',
    )
  }
  return trimmed
}

export function validateNoteRecord(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new NoteValidationError('备注记录必须是对象。')
  }
  const keys = Object.keys(record)
  if (keys.length !== RECORD_KEYS.length || RECORD_KEYS.some((key) => !(key in record))) {
    throw new NoteValidationError(`备注记录字段不完整：${keys.join(', ') || '(空)'}`)
  }
  if (typeof record.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.id)) {
    throw new NoteValidationError(`备注 id 非法：${String(record.id)}`)
  }
  if (!SCOPES.includes(record.scope)) {
    throw new NoteValidationError(`备注 scope 非法：${String(record.scope)}`)
  }
  if (typeof record.refId !== 'string' || record.refId.length === 0) {
    throw new NoteValidationError(`备注 refId 非法：${String(record.refId)}`)
  }
  normalizeNoteContent(record.content)
  if (
    typeof record.version !== 'number' ||
    !Number.isInteger(record.version) ||
    record.version < 1
  ) {
    throw new NoteValidationError(`备注版本号非法：${String(record.version)}`)
  }
  if (!isValidIsoTimestamp(record.updatedAt)) {
    throw new NoteValidationError(`备注更新时间非法：${String(record.updatedAt)}`)
  }
  return true
}

export function validateEnvelope(envelope) {
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new NoteValidationError('备注数据包必须是对象。')
  }
  const keys = Object.keys(envelope)
  if (keys.length !== ENVELOPE_KEYS.length || ENVELOPE_KEYS.some((key) => !(key in envelope))) {
    throw new NoteValidationError('备注数据包字段不完整。')
  }
  if (envelope.schemaVersion !== NOTE_SCHEMA_VERSION) {
    throw new NoteValidationError(
      `备注数据版本不受支持：${String(envelope.schemaVersion)}`,
    )
  }
  if (!isValidIsoTimestamp(envelope.updatedAt)) {
    throw new NoteValidationError('备注数据包更新时间非法。')
  }
  if (!Array.isArray(envelope.records)) {
    throw new NoteValidationError('备注记录必须是数组。')
  }
  const seen = new Set()
  for (const record of envelope.records) {
    validateNoteRecord(record)
    if (seen.has(record.id)) {
      throw new NoteValidationError(`备注 id 重复：${record.id}`)
    }
    seen.add(record.id)
  }
  return true
}

// 序列化 + 反序列化后的往返校验，确保真正落盘的内容可再次读取。
export function stableSerialize(envelope) {
  return JSON.stringify(envelope)
}

export function parseEnvelope(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new NoteValidationError('备注原始数据为空。')
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new NoteValidationError('备注原始数据不是合法 JSON。')
  }
  validateEnvelope(parsed)
  return parsed
}

export function buildSeedEnvelope() {
  const records = restorationSeedNotes.map((record) => ({ ...record }))
  validateEnvelope({
    schemaVersion: NOTE_SCHEMA_VERSION,
    updatedAt: records[0].updatedAt,
    records,
  })
  return {
    schemaVersion: NOTE_SCHEMA_VERSION,
    updatedAt: records[0].updatedAt,
    records,
  }
}

const knownRefIds = (() => {
  const ids = new Set()
  for (const id of Object.values(restorationNoteRefs.batches)) ids.add(id)
  for (const item of restorationNoteRefs.tasks) ids.add(item.id)
  return ids
})()

// 校验记录集合与示例数据描述的备注槽位一致：
// 不允许新增、缺失或替换备注记录，避免污染现有数据。
export function validateRecordSlots(envelope) {
  const ids = envelope.records.map((record) => record.id).sort()
  const expected = [...knownRefIds].sort()
  if (ids.length !== expected.length || ids.some((id, index) => id !== expected[index])) {
    throw new NoteValidationError('备注记录集合与内置槽位不一致。')
  }
  for (const record of envelope.records) {
    if (!knownRefIds.has(record.id)) {
      throw new NoteValidationError(`未知备注 id：${record.id}`)
    }
  }
  return true
}

// 浏览器 localStorage 适配；测试中可注入内存实现。
export function createBrowserStorage() {
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    return globalThis.localStorage
  }
  return null
}

export function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem(key, value) {
      map.set(key, String(value))
    },
    removeItem(key) {
      map.delete(key)
    },
    clear() {
      map.clear()
    },
    _dump: () => Object.fromEntries(map),
  }
}

export function createNoteStore(options = {}) {
  const storage = options.storage || createBrowserStorage()
  const seedEnvelope = options.seedEnvelope || buildSeedEnvelope()
  const clock = options.clock || (() => new Date().toISOString())
  const listeners = new Set()

  let envelope = null
  let report = null

  function persist(targetEnvelope) {
    // 无可用本地存储时仅更新内存副本（会话级降级）。
    if (!storage || !storageAvailable) {
      envelope = targetEnvelope
      report = { recovered: false, recoverySource: null, fallback: false }
      return
    }

    const primaryRaw = stableSerialize(targetEnvelope)
    const previousRaw = envelope ? stableSerialize(envelope) : null

    // 先写 backup（上一有效版本），再覆盖主副本。
    try {
      if (previousRaw !== null) {
        storage.setItem(STORAGE_BACKUP_KEY, previousRaw)
      } else {
        storage.removeItem(STORAGE_BACKUP_KEY)
      }
      storage.setItem(STORAGE_KEY, primaryRaw)
    } catch {
      // 写入中断（如配额不足）：尽力恢复主副本为上一有效版本。
      if (previousRaw !== null) {
        try {
          storage.setItem(STORAGE_KEY, previousRaw)
        } catch {
          /* 保留内存中的有效副本，拒绝本次写入 */
        }
      }
      throw new NoteValidationError('备注写入失败，已保留上一有效版本。', 'NOTE_WRITE_FAILED')
    }

    // 写入后重新读取确认，磁盘内容必须与预期逐字节一致。
    let readback = null
    try {
      readback = storage.getItem(STORAGE_KEY)
    } catch {
      readback = null
    }
    if (readback !== primaryRaw) {
      if (previousRaw !== null) {
        try {
          storage.setItem(STORAGE_KEY, previousRaw)
        } catch {
          /* 内存中仍持有上一有效副本 */
        }
      } else {
        try {
          storage.removeItem(STORAGE_KEY)
        } catch {
          /* ignore */
        }
      }
      throw new NoteValidationError('备注落盘校验失败，已回滚到上一有效版本。')
    }

    envelope = targetEnvelope
    report = {
      recovered: false,
      recoverySource: null,
      fallback: storageAvailable,
    }
  }

  let storageAvailable = Boolean(storage)

  function resetToSeed(source, options = {}) {
    const fresh = {
      schemaVersion: NOTE_SCHEMA_VERSION,
      updatedAt: seedEnvelope.updatedAt,
      records: seedEnvelope.records.map((record) => ({ ...record })),
    }
    if (storageAvailable) {
      try {
        storage.removeItem(STORAGE_BACKUP_KEY)
        storage.setItem(STORAGE_KEY, stableSerialize(fresh))
      } catch {
        storageAvailable = false
      }
    }
    envelope = fresh
    report = {
      recovered: options.recovered ?? true,
      recoverySource: options.recovered === false ? null : source,
      fallback: storageAvailable,
    }
  }

  // 可重复执行的启动 / 校验链路：
  // 主副本 -> backup 上一有效版本 -> 内置示例数据。
  function verify() {
    if (!storage) {
      storageAvailable = false
      envelope = {
        schemaVersion: NOTE_SCHEMA_VERSION,
        updatedAt: seedEnvelope.updatedAt,
        records: seedEnvelope.records.map((record) => ({ ...record })),
      }
      report = { recovered: false, recoverySource: null, fallback: false }
      return report
    }

    const primary = readCandidate(STORAGE_KEY)
    if (primary.ok) {
      envelope = primary.envelope
      report = { recovered: false, recoverySource: null, fallback: true }
      return report
    }

    const backup = readCandidate(STORAGE_BACKUP_KEY)
    if (backup.ok) {
      envelope = backup.envelope
      try {
        storage.setItem(STORAGE_KEY, stableSerialize(envelope))
      } catch {
        /* 内存中的有效副本仍可继续使用 */
      }
      report = { recovered: true, recoverySource: 'backup', fallback: true }
      return report
    }

    // 两个槽位都从未写入 => 首次启动播种（不算损坏恢复）；
    // 存在无法解析的内容 => 损坏后重置为内置示例数据。
    const hadData = primary.reason === 'invalid' || backup.reason === 'invalid'
    resetToSeed('seed', { recovered: hadData })
    return report
  }

  function readCandidate(key) {
    let raw = null
    try {
      raw = storage.getItem(key)
    } catch {
      return { ok: false, reason: 'invalid' }
    }
    if (raw === null) {
      return { ok: false, reason: 'missing' }
    }
    try {
      const candidate = parseEnvelope(raw)
      validateRecordSlots(candidate)
      return { ok: true, envelope: candidate }
    } catch {
      return { ok: false, reason: 'invalid' }
    }
  }

  function notify() {
    for (const listener of listeners) {
      try {
        listener(getSnapshot())
      } catch {
        /* 监听器异常不影响持久化状态 */
      }
    }
  }

  function list() {
    return envelope.records.map((record) => ({ ...record }))
  }

  function get(id) {
    const record = envelope.records.find((item) => item.id === id)
    return record ? { ...record } : null
  }

  function save(id, content, expectedVersion) {
    const record = envelope.records.find((item) => item.id === id)
    if (!record) {
      throw new NoteValidationError(`未知备注 id：${id}`, 'NOTE_NOT_FOUND')
    }

    // 冲突写入防护：调用方必须基于当前版本提交。
    if (
      expectedVersion !== undefined &&
      expectedVersion !== null &&
      Number(expectedVersion) !== record.version
    ) {
      throw new NoteConflictError(
        `备注已被其他操作更新（当前版本 v${record.version}），请刷新后重试。`,
        record.version,
      )
    }

    // 先在内存中构造并完整校验，校验不过则现有数据完全不动。
    const now = clock()
    if (!isValidIsoTimestamp(now)) {
      throw new NoteValidationError('系统时间非法，已拒绝写入。')
    }
    const nextRecord = {
      ...record,
      content: normalizeNoteContent(content),
      version: record.version + 1,
      updatedAt: now,
    }
    validateNoteRecord(nextRecord)

    const nextEnvelope = {
      schemaVersion: NOTE_SCHEMA_VERSION,
      updatedAt: now,
      records: envelope.records.map((item) => (item.id === id ? nextRecord : item)),
    }
    validateEnvelope(nextEnvelope)
    validateRecordSlots(nextEnvelope)
    stableSerialize(nextEnvelope)

    persist(nextEnvelope)
    notify()
    return { ...nextRecord }
  }

  function getSnapshot() {
    return {
      schemaVersion: envelope.schemaVersion,
      updatedAt: envelope.updatedAt,
      records: list(),
    }
  }

  function getReport() {
    return report ? { ...report } : null
  }

  function subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  verify()

  return {
    verify,
    list,
    get,
    save,
    getSnapshot,
    getReport,
    subscribe,
    storageKeys: { primary: STORAGE_KEY, backup: STORAGE_BACKUP_KEY },
  }
}
