import { logger } from '../core/security';

export interface EmergencyDispatchRequest {
  incidentId: string;
  userId: string;
  emergencyType?: string | null;
  location?: {
    lat: number;
    lng: number;
    accuracyM?: number | null;
    capturedAt?: string;
  } | null;
  note?: string;
}

export interface EmergencyDispatchResult {
  accepted: boolean;
  referenceId: string;
  reason?: string;
}

export interface EmergencyServiceGateway {
  readonly providerName: string;
  dispatch112(
    request: EmergencyDispatchRequest
  ): Promise<EmergencyDispatchResult>;
}

export interface RecordedEmergencyGatewayRequest
  extends EmergencyDispatchRequest {
  referenceId: string;
  mode: 'accept' | 'reject';
  createdAt: string;
}

/**
 * MockEmergencyGateway: Records 112/181 escalation gateway requests and can
 * simulate accept, reject, or network failure.
 * Explicitly labeled Mock — SAATHI complements 112/181 and never claims guaranteed arrival.
 */
export class MockEmergencyGateway implements EmergencyServiceGateway {
  public readonly providerName = 'MockEmergencyGateway';
  public requests: RecordedEmergencyGatewayRequest[] = [];
  private mode: 'accept' | 'reject' | 'throw' = 'accept';
  private errorMessage = 'Simulated MockEmergencyGateway rejection';

  public setSimulationMode(
    mode: 'accept' | 'reject' | 'throw',
    errorMessage?: string
  ): void {
    this.mode = mode;
    if (errorMessage) {
      this.errorMessage = errorMessage;
    }
  }

  public reset(): void {
    this.requests = [];
    this.mode = 'accept';
    this.errorMessage = 'Simulated MockEmergencyGateway rejection';
  }

  async dispatch112(
    request: EmergencyDispatchRequest
  ): Promise<EmergencyDispatchResult> {
    if (this.mode === 'throw') {
      throw new Error(this.errorMessage);
    }

    const referenceId = `mock112_${this.requests.length + 1}`;
    const recordedMode = this.mode === 'reject' ? 'reject' : 'accept';

    this.requests.push({
      ...request,
      referenceId,
      mode: recordedMode,
      createdAt: new Date().toISOString(),
    });

    if (this.mode === 'reject') {
      throw new Error(this.errorMessage);
    }

    logger.info(
      `[MockEmergencyGateway] Recorded mock 112 escalation for incident ${request.incidentId} (ref=${referenceId})`
    );

    return {
      accepted: true,
      referenceId,
    };
  }
}

export const defaultEmergencyGateway = new MockEmergencyGateway();
