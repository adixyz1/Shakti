import { startServer } from './apps/api/server';

if (process.env.VITEST !== 'true') {
  startServer().catch((err) => {
    console.error('Failed to start SAATHI server:', err);
    process.exit(1);
  });
}
