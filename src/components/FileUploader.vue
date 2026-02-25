<template>
  <div class="file-uploader">
    <label for="dxf-file-input" class="file-input-label">
      <input
        id="dxf-file-input"
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
        <span>Load DXF File</span>
      </div>
    </label>
  </div>
</template>

<script setup lang="ts">
// Emits
interface Emits {
  (e: "file-selected", file: File): void;
}

const emit = defineEmits<Emits>();

const handleFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];

  if (file) {
    emit("file-selected", file);
  }
  // Сброс value чтобы повторный выбор того же файла вызывал change event
  target.value = "";
};
</script>

<style scoped>
.file-uploader {
  display: flex;
  flex-direction: column;
  gap: var(--dxf-vuer-spacing-sm, 8px);
  flex: 1;
  max-width: 420px;
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
  gap: var(--dxf-vuer-spacing-sm, 8px);
  padding: var(--dxf-vuer-spacing-sm, 8px) var(--dxf-vuer-spacing-md, 16px);
  background-color: rgba(255, 255, 255, 0.2);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: var(--dxf-vuer-border-radius, 4px);
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

@media (max-width: 768px) {
  .file-button {
    padding: var(--dxf-vuer-spacing-sm, 8px);
    justify-content: center;
  }
}
</style>
