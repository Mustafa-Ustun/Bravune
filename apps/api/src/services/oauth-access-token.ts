import { createHash } from 'node:crypto';
import { db } from '../config/firebase.js';

export interface OAuthAccessIdentity {
  uid: string;
  email?: string;
}

export async function resolveOAuthAccessToken(token: string): Promise<OAuthAccessIdentity | null> {
  if (!token.startsWith('brv_') || token.length > 256) return null;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const snapshot = await db.collection('oauthAccessTokens').doc(tokenHash).get();
  if (!snapshot.exists) return null;

  const grant = snapshot.data();
  const expiresAt = grant?.expiresAt?.toDate?.();
  const scopes = typeof grant?.scope === 'string' ? grant.scope.split(/\s+/) : [];
  if (!grant?.uid || !expiresAt || expiresAt.getTime() <= Date.now() || !scopes.includes('bravune') || grant.resource !== 'https://bravune-1e8ee.web.app/mcp') {
    if (expiresAt && expiresAt.getTime() <= Date.now()) await snapshot.ref.delete();
    return null;
  }

  return { uid: grant.uid, email: typeof grant.email === 'string' ? grant.email : '' };
}
