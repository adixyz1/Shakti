import { config } from '../core/config';

export interface AssistContext {
  incidentType?: string | null;
  language?: 'en' | 'hi';
}

export interface AssistSuggestion {
  enabled: boolean;
  provider: string;
  guidance: string[];
}

export interface AssistProvider {
  readonly providerName: string;
  readonly isEnabled: boolean;
  suggestGuidance(context: AssistContext): Promise<AssistSuggestion>;
}

/**
 * NoopAssistProvider: Default implementation when ENABLE_AI_ASSIST=false.
 * Per Hard Constraint #6, the core SOS path from POST /incidents to notifications
 * NEVER imports or invokes AssistProvider.
 */
export class NoopAssistProvider implements AssistProvider {
  public readonly providerName = 'NoopAssistProvider';

  public get isEnabled(): boolean {
    return Boolean(config.enableAiAssist);
  }

  async suggestGuidance(_context: AssistContext): Promise<AssistSuggestion> {
    return {
      enabled: false,
      provider: this.providerName,
      guidance: [],
    };
  }
}

export const defaultAssistProvider: AssistProvider = new NoopAssistProvider();
