<script setup>
import PanelSection from '../components/common/PanelSection.vue'
import BatchGrid from '../components/restoration/BatchGrid.vue'
import { useRepairNotes } from '../composables/useRepairNotes'

const { batches } = useRepairNotes()
</script>

<template>
  <div class="view-stack">
    <PanelSection title="批次档案" badge="修复对象">
      <BatchGrid :items="batches" />
    </PanelSection>
  </div>
</template>

<style scoped>
.view-stack {
  display: grid;
}
</style>
