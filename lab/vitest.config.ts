import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['lab/regression.test.ts'], testTimeout: 20_000 } });
