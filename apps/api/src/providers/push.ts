import { logger } from '../core/security';

export interface SendPushParams {
  recipientRef: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushProvider {
  readonly providerName: string;
  sendPush(params: SendPushParams): Promise<void>;
}

export interface RecordedPushMessage extends SendPushParams {
  id: string;
  createdAt: string;
}

/**
 * MockPushProvider: Records push notifications in memory and supports
 * simulated failure modes so tests can verify independent provider fallback.
 */
export class MockPushProvider implements PushProvider {
  public readonly providerName = 'MockPushProvider';
  public sentPushes: RecordedPushMessage[] = [];
  private shouldFail = false;
  private failureMessage = 'Simulated MockPushProvider failure';

  public setSimulateFailure(fail: boolean, message?: string): void {
    this.shouldFail = fail;
    if (message) {
      this.failureMessage = message;
    }
  }

  public reset(): void {
    this.sentPushes = [];
    this.shouldFail = false;
    this.failureMessage = 'Simulated MockPushProvider failure';
  }

  async sendPush(params: SendPushParams): Promise<void> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    this.sentPushes.push({
      ...params,
      id: `push_${this.sentPushes.length + 1}`,
      createdAt: new Date().toISOString(),
    });

    logger.info(
      `[MockPushProvider] Dispatched push "${params.title}" to ${params.recipientRef}`
    );
  }
}

export const defaultPushProvider = new MockPushProvider();
