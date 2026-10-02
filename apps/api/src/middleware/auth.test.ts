import { describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createAuthenticate } from './auth.js';

function response() {
  const state: { statusCode?: number; body?: unknown } = {};
  const res = {
    status(code: number) { state.statusCode = code; return this; },
    json(body: unknown) { state.body = body; return this; }
  };
  return { state, res: res as unknown as Response };
}

describe('authentication identity resolution', () => {
  it('uses the verified token UID even if the request body names another customer', async () => {
    const req = { header: () => 'Bearer signed-token', body: { customerId: 'customer-b' } } as unknown as Request;
    const { res } = response();
    const next = vi.fn() as unknown as NextFunction;
    const middleware = createAuthenticate(async token => {
      expect(token).toBe('signed-token');
      return { uid: 'customer-a', email: 'a@example.test' };
    });

    await middleware(req, res, next);

    expect(req.customer).toEqual({ id: 'customer-a', email: 'a@example.test' });
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects missing bearer credentials', async () => {
    const req = { header: () => undefined } as unknown as Request;
    const { state, res } = response();
    const next = vi.fn() as unknown as NextFunction;

    await createAuthenticate(async () => ({ uid: 'never' }))(req, res, next);

    expect(state.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects invalid tokens', async () => {
    const req = { header: () => 'Bearer invalid' } as unknown as Request;
    const { state, res } = response();
    const next = vi.fn() as unknown as NextFunction;

    await createAuthenticate(async () => { throw new Error('invalid token'); })(req, res, next);

    expect(state.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('resolves OAuth access tokens to the Firebase customer UID', async () => {
    const req = { header: () => 'Bearer brv_access-token' } as unknown as Request;
    const { res } = response();
    const next = vi.fn() as unknown as NextFunction;
    const middleware = createAuthenticate(
      async () => { throw new Error('not a Firebase ID token'); },
      async token => token === 'brv_access-token' ? { uid: 'firebase-user-1', email: 'user@example.test' } : null
    );

    await middleware(req, res, next);

    expect(req.customer).toEqual({ id: 'firebase-user-1', email: 'user@example.test' });
    expect(next).toHaveBeenCalledOnce();
  });
});
