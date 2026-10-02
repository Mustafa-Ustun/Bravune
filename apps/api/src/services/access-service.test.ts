import { describe, expect, it } from 'vitest';
import { AccessService } from './access-service.js';
import { applicationSchema, profileSchema } from '@bravune/validation';

describe('AccessService', () => {
  it('defaults a missing subscription to free access', async () => {
    const service = new AccessService({ get: async () => null });
    expect(await service.getAccess('customer-a')).toEqual({ plan: 'free', status: 'active' });
  });
  it('downgrades expired pro subscriptions to free', async () => {
    const service = new AccessService({ get: async () => ({ plan: 'pro', status: 'active', currentPeriodEnd: '2000-01-01T00:00:00.000Z' }) });
    expect(await service.getAccess('customer-a')).toEqual({ plan: 'free', status: 'expired' });
  });
  it('rejects free plan creation at the configured limit', async () => {
    const service = new AccessService({ get: async () => null });
    await expect(service.assertCanCreate('customer-a', 'cvs', 3)).rejects.toMatchObject({ status: 403, code: 'plan_limit' });
  });
});

describe('external input validation', () => {
  it('rejects unknown profile fields', () => {
    expect(profileSchema.safeParse({ skills: [], documentContents: 'raw file data' }).success).toBe(false);
  });
  it('rejects invalid application status and missing job ID', () => {
    expect(applicationSchema.safeParse({ jobId: '', status: 'parsing' }).success).toBe(false);
  });
});
