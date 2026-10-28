import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  validateSingleLink,
  runCli,
  SHORTENER_HOSTS,
  type SafetyToolLinkItem,
} from '../../../../scripts/check_tool_links';

describe('Safety Tools Link Checker (Pure Unit Tests, No Network)', () => {
  const baseDateMs = new Date('2026-10-28T00:00:00Z').getTime();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Accepts a valid HTTPS link checked recently', () => {
    const validLink: SafetyToolLinkItem = {
      seller_name: 'Verified Seller',
      link_url: 'https://example.com/item/whistle',
      is_affiliate: false,
      last_checked: '2026-10-20',
    };
    const seen = new Set<string>();
    const res = validateSingleLink(validLink, seen, baseDateMs);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(seen.has('https://example.com/item/whistle')).toBe(true);
  });

  it('2. Rejects HTTP links (non-HTTPS)', () => {
    const httpLink: SafetyToolLinkItem = {
      seller_name: 'Insecure Seller',
      link_url: 'http://insecure-store.com/alarm',
      last_checked: '2026-10-20',
    };
    const res = validateSingleLink(httpLink, new Set(), baseDateMs);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toMatch(/Non-HTTPS link rejected/i);
  });

  it('3. Rejects URL shorteners (bit.ly, tinyurl.com, t.co, goo.gl, ow.ly)', () => {
    const shortenerHosts = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly'];
    for (const host of shortenerHosts) {
      expect(SHORTENER_HOSTS.has(host)).toBe(true);
      const link: SafetyToolLinkItem = {
        seller_name: 'Short Link',
        link_url: `https://${host}/xyz123`,
        last_checked: '2026-10-20',
      };
      const res = validateSingleLink(link, new Set(), baseDateMs);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('URL shortener rejected'))).toBe(true);
    }
  });

  it('4. Rejects javascript: and data: URLs', () => {
    const jsLink: SafetyToolLinkItem = {
      seller_name: 'XSS Attempt',
      link_url: 'javascript:alert(1)',
      last_checked: '2026-10-20',
    };
    const resJs = validateSingleLink(jsLink, new Set(), baseDateMs);
    expect(resJs.valid).toBe(false);
    expect(resJs.errors[0]).toMatch(/Prohibited scheme/i);

    const dataLink: SafetyToolLinkItem = {
      seller_name: 'Data URI',
      link_url: 'data:text/html,<script>window.location="evil.com"</script>',
      last_checked: '2026-10-20',
    };
    const resData = validateSingleLink(dataLink, new Set(), baseDateMs);
    expect(resData.valid).toBe(false);
    expect(resData.errors[0]).toMatch(/Prohibited scheme/i);
  });

  it('5. Rejects duplicate links', () => {
    const seen = new Set<string>();
    const link1: SafetyToolLinkItem = {
      seller_name: 'Store A',
      link_url: 'https://trusted-gear.org/tool-1',
      last_checked: '2026-10-20',
    };
    const link2: SafetyToolLinkItem = {
      seller_name: 'Store B',
      link_url: 'https://trusted-gear.org/tool-1/', // trailing slash variation
      last_checked: '2026-10-20',
    };

    const res1 = validateSingleLink(link1, seen, baseDateMs);
    expect(res1.valid).toBe(true);

    const res2 = validateSingleLink(link2, seen, baseDateMs);
    expect(res2.valid).toBe(false);
    expect(res2.errors.some((e) => e.includes('Duplicate link detected'))).toBe(true);
  });

  it('6. Rejects last_checked dates older than 90 days', () => {
    // 95 days before 2026-10-28 is ~2026-07-25
    const oldLink: SafetyToolLinkItem = {
      seller_name: 'Old Checked Link',
      link_url: 'https://example.com/pepper-spray',
      last_checked: '2026-06-01',
    };
    const res = validateSingleLink(oldLink, new Set(), baseDateMs);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('older than 90 days'))).toBe(true);
  });

  it('7. Exits non-zero on any failure', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    const tempFile = path.join(
      os.tmpdir(),
      `bad-safety-tools-${Date.now()}.json`
    );
    fs.writeFileSync(
      tempFile,
      JSON.stringify({
        categories: [
          {
            id: 'cat_whistle',
            slug: 'whistle',
            title: 'Whistle',
            description: 'Desc',
            safe_use_notes: 'Notes',
            legal_note: 'Legal',
            links: [
              {
                seller_name: 'Bad HTTP Seller',
                link_url: 'http://example.com/bad',
                last_checked: '2026-10-25',
              },
            ],
          },
        ],
      }),
      'utf-8'
    );

    try {
      const code = await runCli(tempFile, true);
      expect(code).not.toBe(0);
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });
});
