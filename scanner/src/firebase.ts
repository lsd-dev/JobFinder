import { applicationDefault, cert, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getMessaging, type Messaging } from "firebase-admin/messaging";

export interface FirebaseHandles {
  db: Firestore;
  messaging: Messaging;
}

/**
 * Connect with the Admin SDK. Credentials, in order:
 *   1. FIRESTORE_EMULATOR_HOST set: no credentials (local emulator).
 *   2. FIREBASE_SERVICE_ACCOUNT: the service-account JSON itself (GitHub Actions secret).
 *   3. GOOGLE_APPLICATION_CREDENTIALS: path to the JSON file (local runs).
 * The key is never logged.
 */
export function connectFirebase(env: NodeJS.ProcessEnv = process.env): FirebaseHandles {
  const projectId = env.FIREBASE_PROJECT_ID;
  let app;
  if (env.FIRESTORE_EMULATOR_HOST) {
    app = initializeApp({ projectId: projectId ?? "demo-jobfinder" });
  } else if (env.FIREBASE_SERVICE_ACCOUNT) {
    let parsed: ServiceAccount;
    try {
      parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as ServiceAccount;
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON");
    }
    app = initializeApp({ credential: cert(parsed), ...(projectId ? { projectId } : {}) });
  } else if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    app = initializeApp({ credential: applicationDefault(), ...(projectId ? { projectId } : {}) });
  } else {
    throw new Error("No Firebase credentials: set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS (or use --dry-run)");
  }
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });
  return { db, messaging: getMessaging(app) };
}
