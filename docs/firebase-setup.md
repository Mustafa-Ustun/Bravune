# Firebase setup

1. Create a Firebase project and enable Firebase Authentication with the identity provider used by your assistant integration.
2. Enable Firestore in production mode.
3. Give the API runtime a service account through Application Default Credentials. Never commit service-account JSON or place credentials in `.env` committed to Git.
4. Set `FIREBASE_PROJECT_ID` and `GOOGLE_APPLICATION_CREDENTIALS` (or use the hosting platform's workload identity).
5. Deploy `infrastructure/firebase/firestore.rules` and `firestore.indexes.json`.
6. Deploy the HTTP API to Firebase Functions with `firebase deploy --only functions:api`. Cloud Functions deployment requires the Blaze plan.
7. For a non-Firebase server, build with `npm run build -w @bravune/api` and start with `npm run start -w @bravune/api`. The same Express API uses Application Default Credentials and `FIREBASE_PROJECT_ID`; configure the server's service identity with access to Firestore and Firebase Authentication.
8. Run the API locally with `npm run dev:api` and the MCP stdio process with `npm run dev:connector`.

The Admin SDK bypasses Firestore rules, so all API calls authenticate first and all repository collection paths use the authenticated UID. Rules deny direct client access. Firebase Storage is not used in this MVP.
