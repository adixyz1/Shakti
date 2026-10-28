// Ensure dev server runs in demo mode with port 3000 in development (AI Studio requirement)
if (process.env.NODE_ENV !== 'production') {
  if (!process.env.PORT || process.env.PORT === '8080') {
    process.env.PORT = '3000';
  }
  if (!process.env.DEMO_MODE) {
    process.env.DEMO_MODE = 'true';
  }
  if (!process.env.DEMO_ADMIN_HINT) {
    process.env.DEMO_ADMIN_HINT = 'true';
  }
  const defaultInsecure = 'saathi-dev-secret-key-change-in-production';
  if (
    !process.env.JWT_SECRET_KEY ||
    process.env.JWT_SECRET_KEY === defaultInsecure ||
    process.env.JWT_SECRET_KEY.includes('dev-secret')
  ) {
    process.env.JWT_SECRET_KEY =
      'saathi-runtime-preview-jwt-secret-key-64chars-long-secure-random';
  }
  if (
    !process.env.HMAC_SECRET_KEY ||
    process.env.HMAC_SECRET_KEY === defaultInsecure ||
    process.env.HMAC_SECRET_KEY.includes('dev-secret')
  ) {
    process.env.HMAC_SECRET_KEY =
      'saathi-runtime-preview-hmac-secret-key-64chars-long-secure-random';
  }
}

if (process.env.VITEST !== 'true') {
  const { startServer } = await import('./apps/api/server');
  startServer().catch((err) => {
    console.error('Failed to start SAATHI server:', err);
    process.exit(1);
  });
}
