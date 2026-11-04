/* Login page logic: sign in with Firebase, then send the staff to the dashboard. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var msg = $("msg");
  function show(kind, text) { msg.className = "msg " + kind; msg.textContent = text; }
  function clear() { msg.className = "msg"; msg.textContent = ""; }

  if (!window.ApptAuth || !ApptAuth.isConfigured()) {
    $("submit").disabled = true;
    show("err", "Not set up yet: paste your Firebase keys into firebase-config.js.");
    return;
  }

  // Already signed in? Go straight to the dashboard.
  ApptAuth.onUser(function (user) { if (user) location.replace("dashboard.html"); });

  function friendly(err) {
    var code = (err && err.code) || "";
    if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(code)) return "Email or password is incorrect.";
    if (/too-many-requests/.test(code)) return "Too many attempts. Wait a few minutes or reset your password.";
    if (/network-request-failed/.test(code)) return "No internet connection. Sign-in needs to be online.";
    if (/user-disabled/.test(code)) return "This account has been disabled. Contact your provider.";
    return (err && err.message) || "Sign-in failed. Please try again.";
  }

  $("form").addEventListener("submit", function (e) {
    e.preventDefault();
    clear();
    $("submit").disabled = true;
    $("submit").textContent = "Signing in…";
    ApptAuth.signIn($("email").value, $("password").value)
      .then(function () { location.replace("dashboard.html"); })
      .catch(function (err) {
        show("err", friendly(err));
        $("submit").disabled = false;
        $("submit").textContent = "Sign in";
      });
  });

  $("forgot").addEventListener("click", function () {
    clear();
    var email = $("email").value.trim();
    if (!email) { show("err", "Type your email first, then click “Forgot password?”."); return; }
    ApptAuth.resetPassword(email)
      .then(function () { show("ok", "If this email has an account, a reset link has been sent. Check spam too."); })
      .catch(function () { show("ok", "If this email has an account, a reset link has been sent. Check spam too."); });
  });
})();
