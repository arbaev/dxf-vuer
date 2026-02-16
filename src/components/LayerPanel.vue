<template>
  <div class="layer-panel" :class="{ collapsed: !isExpanded }">
    <div class="layer-panel-header" @click="isExpanded = !isExpanded">
      <span class="layer-panel-title">Layers ({{ layers.length }})</span>
      <button class="collapse-btn" :title="isExpanded ? 'Collapse' : 'Expand'">
        {{ isExpanded ? '−' : '+' }}
      </button>
    </div>

    <div v-if="isExpanded" class="layer-panel-body">
      <div class="layer-panel-actions">
        <button @click.stop="$emit('show-all')" class="action-btn">All</button>
        <button @click.stop="$emit('hide-all')" class="action-btn">None</button>
      </div>

      <div class="layer-list">
        <div
          v-for="layer in layers"
          :key="layer.name"
          class="layer-item"
          :class="{ hidden: !layer.visible, frozen: layer.frozen }"
          @click="!layer.frozen && $emit('toggle-layer', layer.name)"
        >
          <!-- Иконка глаза -->
          <svg
            v-if="layer.visible"
            class="eye-icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <svg
            v-else
            class="eye-icon off"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>

          <!-- Цветовой индикатор -->
          <span class="color-swatch" :style="{ backgroundColor: layer.color }"></span>

          <!-- Имя слоя -->
          <span class="layer-name" :title="layer.name">{{ layer.name }}</span>

          <!-- Количество entity -->
          <span class="layer-count">{{ layer.entityCount }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { LayerState } from "@/composables/dxf/useLayers";

interface Props {
  layers: LayerState[];
}

defineProps<Props>();

defineEmits<{
  (e: "toggle-layer", layerName: string): void;
  (e: "show-all"): void;
  (e: "hide-all"): void;
}>();

const isExpanded = ref(true);
</script>

<style scoped>
.layer-panel {
  position: absolute;
  bottom: var(--spacing-sm);
  left: var(--spacing-sm);
  z-index: 10;
  background-color: rgba(255, 255, 255, 0.95);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  max-height: 50%;
  display: flex;
  flex-direction: column;
  min-width: 180px;
  max-width: 260px;
}

.layer-panel.collapsed {
  max-height: none;
}

.layer-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.collapsed .layer-panel-header {
  border-bottom: none;
}

.layer-panel-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-color);
}

.collapse-btn {
  background: none;
  border: none;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 0 4px;
  line-height: 1;
}

.layer-panel-body {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.layer-panel-actions {
  display: flex;
  gap: 4px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.action-btn {
  padding: 2px 8px;
  font-size: 11px;
  background: none;
  border: 1px solid var(--border-color);
  border-radius: 3px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.15s;
}

.action-btn:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.layer-list {
  overflow-y: auto;
  max-height: 300px;
  padding: 2px 0;
}

.layer-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  cursor: pointer;
  transition: background-color 0.15s;
  font-size: 12px;
}

.layer-item:hover {
  background-color: rgba(0, 0, 0, 0.04);
}

.layer-item.hidden {
  opacity: 0.5;
}

.layer-item.frozen {
  opacity: 0.35;
  cursor: not-allowed;
}

.eye-icon {
  flex-shrink: 0;
  color: var(--text-color);
}

.eye-icon.off {
  color: var(--text-secondary);
}

.color-swatch {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  border: 1px solid rgba(0, 0, 0, 0.15);
}

.layer-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-color);
}

.layer-count {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-secondary);
}

@media (max-width: 768px) {
  .layer-panel {
    min-width: 150px;
    max-width: 200px;
    max-height: 40%;
  }

  .layer-list {
    max-height: 200px;
  }
}
</style>
