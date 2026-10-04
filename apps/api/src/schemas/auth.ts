import { z } from 'zod';

export const E164_REGEX = /^\+[1-9]\d{7,14}$/;

export const otpRequestSchema = z.object({
  phone_e164: z
    .string()
    .trim()
    .regex(E164_REGEX, 'Phone number must be in valid E.164 format (e.g. +919000000001)'),
});

export const otpVerifySchema = z.object({
  phone_e164: z
    .string()
    .trim()
    .regex(E164_REGEX, 'Phone number must be in valid E.164 format (e.g. +919000000001)'),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'OTP code must be a 6-digit number'),
  name: z.string().trim().min(1).max(100).optional(),
});

export const updateMeSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  language: z.enum(['en', 'hi']).optional(),
});

export interface UserResponseDto {
  id: string;
  phone_e164: string;
  name: string;
  role: 'user' | 'responder' | 'admin';
  language: 'en' | 'hi';
  cancel_window_seconds: number;
  has_cancel_pin: boolean;
  has_duress_pin: boolean;
  created_at: string;
}
