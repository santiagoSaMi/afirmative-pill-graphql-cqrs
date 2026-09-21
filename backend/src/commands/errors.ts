import type { z } from 'zod';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'EMAIL_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'MEDICATION_NOT_FOUND'
  | 'INSUFFICIENT_STOCK'
  | 'PRESCRIPTION_REQUIRED'
  | 'PRESCRIPTION_INVALID'
  | 'ORDER_NOT_FOUND'
  | 'INVALID_STATE_TRANSITION';

export interface DomainError {
  code: ErrorCode;
  message: string;
  field?: string | null;
  medicationId?: string | null;
  requested?: number | null;
  available?: number | null;
}

export function zodToDomainErrors(error: z.ZodError): DomainError[] {
  return error.issues.map((issue) => ({
    code: 'VALIDATION_ERROR' as const,
    message: issue.message,
    field: issue.path.length ? issue.path.join('.') : null,
  }));
}
