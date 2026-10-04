import crypto from 'crypto';
import { getDb } from '../core/db';
import { logger } from '../core/security';
import { sentMessages } from '../db/schema';

export interface SendSmsParams {
  toPhoneE164: string;
  body: string;
  purpose: string;
  metadata?: Record<string, unknown>;
}

export interface SmsProvider {
  readonly providerName: string;
  sendSms(params: SendSmsParams): Promise<void>;
}

/**
 * MockSmsProvider: Writes outbound SMS messages to the SQLite `sent_messages` table
 * so they can be inspected at `GET /api/dev/outbox` in development/test environments.
 */
export class MockSmsProvider implements SmsProvider {
  public readonly providerName = 'MockSmsProvider';
  private shouldFail = false;
  private failureMessage = 'Simulated MockSmsProvider failure';

  public setSimulateFailure(fail: boolean, message?: string): void {
    this.shouldFail = fail;
    if (message) {
      this.failureMessage = message;
    }
  }

  public reset(): void {
    this.shouldFail = false;
    this.failureMessage = 'Simulated MockSmsProvider failure';
  }

  async sendSms(params: SendSmsParams): Promise<void> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    const db = getDb();
    await db.insert(sentMessages).values({
      id: crypto.randomUUID(),
      toPhoneE164: params.toPhoneE164,
      body: params.body,
      provider: this.providerName,
      purpose: params.purpose,
      metadata: params.metadata || {},
      createdAt: new Date().toISOString(),
    });

    logger.info(
      `[MockSmsProvider] Queued SMS (${params.purpose}) to ${params.toPhoneE164}`
    );
  }
}

export const defaultSmsProvider = new MockSmsProvider();
