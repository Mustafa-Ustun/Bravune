const express = require('express');
const { onRequest } = require('firebase-functions/v2/https');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { defineSecret } = require('firebase-functions/params');
const { BravuneClient } = require('../../apps/connector/dist/client/bravune-client.js');
const { createBravuneMcpServer } = require('../../apps/connector/dist/mcp.js');
const { auth, db } = require('../../apps/api/dist/config/firebase.js');
const { resolveOAuthAccessToken } = require('../../apps/api/dist/services/oauth-access-token.js');
const { createOAuthRouter } = require('./oauth.js');
const FIREBASE_WEB_API_KEY = defineSecret('BRAVUNE_FIREBASE_WEB_API_KEY');

const apiApp = require('../../apps/api/dist/app.js').app;
const mcpApp = express();
mcpApp.use(express.json({ limit: '1mb' }));
mcpApp.use(express.urlencoded({ extended: false, limit: '16kb' }));
mcpApp.use(createOAuthRouter({ db, auth, getFirebaseWebApiKey: () => FIREBASE_WEB_API_KEY.value() }));

mcpApp.all('/mcp', async (req, res) => {
  const authorization = req.get('authorization') || '';
  const resourceMetadata = 'https://bravune-1e8ee.web.app/.well-known/oauth-protected-resource';
  if (!authorization.startsWith('Bearer ')) {
    res.set('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadata}", scope="bravune"`);
    return res.status(401).json({ error: 'A Bravune OAuth access token is required.' });
  }

  const token = authorization.slice('Bearer '.length);
  let authenticated = false;
  try {
    authenticated = Boolean(await resolveOAuthAccessToken(token));
  } catch (error) {
    console.error('OAuth access-token lookup failed:', error instanceof Error ? error.message : 'Unknown error');
  }
  if (!authenticated) {
    try {
      await auth.verifyIdToken(token, true);
      authenticated = true;
    } catch {
      res.set('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadata}", scope="bravune", error="invalid_token"`);
      return res.status(401).json({ error: 'The bearer access token is invalid or expired.' });
    }
  }

  const server = createBravuneMcpServer(new BravuneClient(token, 'https://us-central1-bravune-1e8ee.cloudfunctions.net/api'));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Bravune MCP request failed:', error instanceof Error ? error.message : 'Unknown error');
    if (!res.headersSent) res.status(500).json({ error: 'MCP request failed.' });
  }
});

exports.api = onRequest({ region: 'us-central1' }, apiApp);
exports.bravuneMcp = onRequest({ region: 'us-central1', secrets: [FIREBASE_WEB_API_KEY] }, mcpApp);
