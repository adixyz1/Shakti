import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server';
import { closeDatabase, initDatabase } from '../core/db';
import { seedDatabase } from '../core/seed';

describe('Hosted-Demo Login OTP Hint Security & Behavior', () => {
  let tempDbPath: string;
  let app: ReturnType<typeof createApp>;
  const origDemoMode = process.env.DEMO_MODE;
  const origAdminHint = process.env.DEMO_ADMIN_HINT;
  const origNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    tempDbPath = path.join(os.tmpdir(), `saathi-demo-login-${Date.now()}.db`);
    const db = await initDatabase(`file:${tempDbPath}`);
    await seedDatabase(db);
    app = createApp();
  });

  afterAll(async () => {
    if (origDemoMode === undefined) {
      delete process.env.DEMO_MODE;
    } else {
      process.env.DEMO_MODE = origDemoMode;
    }
    if (origAdminHint === undefined) {
      delete process.env.DEMO_ADMIN_HINT;
    } else {
      process.env.DEMO_ADMIN_HINT = origAdminHint;
    }
    if (origNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = origNodeEnv;
    }
    await closeDatabase();
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
  });

  it('hint absent when DEMO_MODE is off in development', async () => {
    delete process.env.DEMO_MODE;
    delete process.env.DEMO_ADMIN_HINT;
    process.env.NODE_ENV = 'development';

    const res = await request(app)
      .post('/api/auth/otp/request')
      .send({ phone_e164: '+919000000001' });

    expect(res.status).toBe(200);
    expect(res.body.dev_mock_hint).toBeUndefined();
    expect('dev_mock_hint' in res.body).toBe(false);
  });

  it('present for a demo user when DEMO_MODE=true', async () => {
    process.env.DEMO_MODE = 'true';
    delete process.env.DEMO_ADMIN_HINT;
    process.env.NODE_ENV = 'development';

    const res = await request(app)
      .post('/api/auth/otp/request')
      .send({ phone_e164: '+919000000001' });

    expect(res.status).toBe(200);
    expect(res.body.dev_mock_hint).toMatch(/^\d{6}$/);

    // Also present for demo responder and contacts
    const respRes = await request(app)
      .post('/api/auth/otp/request')
      .send({ phone_e164: '+919000000002' });
    expect(respRes.status).toBe(200);
    expect(respRes.body.dev_mock_hint).toMatch(/^\d{6}$/);

    const contactRes = await request(app)
      .post('/api/auth/otp/request')
      .send({ phone_e164: '+919000000011' });
    expect(contactRes.status).toBe(200);
    expect(contactRes.body.dev_mock_hint).toMatch(/^\d{6}$/);
  });

  it('absent for the admin when DEMO_ADMIN_HINT is not set', async () => {
    process.env.DEMO_MODE = 'true';
    delete process.env.DEMO_ADMIN_HINT;
    process.env.NODE_ENV = 'development';

    const res = await request(app)
      .post('/api/auth/otp/request')
      .send({ phone_e164: '+919000000003' });

    expect(res.status).toBe(200);
    expect(res.body.dev_mock_hint).toBeUndefined();
    expect('dev_mock_hint' in res.body).toBe(false);
  });

  it('present for the admin when DEMO_ADMIN_HINT=true is set explicitly', async () => {
    process.env.DEMO_MODE = 'true';
    process.env.DEMO_ADMIN_HINT = 'true';
    process.env.NODE_ENV = 'development';

    const res = await request(app)
      .post('/api/auth/otp/request')
      .send({ phone_e164: '+919000000003' });

    expect(res.status).toBe(200);
    expect(res.body.dev_mock_hint).toMatch(/^\d{6}$/);
  });

  it('absent in production (even if DEMO_MODE or DEMO_ADMIN_HINT are set)', async () => {
    process.env.DEMO_MODE = 'true';
    process.env.DEMO_ADMIN_HINT = 'true';
    process.env.NODE_ENV = 'production';

    const res = await request(app)
      .post('/api/auth/otp/request')
      .send({ phone_e164: '+919000000001' });

    expect(res.status).toBe(200);
    expect(res.body.dev_mock_hint).toBeUndefined();
    expect('dev_mock_hint' in res.body).toBe(false);
  });
});
