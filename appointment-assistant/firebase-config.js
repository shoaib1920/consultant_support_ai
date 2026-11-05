/*
 * Firebase web config for the Appointment Assistant.
 *
 * This app has its OWN Firebase project (separate from VisaGuard) so the two never share users or
 * data. These five values are PUBLIC by design — Firebase ships them in client code — so it is safe
 * to put them in the .exe and the website. The Firestore rules (firestore.rules) are what protect
 * the data, not these keys. NOTE: never put a service-account JSON (admin private key) in this file.
 */
window.APPT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyApBdrRWfmXLBf4RdV3eIynieYxF6sYvO8",
  authDomain: "appointmentbookingbotconsalt.firebaseapp.com",
  projectId: "appointmentbookingbotconsalt",
  storageBucket: "appointmentbookingbotconsalt.firebasestorage.app",
  appId: "1:133378992254:web:64e7dd74cc584692c9102f",
};

// How long a brand-new account may use the app for free before paying.
window.APPT_TRIAL_DAYS = 14;
