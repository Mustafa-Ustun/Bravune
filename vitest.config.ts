import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/**/*.test.ts', 'functions/**/*.test.js'],
    exclude: ['**/node_modules/**', '**/dist/**']
  }
});
