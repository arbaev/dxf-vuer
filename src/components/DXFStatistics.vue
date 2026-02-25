<template>
  <div class="dxf-statistics">
    <h3 class="statistics-title">File Statistics</h3>

    <div class="statistics-grid">
      <!-- Основная информация -->
      <div class="stat-section">
        <h4>General</h4>
        <div class="stat-item">
          <span class="stat-label">File Size:</span>
          <span class="stat-value">{{ formatFileSize(statistics.fileSize) }}</span>
        </div>
        <div v-if="statistics.autocadVersion" class="stat-item">
          <span class="stat-label">AutoCAD Version:</span>
          <span class="stat-value">{{ statistics.autocadVersion }}</span>
        </div>
      </div>

      <!-- Статистика объектов -->
      <div class="stat-section">
        <h4>Entities</h4>
        <div class="stat-item">
          <span class="stat-label">Total Entities:</span>
          <span class="stat-value stat-value-highlight">{{ statistics.totalEntities }}</span>
        </div>
        <div
          v-for="(count, type) in sortedEntitiesByType"
          :key="type"
          class="stat-item entity-type"
        >
          <span class="stat-label">{{ type }}:</span>
          <span class="stat-value">{{ count }}</span>
        </div>
      </div>

      <!-- Дополнительная информация -->
      <div class="stat-section">
        <h4>Structure</h4>
        <div class="stat-item">
          <span class="stat-label">Layers:</span>
          <span class="stat-value">{{ statistics.layersCount }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Blocks:</span>
          <span class="stat-value">{{ statistics.blocksCount }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { DxfStatistics } from "@/types/dxf";

interface Props {
  statistics: DxfStatistics;
}

const props = defineProps<Props>();

// Форматируем размер файла
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

// Сортируем entities по количеству (от большего к меньшему)
const sortedEntitiesByType = computed(() => {
  const entries = Object.entries(props.statistics.entitiesByType);
  entries.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries);
});
</script>

<style scoped>
.dxf-statistics {
  background-color: var(--dxf-vuer-bg-color, #fafafa);
  border: 1px solid var(--dxf-vuer-border-color, #e0e0e0);
  border-radius: var(--dxf-vuer-border-radius, 4px);
  padding: var(--dxf-vuer-spacing-md, 16px);
  margin-top: var(--dxf-vuer-spacing-md, 16px);
}

.statistics-title {
  margin: 0 0 var(--dxf-vuer-spacing-md, 16px) 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--dxf-vuer-text-color, #212121);
}

.statistics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: var(--dxf-vuer-spacing-md, 16px);
}

.stat-section h4 {
  margin: 0 0 var(--dxf-vuer-spacing-sm, 8px) 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--dxf-vuer-text-secondary, #757575);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--dxf-vuer-border-color, #e0e0e0);
  padding-bottom: var(--dxf-vuer-spacing-xs, 4px);
}

.stat-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--dxf-vuer-spacing-xs, 4px) 0;
  font-size: 0.875rem;
}

.stat-item.entity-type {
  padding-left: var(--dxf-vuer-spacing-sm, 8px);
  font-size: 0.8125rem;
}

.stat-label {
  color: var(--dxf-vuer-text-secondary, #757575);
  font-weight: 500;
}

.stat-value {
  color: var(--dxf-vuer-text-color, #212121);
  font-weight: 600;
  font-family: "Courier New", monospace;
}

.stat-value-highlight {
  color: var(--dxf-vuer-primary-color, #1040b0);
  font-size: 1rem;
}

@media (max-width: 768px) {
  .statistics-grid {
    grid-template-columns: 1fr;
  }
}
</style>
