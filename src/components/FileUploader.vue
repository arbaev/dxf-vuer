<template>
  <div class="file-uploader">
    <label for="dxf-file-input" class="file-input-label">
      <input
        id="dxf-file-input"
        ref="fileInput"
        type="file"
        accept=".dxf"
        class="file-input"
        @change="handleFileChange"
      />
      <div class="file-button">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span>Выбрать DXF файл</span>
      </div>
    </label>

    <div v-if="fileName" class="file-info">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <polyline points="13 2 13 9 20 9" />
      </svg>
      <span class="file-name">{{ fileName }}</span>
      <button class="clear-button" @click="clearFile" title="Очистить">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

// Emits
interface Emits {
  (e: "file-selected", file: File): void;
  (e: "file-cleared"): void;
}

const emit = defineEmits<Emits>();

const fileInput = ref<HTMLInputElement | null>(null);
const fileName = ref<string>("");

const handleFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];

  if (file) {
    fileName.value = file.name;
    emit("file-selected", file);
  }
};

const clearFile = () => {
  if (fileInput.value) {
    fileInput.value.value = "";
  }
  fileName.value = "";
  emit("file-cleared");
};
</script>

<style scoped>
.file-uploader {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  flex: 1;
  max-width: 600px;
}

.file-input {
  display: none;
}

.file-input-label {
  cursor: pointer;
}

.file-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  background-color: rgba(255, 255, 255, 0.2);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: var(--border-radius);
  font-weight: 500;
  font-size: 14px;
  transition: all 0.2s;
  user-select: none;
  backdrop-filter: blur(10px);
}

.file-button:hover {
  background-color: rgba(255, 255, 255, 0.3);
  border-color: rgba(255, 255, 255, 0.5);
}

.file-button:active {
  transform: scale(0.98);
}

.file-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  background-color: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: var(--border-radius);
  color: var(--text-color);
}

.file-info svg {
  flex-shrink: 0;
  color: var(--primary-color);
}

.file-name {
  flex: 1;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clear-button {
  padding: 4px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--border-radius);
  transition: all 0.2s;
}

.clear-button:hover {
  background-color: var(--border-color);
  color: var(--error-color);
}

@media (max-width: 768px) {
  .file-button span {
    display: none;
  }

  .file-button {
    padding: var(--spacing-sm);
    justify-content: center;
  }

  .file-name {
    font-size: 12px;
  }

  .file-info {
    padding: 6px var(--spacing-sm);
  }
}
</style>
