import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createApp } from '../../../api/server';
import { closeDatabase, initDatabase } from '../../../api/src/core/db';
import { resetRateLimiter } from '../../../api/src/core/middleware';
import { seedDatabase } from '../../../api/src/core/seed';
import { TrustedCirclePage } from '../pages/TrustedCirclePage';
import { PublicInvitePage } from '../pages/PublicInvitePage';
import { ConsentCenterPage } from '../pages/ConsentCenterPage';
import { useAuthStore } from '../store/authStore';
import i18n from '../i18n';

describe('SAATHI Phase 2 Full Browser Flow (Web UI <-> Real Express + SQLite DB)', () => {
  let tempDbPath: string;
  const app = createApp();
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    resetRateLimiter();
    tempDbPath = path.join(
      os.tmpdir(),
      `saathi-phase2-e2e-${crypto.randomUUID()}.db`
    );
    const db = await initDatabase(`file:${tempDbPath}`);
    await seedDatabase(db);
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await closeDatabase();
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const candidate = `${tempDbPath}${suffix}`;
      if (fs.existsSync(candidate)) {
        fs.unlinkSync(candidate);
      }
    }
  });

  it('adds a contact, opens invitation link from /api/dev/outbox in unauthenticated window, accepts, sees status change to Accepted, and revokes consent in ledger', async () => {
    // 1. Authenticate user session in Supertest agent
    const userAgent = request.agent(app);
    userAgent.set('Origin', 'http://localhost:3000');
    const otpReq = await userAgent
      .post('/api/auth/otp/request')
      .send({ phone_e164: '+919000000001' });
    const verifyRes = await userAgent
      .post('/api/auth/otp/verify')
      .send({
        phone_e164: '+919000000001',
        code: otpReq.body.dev_mock_hint,
      });

    useAuthStore.setState({
      user: verifyRes.body,
      isLoading: false,
      toasts: [],
    });

    // Bridge window.fetch to the authenticated Supertest agent
    const makeFetchBridge = (agentInstance: ReturnType<typeof request.agent> | ReturnType<typeof request>) => {
      return (async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = typeof input === 'string' ? input : input.toString();
        const method = (init?.method || 'GET').toLowerCase() as
          | 'get'
          | 'post'
          | 'patch'
          | 'delete';
        let req = (agentInstance as any)[method](urlStr);
        if (init?.body && typeof init.body === 'string') {
          req = req
            .set('Content-Type', 'application/json')
            .send(JSON.parse(init.body));
        }
        const res = await req;
        return {
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          json: async () => res.body,
        } as Response;
      }) as typeof fetch;
    };

    globalThis.fetch = makeFetchBridge(userAgent);

    // 2. Render TrustedCirclePage and add a contact
    const { unmount: unmountCircle1 } = render(
      <MemoryRouter>
        <TrustedCirclePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Your trusted circle is empty/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(/Contact Name/i), {
      target: { value: 'Kavya Nair' },
    });
    fireEvent.change(screen.getByLabelText(/Mobile Number \(E\.164\)/i), {
      target: { value: '+919811112222' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Send Invitation & Add to Circle/i })
    );

    await waitFor(() => {
      expect(screen.getByText('Kavya Nair')).toBeTruthy();
      expect(
        screen.getByText(/Invited \(Pending Acceptance\)/i)
      ).toBeTruthy();
    });

    // Grab the invitation URL from /api/dev/outbox
    const outboxRes = await userAgent.get('/api/dev/outbox');
    expect(outboxRes.status).toBe(200);
    const inviteUrl: string = outboxRes.body.messages[0].metadata.invitation_url;
    expect(inviteUrl).toMatch(/^\/invite\/inv_/);

    unmountCircle1();

    // 3. Open the invitation link in an unauthenticated "private window"
    useAuthStore.setState({ user: null, isLoading: false, toasts: [] });
    globalThis.fetch = makeFetchBridge(request(app));

    const { unmount: unmountInvite } = render(
      <MemoryRouter initialEntries={[inviteUrl]}>
        <Routes>
          <Route path="/invite/:token" element={<PublicInvitePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Aarohi Sharma invited you to their Trusted Circle/i)
      ).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /Accept Invitation/i })
    );

    await waitFor(() => {
      expect(screen.getByText(/Invitation Accepted/i)).toBeTruthy();
    });

    unmountInvite();

    // 4. Switch back to authenticated user window -> verify contact status is now "Accepted & Active"
    useAuthStore.setState({
      user: verifyRes.body,
      isLoading: false,
      toasts: [],
    });
    globalThis.fetch = makeFetchBridge(userAgent);

    const { unmount: unmountCircle2 } = render(
      <MemoryRouter>
        <TrustedCirclePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Kavya Nair')).toBeTruthy();
      expect(screen.getByText(/Accepted & Active/i)).toBeTruthy();
    });

    unmountCircle2();

    // 5. Open ConsentCenterPage -> grant then revoke a consent and verify ledger updates
    render(
      <MemoryRouter>
        <ConsentCenterPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Core Safety Data Processing/i)).toBeTruthy();
    });

    // Demo user starts with seeded data_processing = GRANTED; click Revoke then Grant
    fireEvent.click(
      screen.getByRole('button', {
        name: /Revoke Permission Core Safety Data Processing/i,
      })
    );

    await waitFor(() => {
      expect(screen.getByText('REVOKED')).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: /Grant Permission Core Safety Data Processing/i,
      })
    );

    await waitFor(() => {
      expect(screen.getByText('REVOKED')).toBeTruthy();
      expect(screen.getAllByText('GRANTED').length).toBeGreaterThanOrEqual(1);
    });
  });
});
