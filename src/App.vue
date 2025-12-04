<template>
  <div class="app">
    <header class="app-header">
      <h1>DXF Vuer</h1>
      <p>Просмотрщик DXF файлов</p>
    </header>

    <main class="app-main">
      <div class="placeholder">
        <div class="placeholder-icon">📐</div>
        <h2>Canvas</h2>
        <p>Будет здесь</p>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-header {
  background-color: var(--primary-color);
  color: white;
  padding: var(--spacing-lg);
  text-align: center;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.app-header h1 {
  margin: 0;
  font-size: 2rem;
  font-weight: 600;
}

.app-header p {
  margin: var(--spacing-sm) 0 0;
  opacity: 0.9;
  font-size: 1rem;
}

.app-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-lg);
}

.placeholder {
  text-align: center;
  max-width: 500px;
}

.placeholder-icon {
  font-size: 6rem;
  margin-bottom: var(--spacing-md);
}

.placeholder h2 {
  color: var(--text-color);
  margin-bottom: var(--spacing-sm);
}

.placeholder p {
  color: var(--text-secondary);
  font-size: 1.1rem;
}

@media (max-width: 768px) {
  .app-header h1 {
    font-size: 1.5rem;
  }

  .placeholder-icon {
    font-size: 4rem;
  }
}
</style>
