# Architecture

## Inventory and implementation order

The repository was empty at inspection. There was no application code, configuration, documentation, or existing behavior to preserve. Implementation order: (1) workspace and shared types/validation, (2) repository contracts and Firebase adapters, (3) authentication/access control and REST API, (4) MCP connector, (5) Firebase rules and operational docs, (6) targeted validation/build checks. The implementation follows that sequence.

## Request flow

```text
User
 ↓
ChatGPT / Claude
 ↓
AI extracts structured information when necessary
 ↓
Bravune Connector
 ↓
Bravune API
 ↓
Authentication / Authorization
 ↓
Validation
 ↓
Business Services
 ↓
Repository Interfaces
 ↓
Firebase / Firestore
```

The assistant supplies structured career information. Bravune validates, stores, organizes, updates, and returns it. Bravune does not read PDF/DOCX files, perform OCR, or call an AI model to extract CV information. Controllers/services use repository contracts; Firebase Admin implementations are isolated under `apps/api/src/repositories/firebase` to permit a future database adapter.

## Boundaries

The API verifies Firebase ID tokens. The verified UID is the only customer key used by repositories. Firestore client rules deny direct access; server access uses Admin SDK after API authorization. Subscription lookup and free plan limits are centralized in `AccessService`. Payment processing is represented by stored subscription state only; no payment provider is integrated.
