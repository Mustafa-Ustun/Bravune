const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const express = require('express');

const ISSUER = 'https://bravune-1e8ee.web.app';
const RESOURCE = `${ISSUER}/mcp`;
const SCOPE = 'bravune';
const OFFLINE_SCOPE = 'offline_access';
const CLAUDE_CIMD_URL = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
const CLAUDE_REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';
const AUTH_CODE_TTL_MS = 60_000;
const LOGIN_SESSION_TTL_MS = 10 * 60_000;
const ACCESS_TOKEN_TTL_MS = 60 * 60_000;
const hash = value => createHash('sha256').update(value).digest('hex');
const randomValue = (prefix = '') => `${prefix}${randomBytes(32).toString('base64url')}`;
const jsonError = (res, status, error, description) => res.status(status).set('Cache-Control', 'no-store').json({ error, error_description: description });

function validChatGPTRedirect(uri) {
  try {
    const url = new URL(uri);
    const validBase = url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && !url.search;
    const openAiCallback = ['chatgpt.com', 'chat.openai.com'].includes(url.hostname) &&
      (url.pathname === '/connector_platform_oauth_redirect' || /^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(url.pathname));
    const claudeCallback = url.hostname === 'claude.ai' && url.pathname === '/api/mcp/auth_callback';
    return validBase && (openAiCallback || claudeCallback);
  } catch { return false; }
}

function validCimdUrl(clientId) {
  if (clientId === CLAUDE_CIMD_URL) return true;
  try {
    const url = new URL(clientId);
    return url.protocol === 'https:' && url.hostname === 'chatgpt.com' && !url.port && !url.username && !url.password &&
      !url.search && !url.hash && /^\/oauth\/(?:[A-Za-z0-9_-]+\/)?client\.json$/.test(url.pathname);
  } catch { return false; }
}

async function readCimd(clientId) {
  if (!validCimdUrl(clientId)) throw new Error('Unsupported OAuth client identifier.');
  const response = await fetch(clientId, { redirect: 'error', signal: AbortSignal.timeout(4000), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('OAuth client metadata could not be loaded.');
  const raw = await response.text();
  if (raw.length > 64 * 1024) throw new Error('OAuth client metadata is too large.');
  const metadata = JSON.parse(raw);
  const clientTokenMethods = metadata.token_endpoint_auth_methods_supported || (metadata.token_endpoint_auth_method ? [metadata.token_endpoint_auth_method] : ['none']);
  if (metadata.client_id !== clientId || !Array.isArray(metadata.redirect_uris) || !metadata.redirect_uris.length ||
      !metadata.redirect_uris.every(uri => typeof uri === 'string' && validChatGPTRedirect(uri)) ||
      !Array.isArray(clientTokenMethods) || !clientTokenMethods.includes('none')) {
    throw new Error('OAuth client metadata is invalid.');
  }
  if (metadata.grant_types && !metadata.grant_types.includes('authorization_code')) throw new Error('Unsupported OAuth client grant type.');
  if (metadata.response_types && !metadata.response_types.includes('code')) throw new Error('Unsupported OAuth client response type.');
  if (clientId === CLAUDE_CIMD_URL && (
    metadata.client_name !== 'Claude' ||
    metadata.token_endpoint_auth_method !== 'none' ||
    metadata.redirect_uris.length !== 1 || metadata.redirect_uris[0] !== CLAUDE_REDIRECT_URI ||
    !Array.isArray(metadata.grant_types) || !metadata.grant_types.includes('authorization_code') ||
    !Array.isArray(metadata.response_types) || metadata.response_types.length !== 1 || metadata.response_types[0] !== 'code'
  )) throw new Error('Claude OAuth client metadata is invalid.');
  return { clientId, clientName: String(metadata.client_name || 'ChatGPT').slice(0, 120), redirectUris: metadata.redirect_uris };
}

async function resolveClient(db, clientId) {
  if (validCimdUrl(clientId)) return readCimd(clientId);
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(clientId)) throw new Error('Unknown OAuth client.');
  const snapshot = await db.collection('oauthClients').doc(clientId).get();
  if (!snapshot.exists) throw new Error('Unknown OAuth client.');
  const client = snapshot.data();
  return { clientId, clientName: client.clientName, redirectUris: client.redirectUris };
}

function safeJson(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, char => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029' })[char]);
}

function diagnosticValue(value, maxLength = 512) {
  if (typeof value !== 'string') return null;
  return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength);
}

function oauthClientIdType(clientId) {
  if (typeof clientId === 'string' && validCimdUrl(clientId)) return 'CIMD';
  if (typeof clientId === 'string' && /^[A-Za-z0-9_-]{40,80}$/.test(clientId)) return 'DCR candidate';
  return 'unknown';
}

function supportedBravuneLogin(decoded) {
  return ['password', 'google.com'].includes(decoded?.firebase?.sign_in_provider);
}

function requestedScopes(value) {
  const scopes = typeof value === 'string' && value.trim() ? [...new Set(value.trim().split(/\s+/))] : [SCOPE];
  if (scopes.some(scope => scope !== SCOPE && scope !== OFFLINE_SCOPE)) return null;
  if (!scopes.includes(SCOPE)) scopes.push(SCOPE);
  return scopes;
}

function authorizationError(res, redirectUri, state, error, description) {
  const callback = new URL(redirectUri);
  callback.searchParams.set('error', error);
  callback.searchParams.set('error_description', description);
  if (typeof state === 'string' && state.length <= 1024) callback.searchParams.set('state', state);
  callback.searchParams.set('iss', ISSUER);
  return res.set('Cache-Control', 'no-store').redirect(302, callback.toString());
}

function authorizationPage(flowId, apiKey) {
  const firebaseConfig = safeJson({ apiKey, authDomain: 'bravune-1e8ee.firebaseapp.com', projectId: 'bravune-1e8ee' });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Bravune</title><style>
  body{font:16px system-ui,sans-serif;background:#f5f6fa;color:#18202b;margin:0;display:grid;min-height:100vh;place-items:center}.card{background:white;width:min(440px,calc(100% - 40px));box-sizing:border-box;padding:32px;border-radius:16px;box-shadow:0 8px 32px #10182816}h1{font-size:24px;margin:0 0 8px}p{color:#5b6472;line-height:1.5}.row{display:grid;gap:12px;margin-top:22px}input,button{font:inherit;padding:12px;border:1px solid #ccd2dc;border-radius:8px}button{cursor:pointer;background:#202a44;color:white;border:0;font-weight:600}button.secondary{background:white;color:#202a44;border:1px solid #ccd2dc}button:disabled{opacity:.55;cursor:wait}.muted{font-size:13px}.error{color:#a52222;min-height:20px}#consent{display:none}#login{margin-top:20px}.link{background:none;color:#202a44;text-decoration:underline;padding:4px}
  </style></head><body><main class="card"><h1>Connect Bravune</h1><p id="intro">Sign in with your Bravune account to continue to ChatGPT. Your profile, CVs, jobs, and applications will be available to the connected assistant.</p>
  <section id="login"><form id="email-form" class="row"><input id="email" type="email" autocomplete="username" placeholder="Email" required><input id="password" type="password" autocomplete="current-password" placeholder="Password" required><button id="email-submit" type="submit">Sign in</button></form><p class="muted"><span id="mode-hint">New to Bravune?</span> <button id="mode-toggle" class="link" type="button">Create account</button></p><div class="row"><button id="google" class="secondary" type="button">Continue with Google</button></div></section>
  <section id="consent"><p id="account"></p><p id="client"></p><p>By continuing, you allow this assistant to read and update your Bravune profile, CVs, job records, and application records. Existing Free/Pro limits still apply.</p><div class="row"><button id="approve" type="button">Approve and connect</button><button id="deny" class="secondary" type="button">Cancel</button></div></section><p id="error" class="error" role="alert"></p><p class="muted">Sign-in is handled by Firebase Authentication. Bravune receives only the verified account identity.</p></main>
  <script type="module">
  import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
  import {getAuth,signInWithEmailAndPassword,createUserWithEmailAndPassword,GoogleAuthProvider,signInWithPopup} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
  const flowId=${safeJson(flowId)}, auth=getAuth(initializeApp(${firebaseConfig}));
  const error=document.querySelector('#error'), login=document.querySelector('#login'), consent=document.querySelector('#consent');
  let createAccount=false;
  document.querySelector('#mode-toggle').addEventListener('click',()=>{createAccount=!createAccount;document.querySelector('#email-submit').textContent=createAccount?'Create account':'Sign in';document.querySelector('#mode-hint').textContent=createAccount?'Already have an account?':'New to Bravune?';document.querySelector('#mode-toggle').textContent=createAccount?'Sign in':'Create account';document.querySelector('#password').autocomplete=createAccount?'new-password':'current-password';error.textContent='';});
  async function signedIn(result){error.textContent='';const idToken=await result.user.getIdToken();const r=await fetch('/oauth/firebase-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({flowId,firebaseIdToken:idToken})});const data=await r.json();if(!r.ok)throw new Error(data.error_description||'Could not verify Bravune account.');document.querySelector('#account').textContent='Signed in as '+(data.email||'Bravune account');document.querySelector('#client').textContent='Connect '+data.clientName+' to Bravune?';login.hidden=true;consent.style.display='block';}
  document.querySelector('#email-form').addEventListener('submit',async e=>{e.preventDefault();try{const email=document.querySelector('#email').value,password=document.querySelector('#password').value;await signedIn(await (createAccount?createUserWithEmailAndPassword(auth,email,password):signInWithEmailAndPassword(auth,email,password)));}catch(err){error.textContent=err.message||'Sign-in failed.';}});
  document.querySelector('#google').addEventListener('click',async()=>{try{await signedIn(await signInWithPopup(auth,new GoogleAuthProvider()));}catch(err){error.textContent=err.message||'Google sign-in failed.';}});
  async function decision(path,clickEvent){const button=clickEvent.currentTarget;button.disabled=true;try{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({flowId})});const data=await r.json();if(!r.ok)throw new Error(data.error_description||'Request failed.');location.assign(data.redirectTo);}catch(err){error.textContent=err.message||'Request failed.';button.disabled=false;}}
  document.querySelector('#approve').addEventListener('click',e=>decision('/oauth/approve',e));
  document.querySelector('#deny').addEventListener('click',e=>decision('/oauth/deny',e));
  </script></body></html>`;
}

function createOAuthRouter({ db, auth, getFirebaseWebApiKey }) {
  const router = express.Router();
  const sessions = db.collection('oauthLoginSessions');
  const codes = db.collection('oauthAuthorizationCodes');
  const tokens = db.collection('oauthAccessTokens');
  const refreshTokens = db.collection('oauthRefreshTokens');
  const clients = db.collection('oauthClients');

  router.get('/.well-known/oauth-protected-resource', (_req, res) => res.json({
    resource: RESOURCE,
    authorization_servers: [ISSUER],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_documentation: `${ISSUER}/mcp`,
  }));

  router.get('/.well-known/oauth-authorization-server', (_req, res) => res.json({
    issuer: ISSUER,
    authorization_response_iss_parameter_supported: true,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`,
    registration_endpoint: `${ISSUER}/oauth/register`,
    revocation_endpoint: `${ISSUER}/oauth/revoke`,
    grant_types_supported: ['authorization_code', 'refresh_token'],
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
    scopes_supported: [SCOPE, OFFLINE_SCOPE],
    revocation_endpoint_auth_methods_supported: ['none'],
  }));

  router.post('/oauth/register', async (req, res) => {
    const body = req.body || {};
    if (!Array.isArray(body.redirect_uris) || !body.redirect_uris.length || body.redirect_uris.length > 10 ||
        !body.redirect_uris.every(uri => typeof uri === 'string' && validChatGPTRedirect(uri)) ||
        (body.grant_types && (!Array.isArray(body.grant_types) || body.grant_types.some(x => !['authorization_code', 'refresh_token'].includes(x)))) ||
        (body.response_types && (!Array.isArray(body.response_types) || body.response_types.some(x => x !== 'code'))) ||
        (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== 'none')) {
      return jsonError(res, 400, 'invalid_client_metadata', 'Only HTTPS ChatGPT or Claude MCP callback URIs and the public authorization_code flow are supported.');
    }
    const clientId = randomBytes(32).toString('base64url');
    const client = {
      clientName: String(body.client_name || 'ChatGPT').slice(0, 120),
      redirectUris: body.redirect_uris,
      createdAt: new Date(),
    };
    await clients.doc(clientId).create(client);
    console.info('[oauth-debug]', JSON.stringify({
      event: 'oauth.register.success',
      client_id: clientId,
      redirect_uris: body.redirect_uris.map(uri => diagnosticValue(uri)),
      client_name: diagnosticValue(client.clientName, 120),
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }));
    return res.status(201).set('Cache-Control', 'no-store').json({
      client_id: clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  });

  router.get('/oauth/authorize', async (req, res) => {
    const { client_id: clientId, redirect_uri: redirectUri, response_type: responseType, state, code_challenge: challenge, code_challenge_method: challengeMethod, resource, scope } = req.query;
    const clientIdType = oauthClientIdType(clientId);
    console.info('[oauth-debug]', JSON.stringify({
      event: 'oauth.authorize.request',
      client_id: diagnosticValue(clientId, 2048),
      redirect_uri: diagnosticValue(redirectUri),
      response_type: diagnosticValue(responseType, 80),
      scope: diagnosticValue(scope, 512),
      resource: diagnosticValue(resource, 512),
      code_challenge_method: diagnosticValue(challengeMethod, 40),
      client_id_type: clientIdType,
    }));
    const scopes = requestedScopes(scope);
    if (typeof clientId !== 'string' || typeof redirectUri !== 'string') return jsonError(res, 400, 'invalid_request', 'A client ID and redirect URI are required.');

    let client;
    try { client = await resolveClient(db, clientId); }
    catch (error) {
      const reason = error instanceof Error ? diagnosticValue(error.message, 200) : 'Unknown client resolution error.';
      console.warn('[oauth-debug]', JSON.stringify({
        event: 'oauth.authorize.client_resolution_failed',
        client_id: diagnosticValue(clientId, 2048),
        client_id_type: clientIdType,
        reason,
      }));
      return jsonError(res, 400, 'invalid_client', 'The OAuth client could not be verified.');
    }
    if (!client.redirectUris.includes(redirectUri) || !validChatGPTRedirect(redirectUri)) return jsonError(res, 400, 'invalid_request', 'The redirect URI is not registered for this OAuth client.');

    if (responseType !== 'code') return authorizationError(res, redirectUri, state, 'unsupported_response_type', 'Only the authorization code response type is supported.');
    if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || challengeMethod !== 'S256') return authorizationError(res, redirectUri, state, 'invalid_request', 'PKCE with the S256 code challenge method is required.');
    if (resource !== RESOURCE) return authorizationError(res, redirectUri, state, 'invalid_target', 'The requested MCP resource does not match Bravune.');
    if (!scopes) return authorizationError(res, redirectUri, state, 'invalid_scope', 'One or more requested scopes are not supported.');
    if (typeof state !== 'string' || !state || state.length > 1024) return authorizationError(res, redirectUri, state, 'invalid_request', 'A valid OAuth state value is required.');

    const flowId = randomValue('flow_');
    const record = {
      clientId,
      clientName: client.clientName,
      redirectUri,
      state,
      codeChallenge: challenge,
      resource: RESOURCE,
      scope: scopes.join(' '),
      expiresAt: Date.now() + LOGIN_SESSION_TTL_MS,
      createdAt: new Date(),
    };
    await sessions.doc(hash(flowId)).create(record);
    const firebaseApiKey = getFirebaseWebApiKey();
    if (!firebaseApiKey) {
      await sessions.doc(hash(flowId)).delete();
      return res.status(503).send('Firebase Authentication web API key is not configured.');
    }
    res.set({
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline' https://www.gstatic.com; style-src 'unsafe-inline'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://*.googleapis.com https://*.firebaseapp.com; frame-src https://*.firebaseapp.com https://accounts.google.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    }).type('html').send(authorizationPage(flowId, firebaseApiKey));
  });

  router.post('/oauth/firebase-session', async (req, res) => {
    const { flowId, firebaseIdToken } = req.body || {};
    if (typeof flowId !== 'string' || !/^flow_[A-Za-z0-9_-]{40,60}$/.test(flowId) || typeof firebaseIdToken !== 'string' || firebaseIdToken.length > 8192) {
      return jsonError(res, 400, 'invalid_request', 'A valid login session and Firebase ID token are required.');
    }
    const ref = sessions.doc(hash(flowId));
    const snapshot = await ref.get();
    if (!snapshot.exists || snapshot.data().expiresAt <= Date.now()) {
      if (snapshot.exists) await ref.delete();
      return jsonError(res, 400, 'invalid_request', 'The login session expired. Restart the connection flow.');
    }
    try {
      const decoded = await auth.verifyIdToken(firebaseIdToken, true);
      if (!supportedBravuneLogin(decoded)) {
        return jsonError(res, 403, 'access_denied', 'Use a Bravune Google or email/password account to connect ChatGPT.');
      }
      const firebaseUser = await auth.getUser(decoded.uid);
      if (firebaseUser.disabled) return jsonError(res, 403, 'access_denied', 'This Firebase account is disabled.');
      await ref.update({ uid: decoded.uid, email: firebaseUser.email || decoded.email || '', authenticatedAt: Date.now() });
      return res.set('Cache-Control', 'no-store').json({ email: firebaseUser.email || decoded.email || '', clientName: snapshot.data().clientName });
    } catch {
      return jsonError(res, 401, 'invalid_token', 'Firebase could not verify this account.');
    }
  });

  router.post('/oauth/approve', async (req, res) => {
    const flowId = req.body?.flowId;
    if (typeof flowId !== 'string' || !/^flow_[A-Za-z0-9_-]{40,60}$/.test(flowId)) return jsonError(res, 400, 'invalid_request', 'The login session is invalid.');
    const flowRef = sessions.doc(hash(flowId));
    const code = randomValue('brv_code_');
    const codeRef = codes.doc(hash(code));
    try {
      const flow = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(flowRef);
        if (!snapshot.exists) throw new Error('invalid_session');
        const data = snapshot.data();
        if (data.expiresAt <= Date.now() || !data.uid || typeof data.authenticatedAt !== 'number') throw new Error('invalid_session');
        transaction.create(codeRef, {
          clientId: data.clientId,
          redirectUri: data.redirectUri,
          codeChallenge: data.codeChallenge,
          state: data.state,
          resource: data.resource,
          scope: data.scope,
          uid: data.uid,
          email: data.email || '',
          expiresAt: Date.now() + AUTH_CODE_TTL_MS,
          createdAt: new Date(),
        });
        transaction.delete(flowRef);
        return data;
      });
      const callback = new URL(flow.redirectUri);
      callback.searchParams.set('code', code);
      callback.searchParams.set('state', flow.state);
      callback.searchParams.set('iss', ISSUER);
      return res.set('Cache-Control', 'no-store').json({ redirectTo: callback.toString() });
    } catch {
      return jsonError(res, 400, 'invalid_request', 'The login session expired or has not been authenticated.');
    }
  });

  router.post('/oauth/deny', async (req, res) => {
    const flowId = req.body?.flowId;
    if (typeof flowId !== 'string' || !/^flow_[A-Za-z0-9_-]{40,60}$/.test(flowId)) return jsonError(res, 400, 'invalid_request', 'The login session is invalid.');
    const flowRef = sessions.doc(hash(flowId));
    const snapshot = await flowRef.get();
    if (!snapshot.exists || snapshot.data().expiresAt <= Date.now()) return jsonError(res, 400, 'invalid_request', 'The login session expired.');
    const data = snapshot.data();
    await flowRef.delete();
    const callback = new URL(data.redirectUri);
    callback.searchParams.set('error', 'access_denied');
    callback.searchParams.set('state', data.state);
    callback.searchParams.set('iss', ISSUER);
    return res.set('Cache-Control', 'no-store').json({ redirectTo: callback.toString() });
  });

  router.post('/oauth/token', async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    if (req.get('authorization')) return jsonError(res, 400, 'invalid_client', 'This public OAuth client does not use a client secret.');
    const { grant_type: grantType, code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, resource } = req.body || {};
    if (resource !== RESOURCE || typeof clientId !== 'string') return jsonError(res, 400, 'invalid_request', 'A registered client ID and Bravune MCP resource are required.');
    if (grantType === 'authorization_code') {
      if (typeof code !== 'string' || typeof redirectUri !== 'string' || typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
        return jsonError(res, 400, 'invalid_request', 'A valid authorization code, redirect URI, and PKCE verifier are required.');
      }
      const codeRef = codes.doc(hash(code));
      const accessToken = randomValue('brv_');
      const accessRef = tokens.doc(hash(accessToken));
      const refreshToken = randomValue('brv_refresh_');
      const refreshRef = refreshTokens.doc(hash(refreshToken));
      let refreshIssued = false;
      try {
        await db.runTransaction(async transaction => {
          const snapshot = await transaction.get(codeRef);
          if (!snapshot.exists) throw new Error('invalid_grant');
          const grant = snapshot.data();
          const challenge = createHash('sha256').update(verifier).digest('base64url');
          const challengeMatches = Buffer.byteLength(challenge) === Buffer.byteLength(grant.codeChallenge) && timingSafeEqual(Buffer.from(challenge), Buffer.from(grant.codeChallenge));
          const requested = requestedScopes(req.body?.scope || grant.scope);
          const grantScopes = grant.scope.split(/\s+/);
          if (grant.expiresAt <= Date.now() || grant.clientId !== clientId || grant.redirectUri !== redirectUri || grant.resource !== resource || !challengeMatches ||
              !requested || requested.some(scope => !grantScopes.includes(scope))) throw new Error('invalid_grant');
          const issuedScope = requested.join(' ');
          transaction.create(accessRef, {
            uid: grant.uid, email: grant.email || '', clientId, scope: issuedScope, resource: grant.resource,
            expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS), createdAt: new Date(),
          });
          if (issuedScope.split(/\s+/).includes(OFFLINE_SCOPE)) {
            transaction.create(refreshRef, {
              uid: grant.uid, email: grant.email || '', clientId, scope: issuedScope, resource: grant.resource, createdAt: new Date(),
            });
            refreshIssued = true;
          }
          transaction.delete(codeRef);
        });
        return res.json({ access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_MS / 1000, scope: refreshIssued ? `${SCOPE} ${OFFLINE_SCOPE}` : SCOPE, ...(refreshIssued ? { refresh_token: refreshToken } : {}) });
      } catch {
        return jsonError(res, 400, 'invalid_grant', 'The authorization code is invalid, expired, already used, or failed PKCE validation.');
      }
    }

    if (grantType === 'refresh_token') {
      const presentedRefresh = req.body?.refresh_token;
      if (typeof presentedRefresh !== 'string' || !presentedRefresh.startsWith('brv_refresh_')) return jsonError(res, 400, 'invalid_grant', 'The refresh token is invalid or expired.');
      const refreshRef = refreshTokens.doc(hash(presentedRefresh));
      const accessToken = randomValue('brv_');
      const nextRefreshToken = randomValue('brv_refresh_');
      const accessRef = tokens.doc(hash(accessToken));
      const nextRefreshRef = refreshTokens.doc(hash(nextRefreshToken));
      try {
        const snapshot = await refreshRef.get();
        if (!snapshot.exists) throw new Error('invalid_grant');
        const grant = snapshot.data();
        const requested = requestedScopes(req.body?.scope || grant.scope);
        const grantScopes = grant.scope.split(/\s+/);
        if (grant.clientId !== clientId || grant.resource !== resource || !requested || requested.length !== grantScopes.length || requested.some(scope => !grantScopes.includes(scope))) throw new Error('invalid_grant');
        const user = await auth.getUser(grant.uid);
        if (user.disabled) throw new Error('invalid_grant');
        await db.runTransaction(async transaction => {
          const current = await transaction.get(refreshRef);
          if (!current.exists || current.data().clientId !== clientId) throw new Error('invalid_grant');
          const rotatedGrant = { ...grant, scope: requested.join(' ') };
          transaction.create(accessRef, {
            uid: grant.uid, email: grant.email || '', clientId, scope: rotatedGrant.scope, resource: grant.resource,
            expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS), createdAt: new Date(),
          });
          transaction.create(nextRefreshRef, { ...rotatedGrant, createdAt: new Date() });
          transaction.delete(refreshRef);
        });
        return res.json({ access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_MS / 1000, scope: requested.join(' '), refresh_token: nextRefreshToken });
      } catch {
        return jsonError(res, 400, 'invalid_grant', 'The refresh token is invalid, expired, revoked, or already used.');
      }
    }

    return jsonError(res, 400, 'unsupported_grant_type', 'Only authorization_code and refresh_token grants are supported.');
  });

  router.post('/oauth/revoke', async (req, res) => {
    const token = req.body?.token;
    if (typeof token === 'string' && token.length <= 256) {
      const ref = token.startsWith('brv_refresh_') ? refreshTokens.doc(hash(token)) : tokens.doc(hash(token));
      await ref.delete().catch(() => undefined);
    }
    return res.status(200).set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' }).end();
  });

  return router;
}

module.exports = { createOAuthRouter, hash, validChatGPTRedirect, validCimdUrl, readCimd, resolveClient, supportedBravuneLogin, ISSUER, RESOURCE, SCOPE };
