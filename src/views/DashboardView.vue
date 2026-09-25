<script setup>
import PanelSection from '../components/common/PanelSection.vue'
import StatCard from '../components/common/StatCard.vue'
import BatchGrid from '../components/restoration/BatchGrid.vue'
import EnvironmentCards from '../components/restoration/EnvironmentCards.vue'
import HeroBanner from '../components/restoration/HeroBanner.vue'
import {
  restorationEnvironment,
  restorationHero,
  restorationSteps,
} from '../data/restorationData'
import { useRestorationOverview } from '../composables/useRestorationOverview'
import { useRepairNotes } from '../composables/useRepairNotes'

const { batchCount, environmentCount, highRiskCount, ownerCount } =
  useRestorationOverview()
const { batches } = useRepairNotes()

const statCards = [
  { label: '在册批次', value: batchCount.value },
  { label: '高风险任务', value: highRiskCount.value },
  { label: '环境指标', value: environmentCount.value },
  { label: '参与修复师', value: ownerCount.value },
]
</script>

<template>
  <div class="view-stack">
    <HeroBanner :hero="restorationHero" />

    <section class="stats-grid">
      <StatCard
        v-for="card in statCards"
        :key="card.label"
        :label="card.label"
        :value="card.value"
      />
    </section>

    <section class="two-column">
      <PanelSection title="重点批次" badge="优先处理">
        <BatchGrid :items="batches" />
      </PanelSection>

      <PanelSection title="当日工序" badge="修复流程">
        <ol class="step-list">
          <li v-for="step in restorationSteps" :key="step">{{ step }}</li>
        </ol>
      </PanelSection>
    </section>

    <PanelSection title="环境参数" badge="修复室 2">
      <EnvironmentCards :items="restorationEnvironment" />
    </PanelSection>
  </div>
</template>

<style scoped>
.view-stack {
  display: grid;
  gap: 24px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.two-column {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr;
  gap: 24px;
}

.step-list {
  margin: 0;
  padding-left: 20px;
  color: #5c4a33;
}

.step-list li + li {
  margin-top: 12px;
}

@media (max-width: 980px) {
  .stats-grid,
  .two-column {
    grid-template-columns: 1fr;
  }
}
</style>
