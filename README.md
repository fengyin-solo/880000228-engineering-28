# solo-8800002

一个基于 Vite + Vue 3 的纯前端小众业务示例项目，主题是古籍虫蛀修复批次管理。

## 开发

```bash
npm install
npm run dev
```

`vite.config.js` 已显式配置 `server.open = false`，启动开发服务时不会自动打开浏览器。

## 构建

```bash
npm run build
```

构建会先执行备注持久化链路的本地校验（`npm run verify:notes`），再打包产物。

## 修复备注的本地持久化

备注在工作台本地通过 `localStorage` 持久化，相关模块：

- `src/utils/noteStore.js`：持久化内核。每条记录带 `revision`（乐观版本号）与
  `updatedAt`（ISO 更新时间），整份快照带 `schemaVersion`。
- `src/data/restorationNoteSeeds.js`：由现有批次/任务数据派生的最小示例数据，
  作为首次初始化与损坏兜底的基线版本。
- `src/composables/useRestorationNotes.js`：应用门面，挂载前由 `src/main.js`
  调用 `hydrateRestorationNotes` 回填备注（只覆盖 `note` 字段，不改业务字段与展示）。

存储采用“主记录 + 上一有效版本备份”双份结构：

- 空值、纯空白、超过 500 字符或未登记 id 的写入会被拒绝，不会落盘；
- 保存时必须带读取到的 `revision`，版本不一致按冲突处理，后写不覆盖先写；
- 主记录 JSON 损坏或内容非法时，自动回退到备份；备份也不可用时回退到种子基线，
  并把有效版本重新写入双份存储；
- 主记录写入失败（如配额超限）时备份保持不变，重启后仍读到上一有效版本；
- `verify()`（`npm run verify:notes`）为可重复执行的幂等校验，对健康存储
  连续执行不会产生额外写入。

