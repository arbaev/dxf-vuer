<template>
  <div class="view-controls">
    <button class="control-button" @click="$emit('reset-view')" title="Reset View">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
      <span>Reset View</span>
    </button>
  </div>
</template>

<script setup lang="ts">
// Emits
interface Emits {
  (e: "reset-view"): void;
}

defineEmits<Emits>();
</script>

<style scoped>
.view-controls {
  display: flex;
  justify-content: center;
  padding: var(--spacing-md);
  gap: var(--spacing-sm);
}

.control-button {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  background-color: white;
  color: var(--text-color);
  border: 2px solid var(--border-color);
  border-radius: var(--border-radius);
  font-weight: 500;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.control-button:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.control-button:active {
  transform: translateY(0);
}

.control-button svg {
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .control-button span {
    display: none;
  }

  .control-button {
    padding: var(--spacing-sm);
    border-radius: 50%;
    width: 40px;
    height: 40px;
    justify-content: center;
  }
}
</style>
