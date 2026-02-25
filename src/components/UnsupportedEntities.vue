<template>
  <div v-if="entities.length > 0" class="unsupported-entities">
    <div class="warning-header">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path
          d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
        />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span class="warning-title">Unsupported Elements ({{ entities.length }})</span>
      <button class="toggle-button" @click="isExpanded = !isExpanded">
        {{ isExpanded ? "Hide" : "Show" }}
      </button>
    </div>

    <transition name="expand">
      <div v-if="isExpanded" class="entities-list">
        <div v-for="(entity, index) in entities" :key="index" class="entity-item">
          <span class="entity-bullet">&#8226;</span>
          <span class="entity-text">{{ entity }}</span>
        </div>
      </div>
    </transition>

    <div class="warning-footer">
      <span class="warning-note">
        &#8505;&#65039; These elements will not be displayed on the drawing
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

interface Props {
  entities: string[];
}

defineProps<Props>();

const isExpanded = ref(true);
</script>

<style scoped>
.unsupported-entities {
  background-color: #fff3cd;
  border: 2px solid #ffc107;
  border-radius: var(--dxf-vuer-border-radius, 4px);
  padding: var(--dxf-vuer-spacing-md, 16px);
  margin: var(--dxf-vuer-spacing-md, 16px);
}

.warning-header {
  display: flex;
  align-items: center;
  gap: var(--dxf-vuer-spacing-sm, 8px);
  margin-bottom: var(--dxf-vuer-spacing-sm, 8px);
}

.warning-header svg {
  flex-shrink: 0;
  color: #ff9800;
}

.warning-title {
  flex: 1;
  font-weight: 600;
  color: #856404;
  font-size: 14px;
}

.toggle-button {
  padding: 4px 12px;
  font-size: 12px;
  background-color: white;
  border: 1px solid #ffc107;
  border-radius: var(--dxf-vuer-border-radius, 4px);
  color: #856404;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.toggle-button:hover {
  background-color: #ffc107;
  color: white;
}

.entities-list {
  max-height: 200px;
  overflow-y: auto;
  margin-top: var(--dxf-vuer-spacing-sm, 8px);
  padding: var(--dxf-vuer-spacing-sm, 8px);
  background-color: white;
  border-radius: var(--dxf-vuer-border-radius, 4px);
  border: 1px solid #ffc107;
}

.entity-item {
  display: flex;
  align-items: flex-start;
  gap: var(--dxf-vuer-spacing-sm, 8px);
  padding: 4px 0;
  font-size: 13px;
  color: #856404;
}

.entity-bullet {
  flex-shrink: 0;
  font-weight: bold;
}

.entity-text {
  flex: 1;
  word-break: break-word;
}

.warning-footer {
  margin-top: var(--dxf-vuer-spacing-sm, 8px);
  padding-top: var(--dxf-vuer-spacing-sm, 8px);
  border-top: 1px solid #ffc107;
}

.warning-note {
  font-size: 12px;
  color: #856404;
  font-style: italic;
}

.expand-enter-active,
.expand-leave-active {
  transition: all 0.3s ease;
  max-height: 200px;
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  max-height: 0;
  opacity: 0;
}

.entities-list::-webkit-scrollbar {
  width: 6px;
}

.entities-list::-webkit-scrollbar-track {
  background: #fff3cd;
  border-radius: 3px;
}

.entities-list::-webkit-scrollbar-thumb {
  background: #ffc107;
  border-radius: 3px;
}

.entities-list::-webkit-scrollbar-thumb:hover {
  background: #ff9800;
}

@media (max-width: 768px) {
  .unsupported-entities {
    padding: var(--dxf-vuer-spacing-sm, 8px);
    margin: var(--dxf-vuer-spacing-sm, 8px);
  }

  .warning-title {
    font-size: 13px;
  }

  .entity-item {
    font-size: 12px;
  }

  .entities-list {
    max-height: 150px;
  }
}
</style>
