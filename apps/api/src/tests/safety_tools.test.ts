import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import { initDatabase, closeDatabase } from '../core/db';
import { seedDatabase } from '../core/seed';
import { createApp } from '../../server';
import { resetRateLimiter } from '../core/middleware';
import type { Express } from 'express';

describe('Safety Tools Backend API', () => {
  let tempDbPath: string;
  let app: Express;
  let userToken = '';
  let responderToken = '';
  let adminToken = '';

  async function getAccessToken(phone: string, name: string) {
    resetRateLimiter();
    const reqRes = await request(app)
      .post('/api/auth/otp/request')
      .send({ phone_e164: phone });
    expect(reqRes.status).toBe(200);

    const code = reqRes.body.dev_mock_hint || '123456';

    const verRes = await request(app)
      .post('/api/auth/otp/verify')
      .send({ phone_e164: phone, code, name });
    expect(verRes.status).toBe(200);

    const cookies = (verRes.headers['set-cookie'] as unknown as string[]) || [];
    const accessCookie = cookies.find((c) =>
      c.startsWith('saathi_access_token=')
    );
    return accessCookie
      ? accessCookie.split(';')[0].split('=')[1]
      : verRes.body.token || verRes.body.access_token || '';
  }

  beforeEach(async () => {
    process.env.DEMO_MODE = 'true';
    process.env.DEMO_ADMIN_HINT = 'true';
    resetRateLimiter();

    tempDbPath = path.join(
      os.tmpdir(),
      `saathi-safety-tools-test-${crypto.randomUUID()}.db`
    );
    const db = await initDatabase(`file:${tempDbPath}`);
    await seedDatabase(db);
    app = createApp();

    userToken = await getAccessToken('+919000000001', 'Priya Sharma');
    responderToken = await getAccessToken('+919000000002', 'Inspector Kavita Rao');
    adminToken = await getAccessToken('+919000000003', 'Meera Nair');
  });

  afterEach(async () => {
    await closeDatabase();
    if (tempDbPath && fs.existsSync(tempDbPath)) {
      try {
        fs.unlinkSync(tempDbPath);
      } catch {
        // ignore
      }
    }
  });

  it('1. Public GET works as a guest (no auth) and returns seeded tools including self_defence category and HTTPS product hyperlinks', async () => {
    const res = await request(app).get('/api/safety-tools');
    expect(res.status).toBe(200);
    expect(res.body.safety_tools).toBeDefined();
    expect(Array.isArray(res.body.safety_tools)).toBe(true);
    expect(res.body.safety_tools.length).toBeGreaterThanOrEqual(6);

    const categories = res.body.safety_tools.map((t: any) => t.category);
    expect(categories).toContain('personal_alarm_keychain');
    expect(categories).toContain('whistle');
    expect(categories).toContain('torch_keyring');
    expect(categories).toContain('portable_door_alarm');
    expect(categories).toContain('pepper_spray');
    expect(categories).toContain('self_defence');

    for (const tool of res.body.safety_tools) {
      if (tool.link_url !== null) {
        expect(tool.link_url).toMatch(/^https:\/\//);
        expect(tool.link_label.length).toBeGreaterThan(3);
      }

      // Verify no sender metadata ("ishika singh sms") appears in any field
      const content = `${tool.title} ${tool.description} ${tool.safe_use_notes} ${tool.legal_note} ${tool.link_label}`;
      expect(content).not.toMatch(/ishika singh/i);

      // Must have safe_use_notes and legal_note
      expect(tool.safe_use_notes.length).toBeGreaterThan(10);
      expect(tool.legal_note.length).toBeGreaterThan(10);
      expect(tool.last_checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('2. Admin-only edits: 401 unauthenticated, 403 for user and responder, 201 for admin on POST', async () => {
    const newToolPayload = {
      category: 'personal_alarm_keychain',
      title: 'Audible Emergency Keychain Alarm',
      description: 'Loud battery siren designed to deter attackers and summon nearby help.',
      safe_use_notes: 'Keep securely attached to bag strap. Check battery status monthly.',
      legal_note: 'Audible alert devices are legal in public spaces in India.',
      link_url: 'https://example.org/trusted-personal-alarm',
      link_label: 'View certified supplier',
      last_checked: '2026-10-28',
      active: true,
      is_affiliate: true,
    };

    // Unauthenticated -> 401
    const unauthRes = await request(app)
      .post('/api/admin/safety-tools')
      .send(newToolPayload);
    expect(unauthRes.status).toBe(401);

    // Regular User -> 403
    const userRes = await request(app)
      .post('/api/admin/safety-tools')
      .set('Authorization', `Bearer ${userToken}`)
      .send(newToolPayload);
    expect(userRes.status).toBe(403);

    // Responder -> 403
    const respRes = await request(app)
      .post('/api/admin/safety-tools')
      .set('Authorization', `Bearer ${responderToken}`)
      .send(newToolPayload);
    expect(respRes.status).toBe(403);

    // Admin -> 201 Created
    const adminRes = await request(app)
      .post('/api/admin/safety-tools')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(newToolPayload);
    expect(adminRes.status).toBe(201);
    expect(adminRes.body.safety_tool.title).toBe('Audible Emergency Keychain Alarm');
    expect(adminRes.body.safety_tool.link_url).toBe('https://example.org/trusted-personal-alarm');
    expect(adminRes.body.safety_tool.is_affiliate).toBe(true);
  });

  it('3. Strict Zod validation: rejects non-https URLs and invalid fields with 422', async () => {
    // Attempt non-https link (http://)
    const insecureRes = await request(app)
      .post('/api/admin/safety-tools')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        category: 'whistle',
        title: 'Insecure Whistle Link',
        description: 'Test description',
        safe_use_notes: 'Test safe use notes',
        legal_note: 'Test legal note',
        link_url: 'http://insecure-site.org/whistle', // HTTP not allowed!
      });
    expect(insecureRes.status).toBe(422);
    expect(insecureRes.body.detail).toMatch(/HTTPS/i);

    // Attempt invalid date format
    const badDateRes = await request(app)
      .post('/api/admin/safety-tools')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        category: 'whistle',
        title: 'Bad Date Whistle',
        description: 'Test description',
        safe_use_notes: 'Test safe use notes',
        legal_note: 'Test legal note',
        last_checked: '28/10/2026', // invalid format (expects YYYY-MM-DD)
      });
    expect(badDateRes.status).toBe(422);
  });

  it('4. Admin update and delete: PUT updates tool, DELETE removes it, with 403 for non-admins', async () => {
    // 1. Create a tool as admin
    const createRes = await request(app)
      .post('/api/admin/safety-tools')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        category: 'torch_keyring',
        title: 'Mini LED Light',
        description: 'High lumen pocket light.',
        safe_use_notes: 'Muffle when testing indoors.',
        legal_note: 'Fully legal.',
        link_url: 'https://example.org/led-light',
        link_label: 'Check seller',
        last_checked: '2026-10-28',
      });
    expect(createRes.status).toBe(201);
    const createdId = createRes.body.safety_tool.id;

    // 2. User tries to update -> 403
    const userUpdateRes = await request(app)
      .put(`/api/admin/safety-tools/${createdId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ title: 'User Hacked Title' });
    expect(userUpdateRes.status).toBe(403);

    // 3. Admin updates -> 200
    const adminUpdateRes = await request(app)
      .put(`/api/admin/safety-tools/${createdId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Updated Mini LED Light',
        is_affiliate: true,
      });
    expect(adminUpdateRes.status).toBe(200);
    expect(adminUpdateRes.body.safety_tool.title).toBe('Updated Mini LED Light');
    expect(adminUpdateRes.body.safety_tool.is_affiliate).toBe(true);

    // 4. User tries to delete -> 403
    const userDeleteRes = await request(app)
      .delete(`/api/admin/safety-tools/${createdId}`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(userDeleteRes.status).toBe(403);

    // 5. Admin deletes -> 200
    const adminDeleteRes = await request(app)
      .delete(`/api/admin/safety-tools/${createdId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminDeleteRes.status).toBe(200);
    expect(adminDeleteRes.body.success).toBe(true);

    // 6. Verify deleted from list
    const listRes = await request(app).get('/api/safety-tools');
    const ids = listRes.body.safety_tools.map((t: any) => t.id);
    expect(ids).not.toContain(createdId);
  });
});
