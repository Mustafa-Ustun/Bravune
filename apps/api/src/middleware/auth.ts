import type { Request, Response, NextFunction } from 'express';
import { auth } from '../config/firebase.js';
import { resolveOAuthAccessToken } from '../services/oauth-access-token.js';
declare global { namespace Express { interface Request { customer?: { id: string; email: string } } } }
export function createAuthenticate(
  verifyIdToken: (token: string) => Promise<{ uid: string; email?: string }>,
  verifyOAuthAccessToken: (token: string) => Promise<{ uid: string; email?: string } | null> = async () => null
) {
  return async function authenticate(req: Request, res: Response, next: NextFunction) {
    try {
      const header = req.header('authorization');
      if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: { code: 'unauthenticated', message: 'A valid bearer access token is required.' } });
      const token = header.slice(7);
      let decoded;
      try {
        decoded = await verifyIdToken(token);
      } catch {
        decoded = await verifyOAuthAccessToken(token);
        if (!decoded) throw new Error('Invalid bearer token.');
      }
      if (!decoded.uid) return res.status(401).json({ error: { code: 'unauthenticated', message: 'The access token has no customer identity.' } });
      req.customer = { id: decoded.uid, email: decoded.email ?? '' }; next();
    } catch { res.status(401).json({ error: { code: 'unauthenticated', message: 'The access token is invalid or expired.' } }); }
  };
}
export const authenticate = createAuthenticate(token => auth.verifyIdToken(token), resolveOAuthAccessToken);
