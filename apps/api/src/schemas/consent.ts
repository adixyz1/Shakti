import { z } from 'zod';
import { CONSENT_TYPES, type ConsentType } from '../db/schema';

export const postConsentSchema = z.object({
  type: z.enum(CONSENT_TYPES),
  granted: z.boolean(),
  source: z.string().trim().min(1).max(64).default('consent_center'),
});

export interface ConsentLedgerEntryDto {
  id: string;
  user_id: string;
  type: ConsentType;
  granted: boolean;
  source: string;
  created_at: string;
}

export type ConsentStateMap = Record<ConsentType, boolean>;

export interface ConsentsOverviewDto {
  current: ConsentStateMap;
  history: ConsentLedgerEntryDto[];
}
