# Connector

The MCP stdio connector forwards structured assistant inputs to the Bravune REST API. Set `API_BASE_URL` and provide either a current `BRAVUNE_API_TOKEN` Firebase ID token or `FIREBASE_WEB_API_KEY` plus that user's `FIREBASE_REFRESH_TOKEN`. The connector refreshes an ID token when it expires. Keep refresh tokens in a private secret store or an ignored local `.env` file; never commit them.

For remote assistants, use the Firebase Hosting Streamable HTTP endpoint `https://bravune-1e8ee.web.app/mcp`. It uses OAuth authorization code with PKCE and Firebase Authentication for account sign-in. Discovery is available from `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`; users approve access before a Bravune-scoped token is issued. Firebase UID resolution and existing Free/Pro API checks remain in the REST API middleware.

Tools cover the profile, skills, experience, education, projects, certifications, CVs and versions, jobs, applications, application status, and status history. Tool descriptions state: “The AI assistant provides structured information to Bravune. Bravune validates, stores, organizes, and retrieves that information; it does not parse or analyze uploaded documents.” No document analysis tool exists.
