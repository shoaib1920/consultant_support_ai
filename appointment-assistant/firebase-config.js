/*
 * Firebase web config for the Appointment Assistant.
 *
 * These five values are the SAME ones VisaGuard uses (the .env.local NEXT_PUBLIC_FIREBASE_* keys).
 * They are PUBLIC by design — Firebase expects them in client code — so it is safe to ship them in
 * the .exe and the website. What actually protects your data is the Firestore rules (firestore.rules),
 * not these keys. NOTE: never put the service-account JSON (the admin private key) in this file.
 *
 * This app writes ONLY to its own collection (apptLicenses/<uid>); it never touches VisaGuard's data.
 */
window.APPT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBVZcKedJP9oY9xjRf5nRIHPN1gjv28fL0",
  authDomain: "consultantai-6a444.firebaseapp.com",
  projectId: "consultantai-6a444",
  storageBucket: "consultantai-6a444.firebasestorage.app",
  appId: "1:939931045742:web:aeef97b60c33a97ca63b7f",
};

// How long a brand-new account may use the app for free before paying.
window.APPT_TRIAL_DAYS = 14;
