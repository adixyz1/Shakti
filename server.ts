import { startServer } from './apps/api/server';

// Ensure dev server listens on port 3000 in development (AI Studio requirement)
if (process.env.NODE_ENV !== 'production' && (!process.env.PORT || process.env.PORT === '8080')) {
  process.env.PORT = '3000';
}

if (process.env.VITEST !== 'true') {
  startServer().catch((err) => {
    console.error('Failed to start SAATHI server:', err);
    process.exit(1);
  });
}
