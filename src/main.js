import { createApp } from 'vue'

import App from './App.vue'
import router from './router'
import {
  restorationBatches,
  restorationTasks,
} from './data/restorationData'
import {
  hydrateRestorationNotes,
  verifyRestorationNotes,
} from './composables/useRestorationNotes'
import './style.css'

// 先加载本地持久化备注并做一次完整性校验，再挂载工作台，
// 保证开发服务器重启或重新打开工作台后仍读到上一有效版本。
hydrateRestorationNotes(restorationBatches, restorationTasks)
try {
  verifyRestorationNotes()
} catch {
  // 极端情况下存储完全不可用时，应用仍使用内存数据继续运行
}

createApp(App).use(router).mount('#app')
