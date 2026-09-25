// 修复备注的本地持久化数据定义。
// 备注记录独立于批次/任务业务字段，仅通过 refs 建立关联。

export const NOTE_SCHEMA_VERSION = 1
export const NOTE_MAX_LENGTH = 200

// 备注记录与业务对象的关联关系（业务数据本身不增加任何字段）。
export const restorationNoteRefs = {
  batches: {
    'A-03': 'batch-a-03',
    'B-11': 'batch-b-11',
    'C-02': 'batch-c-02',
  },
  tasks: [
    { id: 'task-01', title: '明抄本县志残卷', owner: '韩澈' },
    { id: 'task-02', title: '碑帖拓片册页', owner: '陆宁' },
    { id: 'task-03', title: '戏曲抄本散页', owner: '周恬' },
  ],
}

// 最小示例数据：内容与 restorationData.js 中的备注保持一致，
// 因此首次写入不会改变页面上的备注展示。
export const restorationSeedNotes = [
  {
    id: 'batch-a-03',
    scope: 'batch',
    refId: 'A-03',
    content: '虫道集中在装订线外沿。',
    version: 1,
    updatedAt: '2026-09-01T09:00:00.000Z',
  },
  {
    id: 'batch-b-11',
    scope: 'batch',
    refId: 'B-11',
    content: '需先降湿 48 小时，再进入纤维加固。',
    version: 1,
    updatedAt: '2026-09-01T09:00:00.000Z',
  },
  {
    id: 'batch-c-02',
    scope: 'batch',
    refId: 'C-02',
    content: '边角缺损明显，建议先做透明托裱。',
    version: 1,
    updatedAt: '2026-09-01T09:00:00.000Z',
  },
  {
    id: 'task-01',
    scope: 'task',
    refId: 'task-01',
    content: '虫道贯穿标题栏，需先固色。',
    version: 1,
    updatedAt: '2026-09-01T09:00:00.000Z',
  },
  {
    id: 'task-02',
    scope: 'task',
    refId: 'task-02',
    content: '边缘卷曲，可延后压平。',
    version: 1,
    updatedAt: '2026-09-01T09:00:00.000Z',
  },
  {
    id: 'task-03',
    scope: 'task',
    refId: 'task-03',
    content: '等待封套尺寸确认。',
    version: 1,
    updatedAt: '2026-09-01T09:00:00.000Z',
  },
]
