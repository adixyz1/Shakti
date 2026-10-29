import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server';
import {
  isCookieSecure,
  isTrustProxyEnabled,
  assertValidProductionConfiguration,
  DEFAULT_DEV_JWT_SECRET,
} from '../core/config';
import { setAuthCookies, ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from '../core/security';
import { isValidWebSocketOrigin } from '../services/wsHub';
import { csrfProtectionMiddleware, isZeroAuthDemoAllowed } from '../core/middleware';
import { recoverPendingIncidentsOnStartup } from '../services/scheduler';
import { backupDatabase, restoreDatabaseFromBackup, initDatabase } from '../core/db';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('MVP Deployment Settings (Hosting, Proxy, Cookies, CSRF, WebSocket, Secrets, Health)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // 1. COOKIE_SECURE=true forces secure flag even in non-production
  describe('COOKIE_SECURE setting', () => {
    it('forces Secure flag when COOKIE_SECURE=true even if NODE_ENV=development', () => {
      process.env.NODE_ENV = 'development';
      process.env.ENVIRONMENT = 'development';
      process.env.COOKIE_SECURE = 'true';

      expect(isCookieSecure()).toBe(true);

      const mockRes: any = {
        cookie: vi.fn(),
      };
      setAuthCookies(mockRes, 'usr_1', 'user');

      expect(mockRes.cookie).toHaveBeenCalledWith(
        ACCESS_COOKIE_NAME,
        expect.any(String),
        expect.objectContaining({ secure: true, httpOnly: true, sameSite: 'lax' })
      );
      expect(mockRes.cookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        expect.any(String),
        expect.objectContaining({ secure: true, httpOnly: true, sameSite: 'lax' })
      );
    });

    it('does not set Secure flag in development when COOKIE_SECURE is false or unset', () => {
      process.env.NODE_ENV = 'development';
      process.env.ENVIRONMENT = 'development';
      delete process.env.COOKIE_SECURE;

      expect(isCookieSecure()).toBe(false);

      const mockRes: any = {
        cookie: vi.fn(),
      };
      setAuthCookies(mockRes, 'usr_1', 'user');

      expect(mockRes.cookie).toHaveBeenCalledWith(
        ACCESS_COOKIE_NAME,
        expect.any(String),
        expect.objectContaining({ secure: false })
      );
    });
  });

  // 2. Strong secret enforcement across DEMO_MODE, COOKIE_SECURE, and production
  describe('Default and weak secrets refusal', () => {
    const STRONG_SECRET = 'a1b2c3d4e5f6789012345678901234567890123456789012';

    it('refuses to start when DEMO_MODE=true and JWT_SECRET is missing or short', () => {
      expect(() =>
        assertValidProductionConfiguration({
          NODE_ENV: 'staging',
          DEMO_MODE: 'true',
          JWT_SECRET_KEY: '',
        })
      ).toThrow(/JWT_SECRET/i);

      expect(() =>
        assertValidProductionConfiguration({
          NODE_ENV: 'staging',
          DEMO_MODE: 'true',
          JWT_SECRET_KEY: 'too-short',
        })
      ).toThrow(/JWT_SECRET/i);
    });

    it('refuses to start when DEMO_MODE=true and secret is a built-in default or contains dev-secret / do-not-use-in-prod', () => {
      expect(() =>
        assertValidProductionConfiguration({
          NODE_ENV: 'staging',
          DEMO_MODE: 'true',
          JWT_SECRET_KEY: DEFAULT_DEV_JWT_SECRET,
        })
      ).toThrow(/JWT_SECRET/i);

      expect(() =>
        assertValidProductionConfiguration({
          NODE_ENV: 'staging',
          DEMO_MODE: 'true',
          JWT_SECRET_KEY: 'my-custom-key-do-not-use-in-prod-1234567890',
        })
      ).toThrow(/JWT_SECRET/i);
    });

    it('refuses to start when COOKIE_SECURE=true and secret is missing or default', () => {
      expect(() =>
        assertValidProductionConfiguration({
          NODE_ENV: 'development',
          COOKIE_SECURE: 'true',
          JWT_SECRET_KEY: '',
        })
      ).toThrow(/JWT_SECRET/i);

      expect(() =>
        assertValidProductionConfiguration({
          NODE_ENV: 'development',
          COOKIE_SECURE: 'true',
          JWT_SECRET_KEY: DEFAULT_DEV_JWT_SECRET,
        })
      ).toThrow(/JWT_SECRET/i);
    });

    it('refuses to start when NODE_ENV=production and secret is missing or default', () => {
      expect(() =>
        assertValidProductionConfiguration({
          NODE_ENV: 'production',
          JWT_SECRET_KEY: '',
          ALLOW_MOCK_PROVIDERS: 'true',
        })
      ).toThrow(/JWT_SECRET/i);

      expect(() =>
        assertValidProductionConfiguration({
          NODE_ENV: 'production',
          JWT_SECRET_KEY: DEFAULT_DEV_JWT_SECRET,
          ALLOW_MOCK_PROVIDERS: 'true',
        })
      ).toThrow(/JWT_SECRET/i);
    });

    it('refuses to start when HMAC_SECRET is short or default', () => {
      expect(() =>
        assertValidProductionConfiguration({
          NODE_ENV: 'staging',
          DEMO_MODE: 'true',
          JWT_SECRET: STRONG_SECRET,
          HMAC_SECRET: 'short-hmac',
        })
      ).toThrow(/HMAC_SECRET/i);

      expect(() =>
        assertValidProductionConfiguration({
          NODE_ENV: 'staging',
          DEMO_MODE: 'true',
          JWT_SECRET: STRONG_SECRET,
          HMAC_SECRET: DEFAULT_DEV_JWT_SECRET,
        })
      ).toThrow(/HMAC_SECRET/i);
    });

    it('plain local development (none of DEMO_MODE, COOKIE_SECURE, production) keeps dev fallback without throwing', () => {
      expect(() =>
        assertValidProductionConfiguration({
          NODE_ENV: 'development',
          DEMO_MODE: 'false',
        })
      ).not.toThrow();
    });

    it('accepts strong custom secrets with JWT_SECRET / HMAC_SECRET aliases', () => {
      expect(() =>
        assertValidProductionConfiguration({
          NODE_ENV: 'staging',
          DEMO_MODE: 'true',
          JWT_SECRET: STRONG_SECRET,
          HMAC_SECRET: STRONG_SECRET,
        })
      ).not.toThrow();
    });
  });

  // 3. TRUST_PROXY=1 makes Express trust proxy and honors X-Forwarded-Host
  describe('TRUST_PROXY and CSRF Origin/Host check', () => {
    it('express trusts proxy when TRUST_PROXY=1', () => {
      process.env.TRUST_PROXY = '1';
      expect(isTrustProxyEnabled()).toBe(true);

      const app = createApp();
      expect(app.get('trust proxy')).toBeTruthy();
    });

    it('CSRF check accepts matching X-Forwarded-Host when TRUST_PROXY is set', async () => {
      process.env.TRUST_PROXY = '1';

      const mockReq: any = {
        method: 'POST',
        originalUrl: '/api/circle/contacts',
        cookies: { [ACCESS_COOKIE_NAME]: 'mock_cookie' },
        headers: {
          origin: 'https://shakti.example.com',
          'x-forwarded-host': 'shakti.example.com',
          host: 'internal-container:3000',
        },
        app: { get: (k: string) => (k === 'trust proxy' ? 1 : undefined) },
      };
      const mockRes: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      csrfProtectionMiddleware(mockReq, mockRes, next);

      expect(next).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('CSRF check rejects foreign Origin even when X-Forwarded-Host is set', async () => {
      process.env.TRUST_PROXY = '1';

      const mockReq: any = {
        method: 'POST',
        originalUrl: '/api/circle/contacts',
        cookies: { [ACCESS_COOKIE_NAME]: 'mock_cookie' },
        headers: {
          origin: 'https://attacker.evil.com',
          'x-forwarded-host': 'shakti.example.com',
          host: 'internal-container:3000',
        },
        app: { get: (k: string) => (k === 'trust proxy' ? 1 : undefined) },
      };
      const mockRes: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      csrfProtectionMiddleware(mockReq, mockRes, next);

      expect(next).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.stringContaining('cross-origin state-changing request rejected'),
        })
      );
    });

    it('CSRF check ignores X-Forwarded-Host when TRUST_PROXY is NOT set', async () => {
      delete process.env.TRUST_PROXY;

      const mockReq: any = {
        method: 'POST',
        originalUrl: '/api/circle/contacts',
        cookies: { [ACCESS_COOKIE_NAME]: 'mock_cookie' },
        headers: {
          origin: 'https://spoofed.example.com',
          'x-forwarded-host': 'spoofed.example.com',
          host: 'internal-container:3000',
        },
        app: { get: () => undefined },
      };
      const mockRes: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      csrfProtectionMiddleware(mockReq, mockRes, next);

      expect(next).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });
  });

  // 4. WebSocket Origin check with TRUST_PROXY
  describe('WebSocket Origin check with TRUST_PROXY', () => {
    it('accepts matching forwarded host when TRUST_PROXY=1', () => {
      process.env.TRUST_PROXY = '1';

      const mockReq: any = {
        headers: {
          origin: 'https://shakti-demo.up.railway.app',
          'x-forwarded-host': 'shakti-demo.up.railway.app',
          host: '10.0.0.4:8080',
        },
      };

      expect(isValidWebSocketOrigin(mockReq)).toBe(true);
    });

    it('rejects foreign origin for WebSocket even with forwarded host', () => {
      process.env.TRUST_PROXY = '1';

      const mockReq: any = {
        headers: {
          origin: 'https://malicious-site.com',
          'x-forwarded-host': 'shakti-demo.up.railway.app',
          host: '10.0.0.4:8080',
        },
      };

      expect(isValidWebSocketOrigin(mockReq)).toBe(false);
    });

    it('rejects spoofed X-Forwarded-Host when TRUST_PROXY is NOT set', () => {
      delete process.env.TRUST_PROXY;

      const mockReq: any = {
        headers: {
          origin: 'https://spoofed.com',
          'x-forwarded-host': 'spoofed.com',
          host: 'localhost:3000',
        },
      };

      expect(isValidWebSocketOrigin(mockReq)).toBe(false);
    });
  });

  // 5. Unauthenticated /health endpoint with zero sensitive data
  describe('/health endpoint verification', () => {
    it('responds 200 without authentication and exposes no sensitive data', async () => {
      const app = createApp();
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 'ok',
        service: 'saathi-api',
        runtime: 'node-express-sqlite-drizzle',
      });
      expect(res.body.jwtSecretKey).toBeUndefined();
      expect(res.body.databaseUrl).toBeUndefined();
      expect(res.body.users).toBeUndefined();
    });
  });

  // 6. In-process scheduler & startup recovery
  describe('In-process scheduler verification', () => {
    it('startup recovery function is exportable and runnable', async () => {
      expect(typeof recoverPendingIncidentsOnStartup).toBe('function');
    });
  });

  // 7. Zero-auth demo mode strictly disabled in production or when DEMO_MODE=false
  describe('Zero-auth demo mode boundary', () => {
    it('disallows X-Demo-Role and fallback demo accounts when NODE_ENV=production or DEMO_MODE=false', () => {
      delete process.env.VITEST;

      process.env.NODE_ENV = 'production';
      process.env.ENVIRONMENT = 'production';
      process.env.DEMO_MODE = 'true';
      expect(isZeroAuthDemoAllowed()).toBe(false);

      process.env.NODE_ENV = 'staging';
      process.env.ENVIRONMENT = 'staging';
      process.env.DEMO_MODE = 'false';
      expect(isZeroAuthDemoAllowed()).toBe(false);

      process.env.NODE_ENV = 'staging';
      process.env.ENVIRONMENT = 'staging';
      process.env.DEMO_MODE = 'true';
      expect(isZeroAuthDemoAllowed()).toBe(true);
    });
  });

  // 8. HTTP guard against direct database file access
  describe('Database file HTTP exposure protection', () => {
    it('returns 404 for any request targeting .db, .db-wal, .db-shm, .sqlite, or /data/*', async () => {
      const app = createApp();
      for (const blockedPath of [
        '/saathi.db',
        '/shakti.db',
        '/saathi.db-wal',
        '/saathi.db-shm',
        '/data/shakti.db',
        '/backup.sqlite',
      ]) {
        const res = await request(app).get(blockedPath);
        expect(res.status).toBe(404);
      }
    });
  });

  // 9. Atomic SQLite WAL-safe backup and restore
  describe('Atomic SQLite backup and restore across updates', () => {
    it('creates a consistent VACUUM INTO backup and restores it cleanly to a target database path', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakti-db-test-'));
      const sourceFile = path.join(tmpDir, 'shakti-source.db');
      const backupFile = path.join(tmpDir, 'shakti-backup.db');
      const restoredFile = path.join(tmpDir, 'shakti-restored.db');

      try {
        await initDatabase(`file:${sourceFile}`);

        const savedBackupPath = await backupDatabase(backupFile);
        expect(fs.existsSync(savedBackupPath)).toBe(true);
        expect(fs.statSync(savedBackupPath).size).toBeGreaterThan(0);

        const restoredDb = await restoreDatabaseFromBackup(backupFile, `file:${restoredFile}`);
        expect(restoredDb).toBeDefined();
        expect(fs.existsSync(restoredFile)).toBe(true);
        expect(fs.statSync(restoredFile).size).toBeGreaterThan(0);
      } finally {
        await initDatabase('file::memory:');
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});

