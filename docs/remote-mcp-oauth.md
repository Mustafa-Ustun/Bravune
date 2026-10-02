# Remote MCP OAuth

Bravune's remote MCP endpoint runs as the `bravuneMcp` Firebase Function. Firebase Hosting rewrites the stable HTTPS routes to that Function so that OAuth discovery is available from the same origin without changing the API or Firestore architecture.

## Public endpoints

- MCP resource: `https://bravune-1e8ee.web.app/mcp`
- Protected resource metadata: `https://bravune-1e8ee.web.app/.well-known/oauth-protected-resource`
- Authorization server metadata: `https://bravune-1e8ee.web.app/.well-known/oauth-authorization-server`
- Authorization: `https://bravune-1e8ee.web.app/oauth/authorize`
- Token: `https://bravune-1e8ee.web.app/oauth/token`
- Dynamic client registration: `https://bravune-1e8ee.web.app/oauth/register`
- Token revocation: `https://bravune-1e8ee.web.app/oauth/revoke`

## Sign-in and authorization

The Bravune-hosted authorization page supports Google and email/password sign-in and account creation through the Firebase Authentication web SDK. The server verifies the resulting Firebase ID token and rejects anonymous or other provider identities before consent. After consent, the OAuth code is bound to the Firebase UID, which remains the Firestore `customerId`; existing customer and Free/Pro subscription records are reused.

OAuth authorization codes are single-use, short-lived, and stored by SHA-256 hash. PKCE `S256` is required. Redirect URIs are limited to the exact HTTPS callbacks published by ChatGPT and Claude. ChatGPT CIMD is fetched only from approved `chatgpt.com` metadata URL paths; DCR is also available. No OAuth client secret is issued or embedded.

Opaque OAuth access and rotating refresh tokens are stored by SHA-256 hash in Firestore. Access tokens expire after one hour. Refresh tokens rotate on every refresh and can be revoked. The MCP Function validates the OAuth token and binds it to the Firebase UID. The REST API accepts either Firebase ID tokens (existing clients) or valid Bravune OAuth tokens; both resolve to the same customer UID and existing Free/Pro checks.

The `BRAVUNE_FIREBASE_WEB_API_KEY` Firebase Functions secret supplies the Firebase web configuration to the sign-in page and is not stored in source control. The Firebase Web API key is public Firebase client configuration (not an Admin credential); OAuth client secrets and Firebase service-account credentials are never sent to the browser. OAuth code, login-session, client, access-token, and refresh-token records are held in separate Firestore collections. Firestore rules remain deny-by-default; only Admin SDK server code accesses these collections.
