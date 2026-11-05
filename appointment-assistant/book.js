/*
 * In-app browser page of the desktop app. The staff opens the official appointment site here,
 * logs in and navigates themselves; "Fill this form" types the selected student's details into the
 * visible fields of the page that is open — the same fill the Chrome extension does. It never
 * submits, never searches for slots, and never touches a CAPTCHA, selfie or book button.
 */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var wv = $("site");
  var students = [];
  var selected = null;

  // Only reachable after login, but guard anyway: no user -> back to login.
  if (window.ApptAuth && ApptAuth.isConfigured()) {
    try { ApptAuth.onUser(function (u) { if (!u) location.replace("login.html"); }); } catch (e) {}
  }

  $("back").addEventListener("click", function () { location.href = "dashboard.html"; });

  // Student picker
  window.ApptStore.getStudents().then(function (list) {
    students = list || [];
    var sel = $("student");
    students.forEach(function (s) {
      var o = document.createElement("option");
      o.value = s.id;
      o.textContent = (s.fullName || "Unnamed") + (s.passportNumber ? " — " + s.passportNumber : "");
      sel.appendChild(o);
    });
  });
  $("student").addEventListener("change", function () {
    selected = students.find(function (s) { return s.id === $("student").value; }) || null;
    $("fill").disabled = !selected;
  });

  // Address bar + navigation
  function normalize(u) {
    u = (u || "").trim();
    if (!u) return "";
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    return u;
  }
  function go() {
    var url = normalize($("addr").value);
    if (!url) return;
    $("addr").value = url;
    try { wv.loadURL(url); } catch (e) { wv.src = url; }
  }
  $("go").addEventListener("click", go);
  $("addr").addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
  $("navBack").addEventListener("click", function () { if (wv.canGoBack && wv.canGoBack()) wv.goBack(); });
  $("navFwd").addEventListener("click", function () { if (wv.canGoForward && wv.canGoForward()) wv.goForward(); });
  $("navReload").addEventListener("click", function () { wv.reload(); });
  wv.addEventListener("did-navigate", function (e) { if (e.url && e.url !== "about:blank") $("addr").value = e.url; });
  wv.addEventListener("did-navigate-in-page", function (e) { if (e.url && e.url !== "about:blank") $("addr").value = e.url; });

  // Fill the form that is open in the embedded page
  $("fill").addEventListener("click", function () {
    if (!selected) return;
    if (!window.apptBridge || !window.apptBridge.fillScript) {
      $("status").textContent = "Fill is only available in the desktop app.";
      return;
    }
    var url = wv.getURL ? wv.getURL() : "";
    if (!/^https?:/i.test(url)) { $("status").textContent = "Open the official form first, then click Fill."; return; }
    $("status").textContent = "Filling…";
    var code = window.apptBridge.fillScript + "\n;window.__apptFill(" + JSON.stringify(selected) + ");";
    wv.executeJavaScript(code, false).then(function (n) {
      n = Number(n) || 0;
      $("status").textContent = n > 0 ? ("Filled " + n + " field(s). Review, then book yourself.") : "No matching fields found on this page.";
    }).catch(function () {
      $("status").textContent = "Couldn't fill this page (it may block scripts). Fill those fields by hand.";
    });
  });
})();
