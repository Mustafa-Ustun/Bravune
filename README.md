# Bravune

Bravune is your persistent career data and workflow layer for AI assistants. It stores and manages structured career profiles, multiple CV representations and versions, jobs, applications, and application status history. The assistant is responsible for understanding documents and sending structured information; Bravune does not read or parse PDF/DOCX files, perform OCR, or analyze uploaded CVs.

## Stack

TypeScript, Node.js, Express REST API, Firebase Authentication, Firestore, shared Zod validation, and an MCP stdio connector. Business logic is separated from Firebase behind repository interfaces. No payment integration is included; subscription records and centralized free-plan limits are supported.

## Run

Copy `.env.example` to `.env`, configure Firebase Application Default Credentials and project ID, then run `npm install`, `npm run build`, and `npm run dev:api`. Configure the connector with `API_BASE_URL` and a valid customer-scoped Firebase ID token before running `npm run dev:connector`.

## Documentation

- [Architecture](docs/architecture.md)
- [Data model](docs/data-model.md)
- [REST API](docs/api.md)
- [Connector](docs/connector.md)
- [Firebase setup](docs/firebase-setup.md)

See [`.env.example`](.env.example) for configuration. Never commit Firebase secrets.
