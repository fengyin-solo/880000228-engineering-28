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

构建前会自动执行 `prebuild`（即 `npm run test:notes`），对修复备注的本地持久化链路做可重复执行的校验；校验失败会中断构建。

## 修复备注的本地持久化

任务清单页的「修复备注记录」面板基于 `localStorage` 持久化，工作台重启或重新打开后仍可读取：

- 每条备注带 `version`（单调递增）与 `updatedAt`（ISO 时间）；
- 主副本 `restoration:repair-notes:v1` + 上一有效版本副本 `…:backup`，主副本损坏时自动回退，两个副本都损坏时重置为内置示例数据；
- 空值、纯空白与超过 200 字的内容会被拒绝；未知备注 id、重复 id、错误版本号等结构异常同样不会落盘；
- 写入采用乐观版本控制，版本不匹配（如其他标签页已更新）会抛出冲突错误，界面会重新加载上一有效版本；
- 写入先在内存中校验，再落盘并重新读取逐字节确认，任何失败都会回滚，不会污染现有数据。

相关文件：

- `src/data/restorationNotes.js`：版本与长度常量、最小示例数据（内容与静态业务数据一致）；
- `src/services/noteStore.js`：框架无关的持久化与校验核心；
- `src/composables/useRepairNotes.js`：Vue 响应式单例与跨标签页同步；
- `scripts/verify-notes.mjs`：构建校验（Node 内置 test runner，无额外依赖）。
