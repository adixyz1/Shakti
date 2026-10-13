import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../server';
import { closeDatabase, getDb, initDatabase } from '../core/db';
import { resetRateLimiter } from '../core/middleware';
import { seedDatabase } from '../core/seed';
import { redactPII } from '../core/security';
import { otpCodes } from '../db/schema';

describe('SAATHI Phase 1 API Tests (Express + Drizzle + Real SQLite)', () => {
  let tempDbPath: string;
  const app = createApp();

  beforeEach(async () => {
    resetRateLimiter();
    tempDbPath = path.join(os.tmpdir(), `saathi-test-${crypto.randomUUID()}.db`);
    const db = await initDatabase(`file:${tempDbPath}`);
    await seedDatabase(db);
  });

  afterEach(async () => {
    await closeDatabase();
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const candidate = `${tempDbPath}${suffix}`;
      if (fs.existsSync(candidate)) {
        fs.unlinkSync(candidate);
      }
    }
  });

  it('GET /api/health returns 200 OK and sets strict security headers', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.runtime).toBe('node-express-sqlite-drizzle');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('completes OTP request -> verify -> /me -> PATCH /me against real SQLite', async () => {
    const agent = request.agent(app);
    agent.set('Origin', 'http://localhost:3000');
    const phone = '+919000000001';

    const reqOtp = await agent
      .post('/api/auth/otp/request')
      .send({ phone_e164: phone });

    expect(reqOtp.status).toBe(200);
    expect(reqOtp.body.status).toBe('otp_sent');
    expect(reqOtp.body.provider).toBe('MockOtpProvider');
    expect(reqOtp.body.expires_in_seconds).toBe(300);
    const code = reqOtp.body.dev_mock_hint;
    expect(code).toMatch(/^\d{6}$/);

    const verifyRes = await agent
      .post('/api/auth/otp/verify')
      .send({ phone_e164: phone, code });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.phone_e164).toBe(phone);
    expect(verifyRes.body.name).toBe('Aarohi Sharma');
    expect(verifyRes.body.role).toBe('user');

    const setCookieHeader = verifyRes.headers['set-cookie'] as unknown as string[];
    expect(setCookieHeader).toBeDefined();
    expect(setCookieHeader.some((c: string) => c.includes('saathi_access_token') && c.includes('HttpOnly'))).toBe(true);
    expect(setCookieHeader.some((c: string) => c.includes('saathi_refresh_token') && c.includes('HttpOnly'))).toBe(true);

    const meRes = await agent.get('/api/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.name).toBe('Aarohi Sharma');

    const patchRes = await agent
      .patch('/api/me')
      .send({ language: 'hi' });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.language).toBe('hi');
  });

  it('rejects an expired OTP with 400 Bad Request', async () => {
    const phone = '+919000000001';
    const reqOtp = await request(app)
      .post('/api/auth/otp/request')
      .send({ phone_e164: phone });
    const code = reqOtp.body.dev_mock_hint;

    // Force OTP expiration in SQLite
    const db = getDb();
    await db
      .update(otpCodes)
      .set({ expiresAt: Date.now() - 5_000 })
      .where(eq(otpCodes.phoneE164, phone));

    const verifyRes = await request(app)
      .post('/api/auth/otp/verify')
      .send({ phone_e164: phone, code });

    expect(verifyRes.status).toBe(400);
    expect(verifyRes.body.detail).toMatch(/expired/i);
  });

  it('enforces 3-attempt OTP lockout with 429 Too Many Requests', async () => {
    const phone = '+919000000001';
    const reqOtp = await request(app)
      .post('/api/auth/otp/request')
      .send({ phone_e164: phone });
    const realCode = reqOtp.body.dev_mock_hint;
    const wrongCode = realCode === '000000' ? '999999' : '000000';

    const attempt1 = await request(app)
      .post('/api/auth/otp/verify')
      .send({ phone_e164: phone, code: wrongCode });
    expect(attempt1.status).toBe(400);

    const attempt2 = await request(app)
      .post('/api/auth/otp/verify')
      .send({ phone_e164: phone, code: wrongCode });
    expect(attempt2.status).toBe(400);

    const attempt3 = await request(app)
      .post('/api/auth/otp/verify')
      .send({ phone_e164: phone, code: wrongCode });
    expect(attempt3.status).toBe(429);

    // Even supplying the correct code after lockout is rejected with 429
    const attempt4 = await request(app)
      .post('/api/auth/otp/verify')
      .send({ phone_e164: phone, code: realCode });
    expect(attempt4.status).toBe(429);
  });

  it('enforces RBAC role guards across user, responder, and admin accounts', async () => {
    // 1. User (+919000000001) -> 403 on responder and admin routes
    const userAgent = request.agent(app);
    const userOtp = await userAgent
      .post('/api/auth/otp/request')
      .send({ phone_e164: '+919000000001' });
    await userAgent
      .post('/api/auth/otp/verify')
      .send({ phone_e164: '+919000000001', code: userOtp.body.dev_mock_hint });

    const userAdminCheck = await userAgent.get('/api/rbac/admin-check');
    expect(userAdminCheck.status).toBe(403);
    const userResponderCheck = await userAgent.get('/api/rbac/responder-check');
    expect(userResponderCheck.status).toBe(403);

    // 2. Responder (+919000000002) -> 200 on responder, 403 on admin
    const responderAgent = request.agent(app);
    const respOtp = await responderAgent
      .post('/api/auth/otp/request')
      .send({ phone_e164: '+919000000002' });
    await responderAgent
      .post('/api/auth/otp/verify')
      .send({ phone_e164: '+919000000002', code: respOtp.body.dev_mock_hint });

    const respCheck = await responderAgent.get('/api/rbac/responder-check');
    expect(respCheck.status).toBe(200);
    const respAdminCheck = await responderAgent.get('/api/rbac/admin-check');
    expect(respAdminCheck.status).toBe(403);

    // 3. Admin (+919000000003) -> 200 on both admin and responder routes
    const adminAgent = request.agent(app);
    const adminOtp = await adminAgent
      .post('/api/auth/otp/request')
      .send({ phone_e164: '+919000000003' });
    await adminAgent
      .post('/api/auth/otp/verify')
      .send({ phone_e164: '+919000000003', code: adminOtp.body.dev_mock_hint });

    const adminCheck = await adminAgent.get('/api/rbac/admin-check');
    expect(adminCheck.status).toBe(200);
    expect(adminCheck.body.role).toBe('admin');
  });

  it('rotates tokens via /api/auth/refresh and clears session on /api/auth/logout', async () => {
    const agent = request.agent(app);
    agent.set('Origin', 'http://localhost:3000');
    const otp = await agent
      .post('/api/auth/otp/request')
      .send({ phone_e164: '+919000000001' });
    await agent
      .post('/api/auth/otp/verify')
      .send({ phone_e164: '+919000000001', code: otp.body.dev_mock_hint });

    const refreshRes = await agent.post('/api/auth/refresh');
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.phone_e164).toBe('+919000000001');

    const logoutRes = await agent.post('/api/auth/logout');
    expect(logoutRes.status).toBe(200);

    const meAfterLogout = await agent.get('/api/me');
    expect(meAfterLogout.status).toBe(401);
  });

  it('redacts E.164 phone numbers and JWT tokens from log strings', () => {
    const raw =
      'Dispatched OTP to +919000000001 with token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const sanitized = redactPII(raw);
    expect(sanitized).not.toContain('+919000000001');
    expect(sanitized).toContain('[REDACTED_PHONE]');
    expect(sanitized).toContain('[REDACTED_TOKEN]');
  });
});
