/*
 * Access gate for the dashboard. Runs before the staff can use anything:
 *   1. not signed in        -> go to the login page
 *   2. signed in, licence active (trial within 14 days, or paid) -> reveal the dashboard
 *   3. trial ended / paused / no plan -> show a block screen, no dashboard
 * The licence is read from Firestore (apptLicenses/<uid>); the rules there, not this file, are what
 * actually stop a blocked or expired account, so editing the app cannot unlock it.
 */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var gate = $("gate");

  function setGate(title, text, buttons, loading) {
    $("gateSpin").style.display = loading ? "" : "none";
    $("gateTitle").textContent = title;
    $("gateText").innerHTML = text;
    var box = $("gateBtns");
    box.innerHTML = "";
    if (buttons && buttons.length) {
      box.style.display = "flex";
      buttons.forEach(function (b) {
        var el = document.createElement("button");
        el.className = "btn sm" + (b.subtle ? " subtle" : "");
        el.textContent = b.label;
        el.onclick = b.onClick;
        box.appendChild(el);
      });
    } else {
      box.style.display = "none";
    }
  }
  function openGate() { gate.style.display = "grid"; }
  function passGate() { gate.style.display = "none"; }

  // Not configured yet -> we cannot gate; say so instead of looping to the login page.
  if (!window.ApptAuth || !ApptAuth.isConfigured()) {
    openGate();
    setGate("Not set up yet", "Paste your Firebase keys into <code>firebase-config.js</code>, then reopen this page.", []);
    return;
  }

  function doSignOut() { ApptAuth.signOut().then(function () { location.replace("login.html"); }); }
  function signOutBtn() { return { label: "Sign out", subtle: true, onClick: doSignOut }; }

  function showBlocked(state) {
    var title, text;
    if (state.reason === "blocked") {
      title = "Access paused";
      text = "Your access has been paused. Please contact your provider to continue.";
    } else if (state.reason === "trial-expired") {
      title = "Free trial ended";
      text = "Your 14-day free trial is over. Please contact your provider to activate the full version.";
    } else {
      title = "No active plan";
      text = "This account doesn't have an active plan yet. Please contact your provider.";
    }
    setGate(title, text, [signOutBtn()]);
  }

  function grant(user, state) {
    $("account").style.display = "flex";
    $("accEmail").textContent = user.email || "";
    $("signOut").onclick = doSignOut;
    var pill = $("trialPill");
    if (state.status === "trial") {
      pill.style.display = "";
      pill.textContent = state.daysLeft + " day" + (state.daysLeft === 1 ? "" : "s") + " left in trial";
      pill.className = "pill" + (state.daysLeft <= 3 ? " warn" : "");
    } else {
      pill.style.display = "none";
    }
    passGate();
  }

  function check(user) {
    openGate();
    setGate("Checking your account…", "One moment.", [], true);
    ApptLicense.ensureAndGet(user).then(function (record) {
      var state = ApptLicense.stateFor(record);
      if (state.active) grant(user, state); else showBlocked(state);
    }).catch(function (err) {
      var perm = err && err.code === "permission-denied";
      setGate(
        "Can't verify your account",
        perm ? "This account isn't allowed in yet. Please contact your provider."
             : "Couldn't reach the server. Check your internet connection and try again.",
        [{ label: "Retry", onClick: function () { check(user); } }, signOutBtn()]
      );
    });
  }

  ApptAuth.onUser(function (user) {
    if (!user) { location.replace("login.html"); return; }
    check(user);
  });
})();
