// firebase-admin singleton (only loaded when FIREBASE_SERVICE_ACCOUNT_JSON is set).
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";

export function getAdminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!);
  return initializeApp({
    credential: cert(sa),
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  });
}
