<script setup>
import PanelSection from '../components/common/PanelSection.vue'
import TaskTable from '../components/restoration/TaskTable.vue'
import RepairNotePanel from '../components/restoration/RepairNotePanel.vue'
import { useRepairNotes } from '../composables/useRepairNotes'

const { tasks } = useRepairNotes()
</script>

<template>
  <div class="view-stack">
    <PanelSection title="任务清单" badge="按风险排序">
      <TaskTable :rows="tasks" />
    </PanelSection>

    <PanelSection title="修复备注记录" badge="本地持久化">
      <RepairNotePanel />
    </PanelSection>
  </div>
</template>

<style scoped>
.view-stack {
  display: grid;
  gap: 24px;
}
</style>
