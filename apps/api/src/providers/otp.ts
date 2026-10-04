import { config } from '../core/config';
import { logger } from '../core/security';

export interface OtpProvider {
  readonly providerName: string;
  sendOtp(phoneE164: string, code: string): Promise<void>;
}

/**
 * MockOtpProvider: Explicitly labeled mock OTP provider for local development and tests.
 * Never logs raw phone numbers in structured logs (redacted via logger).
 */
export class MockOtpProvider implements OtpProvider {
  public readonly providerName = 'MockOtpProvider';

  async sendOtp(phoneE164: string, code: string): Promise<void> {
    logger.info(`[MockOtpProvider] Dispatched 6-digit OTP to ${phoneE164}`);
    if (config.environment !== 'production') {
      console.info(
        `[MockOtpProvider DEV CONSOLE] OTP code generated: ${code} (expires in ${config.otpExpireSeconds}s)`
      );
    }
  }
}

export const defaultOtpProvider: OtpProvider = new MockOtpProvider();
