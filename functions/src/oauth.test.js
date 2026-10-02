import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
const { createOAuthRouter, validChatGPTRedirect, validCimdUrl, hash, readCimd, resolveClient, supportedBravuneLogin, RESOURCE, ISSUER } = require('./oauth.js');

afterEach(() => vi.unstubAllGlobals());

describe('Bravune MCP OAuth configuration', () => {
  it('uses HTTPS canonical issuer and MCP resource identifiers', () => {
    expect(ISSUER).toBe('https://bravune-1e8ee.web.app');
    expect(RESOURCE).toBe('https://bravune-1e8ee.web.app/mcp');
  });

  it('allows ChatGPT and Claude callback redirect URI forms only', () => {
    expect(validChatGPTRedirect('https://chatgpt.com/connector_platform_oauth_redirect')).toBe(true);
    expect(validChatGPTRedirect('https://chatgpt.com/connector/oauth/callback_123')).toBe(true);
    expect(validChatGPTRedirect('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(validChatGPTRedirect('https://claude.ai.evil.test/api/mcp/auth_callback')).toBe(false);
    expect(validChatGPTRedirect('https://claude.ai/connector/oauth/callback_123')).toBe(false);
    expect(validChatGPTRedirect('https://attacker.example/connector_platform_oauth_redirect')).toBe(false);
    expect(validChatGPTRedirect('http://chatgpt.com/connector_platform_oauth_redirect')).toBe(false);
    expect(validChatGPTRedirect('https://chatgpt.com.evil.test/connector_platform_oauth_redirect')).toBe(false);
    expect(validChatGPTRedirect('https://chatgpt.com/connector_platform_oauth_redirect?next=https://attacker.example')).toBe(false);
  });

  it('limits client metadata URL fetching to ChatGPT CIMD paths and the exact Claude metadata URL', () => {
    expect(validCimdUrl('https://chatgpt.com/oauth/client.json')).toBe(true);
    expect(validCimdUrl('https://chatgpt.com/oauth/callback_123/client.json')).toBe(true);
    expect(validCimdUrl('https://claude.ai/oauth/mcp-oauth-client-metadata')).toBe(true);
    expect(validCimdUrl('https://claude.ai/oauth/mcp-oauth-client-metadata/')).toBe(false);
    expect(validCimdUrl('https://claude.ai.evil.test/oauth/mcp-oauth-client-metadata')).toBe(false);
    expect(validCimdUrl('https://claude.ai/oauth/other-metadata')).toBe(false);
    expect(validCimdUrl('https://claude.ai/oauth/mcp-oauth-client-metadata?url=https://attacker.test')).toBe(false);
    expect(validCimdUrl('https://attacker.test/oauth/client.json')).toBe(false);
    expect(validCimdUrl('https://chatgpt.com.evil.test/oauth/client.json')).toBe(false);
    expect(validCimdUrl('https://chatgpt.com/oauth/client.json?url=https://attacker.test')).toBe(false);
  });

  it('hashes credentials before using them as Firestore document IDs', () => {
    expect(hash('brv_secret')).toMatch(/^[a-f0-9]{64}$/);
    expect(hash('brv_secret')).not.toBe('brv_secret');
  });

  it('permits only Google and email/password identities for OAuth grants', () => {
    expect(supportedBravuneLogin({ firebase: { sign_in_provider: 'password' } })).toBe(true);
    expect(supportedBravuneLogin({ firebase: { sign_in_provider: 'google.com' } })).toBe(true);
    expect(supportedBravuneLogin({ firebase: { sign_in_provider: 'anonymous' } })).toBe(false);
    expect(supportedBravuneLogin({ firebase: { sign_in_provider: 'apple.com' } })).toBe(false);
    expect(supportedBravuneLogin({})).toBe(false);
  });

  it('completes authorization, Bravune login, consent, and a PKCE token exchange', async () => {
    const documents = new Map();
    const makeRef = (collection, id) => {
      const key = `${collection}/${id}`;
      return {
        get: async () => ({ exists: documents.has(key), data: () => documents.get(key), ref: makeRef(collection, id) }),
        create: async value => { if (documents.has(key)) throw new Error('already exists'); documents.set(key, value); },
        update: async value => documents.set(key, { ...documents.get(key), ...value }),
        delete: async () => documents.delete(key),
      };
    };
    const db = {
      collection: name => ({ doc: id => makeRef(name, id) }),
      runTransaction: async callback => callback({
        get: ref => ref.get(), create: (ref, value) => ref.create(value), delete: ref => ref.delete(),
      }),
    };
    const auth = {
      verifyIdToken: vi.fn(async () => ({ uid: 'firebase-user-123', email: 'user@example.com', firebase: { sign_in_provider: 'password' } })),
      getUser: vi.fn(async () => ({ uid: 'firebase-user-123', email: 'user@example.com', disabled: false })),
    };
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(createOAuthRouter({ db, auth, getFirebaseWebApiKey: () => 'public-test-key' }));
    const server = createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    try {
      const registered = await fetch(`${base}/oauth/register`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'] }),
      });
      expect(registered.status).toBe(201);
      const client = await registered.json();
      const verifier = randomBytes(32).toString('base64url');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const query = new URLSearchParams({
        client_id: client.client_id, redirect_uri: client.redirect_uris[0], response_type: 'code',
        state: 'state-123', code_challenge: challenge, code_challenge_method: 'S256', resource: RESOURCE, scope: 'bravune',
      });
      const authorization = await fetch(`${base}/oauth/authorize?${query}`);
      expect(authorization.status).toBe(200);
      const page = await authorization.text();
      expect(page).toContain('Continue with Google');
      expect(page).toContain('createUserWithEmailAndPassword');
      expect(page).not.toContain('anonymous');
      const flowId = page.match(/const flowId=("[^"]+")/)[1].slice(1, -1);

      const login = await fetch(`${base}/oauth/firebase-session`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ flowId, firebaseIdToken: 'verified-firebase-id-token' }),
      });
      expect(login.status).toBe(200);
      const approved = await fetch(`${base}/oauth/approve`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ flowId }),
      });
      const callback = new URL((await approved.json()).redirectTo);
      expect(callback.origin).toBe('https://chatgpt.com');
      expect(callback.searchParams.get('state')).toBe('state-123');
      expect(callback.searchParams.get('iss')).toBe(ISSUER);
      const code = callback.searchParams.get('code');

      const exchanged = await fetch(`${base}/oauth/token`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: client.redirect_uris[0], client_id: client.client_id, code_verifier: verifier, resource: RESOURCE }),
      });
      expect(exchanged.status).toBe(200);
      const token = await exchanged.json();
      expect(token.token_type).toBe('Bearer');
      const accessGrant = documents.get(`oauthAccessTokens/${hash(token.access_token)}`);
      expect(accessGrant).toMatchObject({ uid: 'firebase-user-123', resource: RESOURCE, scope: 'bravune' });

      const secondAuthorization = await fetch(`${base}/oauth/authorize?${query}`);
      const secondPage = await secondAuthorization.text();
      const secondFlowId = JSON.parse(secondPage.match(/const flowId=("[^"]+")/)[1]);
      auth.verifyIdToken.mockResolvedValueOnce({ uid: 'anonymous-user', firebase: { sign_in_provider: 'anonymous' } });
      const anonymous = await fetch(`${base}/oauth/firebase-session`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ flowId: secondFlowId, firebaseIdToken: 'anonymous-id-token' }),
      });
      expect(anonymous.status).toBe(403);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('accepts ChatGPT CIMD with private_key_jwt preference when public PKCE is also supported', async () => {
    const clientId = 'https://chatgpt.com/oauth/client.json';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      client_id: clientId,
      client_name: 'ChatGPT',
      redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
      token_endpoint_auth_method: 'private_key_jwt',
      token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    await expect(readCimd(clientId)).resolves.toMatchObject({ clientId, clientName: 'ChatGPT' });
  });

  it('accepts Claude CIMD only after validating the published metadata', async () => {
    const clientId = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
    const metadata = {
      client_id: clientId,
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:jwt-bearer'],
      response_types: ['code'],
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(metadata), { status: 200, headers: { 'content-type': 'application/json' } })));

    await expect(readCimd(clientId)).resolves.toMatchObject({
      clientId,
      clientName: 'Claude',
      redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
    });
  });

  it('rejects Claude metadata with a different redirect URI', async () => {
    const clientId = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      client_id: clientId,
      client_name: 'Claude',
      redirect_uris: ['https://attacker.example/api/mcp/auth_callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    }), { status: 200 })));

    await expect(readCimd(clientId)).rejects.toThrow('OAuth client metadata is invalid.');
  });

  it('rejects Claude metadata that requests a confidential token authentication method', async () => {
    const clientId = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      client_id: clientId,
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      token_endpoint_auth_method: 'client_secret_post',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    }), { status: 200 })));

    await expect(readCimd(clientId)).rejects.toThrow('OAuth client metadata is invalid.');
  });

  it('rejects unknown OAuth client IDs before consulting Firestore', async () => {
    const db = { collection: vi.fn() };
    await expect(resolveClient(db, 'unknown-client')).rejects.toThrow('Unknown OAuth client.');
    expect(db.collection).not.toHaveBeenCalled();
  });
});
