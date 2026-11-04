/*
 * Firebase glue for the Appointment Assistant: sign-in and the trial/licence record.
 * Loaded after the firebase-*-compat.js vendor files and firebase-config.js, so `firebase` and
 * window.APPT_FIREBASE_CONFIG exist. No DOM here — login.js and dashboard.js drive the UI.
 *
 * The licence lives in Firestore at apptLicenses/<uid>, in its OWN collection, separate from
 * VisaGuard's data. The rules let a client create its trial once but never mark itself paid or
 * un-block itself, so the 14-day limit and the pay-block are enforced on the server, not just here.
 */
;(function (root) {
  "use strict";

  var cfg = root.APPT_FIREBASE_CONFIG || {};
  var configured = cfg.apiKey && cfg.apiKey.indexOf("PASTE_") !== 0;

  function ready() {
    if (!configured) throw new Error("Firebase is not configured yet. Fill in firebase-config.js.");
    if (!root.firebase) throw new Error("Firebase SDK did not load.");
    if (!firebase.apps.length) firebase.initializeApp(cfg);
  }

  var Auth = {
    isConfigured: function () { return !!configured; },
    init: function () { ready(); },
    onUser: function (cb) { ready(); return firebase.auth().onAuthStateChanged(cb); },
    currentUser: function () { return root.firebase && firebase.apps.length ? firebase.auth().currentUser : null; },
    signIn: function (email, password) { ready(); return firebase.auth().signInWithEmailAndPassword(String(email).trim(), String(password)); },
    signOut: function () { ready(); return firebase.auth().signOut(); },
    resetPassword: function (email) { ready(); return firebase.auth().sendPasswordResetEmail(String(email).trim()); },
  };

  // Read the licence; if the account has none yet, start its 14-day trial (allowed once by the rules).
  // Returns a plain record { status, trialStartMs } that ApptCore.licenseState() can judge.
  function ensureAndGet(user) {
    ready();
    var db = firebase.firestore();
    var ref = db.collection("apptLicenses").doc(user.uid);
    function toRecord(snap) {
      if (!snap.exists) return { status: "none", trialStartMs: null };
      var d = snap.data() || {};
      var ms = d.trialStart && typeof d.trialStart.toMillis === "function" ? d.trialStart.toMillis() : null;
      return { status: d.status || "none", trialStartMs: ms };
    }
    return ref.get().then(function (snap) {
      if (snap.exists) return toRecord(snap);
      // No record yet → begin the trial. serverTimestamp() means the clock is the server's, not the PC's.
      return ref.set({
        status: "trial",
        trialStart: firebase.firestore.FieldValue.serverTimestamp(),
        email: user.email || "",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      }).then(function () {
        return ref.get({ source: "server" }).then(toRecord);
      });
    });
  }

  var License = {
    ensureAndGet: ensureAndGet,
    stateFor: function (record) { return root.ApptCore.licenseState(record, Date.now(), root.APPT_TRIAL_DAYS); },
  };

  root.ApptAuth = Auth;
  root.ApptLicense = License;
})(typeof globalThis !== "undefined" ? globalThis : this);
