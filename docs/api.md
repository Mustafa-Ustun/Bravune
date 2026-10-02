# REST API

All `/v1` endpoints require `Authorization: Bearer <Firebase ID token>`. Customer ownership always comes from the verified token. JSON responses use `{ "data": ... }`; errors use `{ "error": { "code", "message", "details?" } }`.

| Area | Endpoints |
|---|---|
| Customer/access | `GET /v1/me` |
| Career profile | `GET /v1/profile`, `PATCH /v1/profile` |
| Skills, experience, education, projects, certifications | `GET/POST /v1/{collection}`, `PATCH/DELETE /v1/{collection}/:id` |
| CVs | `GET/POST /v1/cvs`, `GET/PATCH /v1/cvs/:id`, `POST /v1/cvs/:id/versions`, `GET /v1/cvs/:id/versions[/:versionId]` |
| Jobs | `GET/POST /v1/jobs`, `GET/PATCH/DELETE /v1/jobs/:id` |
| Applications | `GET/POST /v1/applications`, `GET/PATCH /v1/applications/:id`, `POST /v1/applications/:id/status`, `GET /v1/applications/:id/history` |

External values are validated with shared Zod schemas. Accessing a document through another customer's UID is not possible through request parameters: repository paths are always constructed from verified identity.
