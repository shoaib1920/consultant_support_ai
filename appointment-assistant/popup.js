/* Extension popup: pick a student, then fill the form on the tab the staff already has open. */
(function () {
  "use strict";
  var Store = window.ApptStore;
  var students = [];
  var selectedId = null;
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

  function render() {
    var q = ($("search").value || "").toLowerCase().trim();
    var list = students.filter(function (s) { return !q || (s.fullName + " " + s.passportNumber).toLowerCase().indexOf(q) !== -1; });
    if (!students.length) { $("list").innerHTML = '<div class="empty">No students yet.<br>Open the dashboard to add some.</div>'; return; }
    if (!list.length) { $("list").innerHTML = '<div class="empty">No match.</div>'; return; }
    $("list").innerHTML = list.map(function (s) {
      return '<div class="item' + (s.id === selectedId ? " sel" : "") + '" data-id="' + s.id + '"><div class="nm">' + esc(s.fullName || "Unnamed") + '</div><div class="pp">' + esc(s.passportNumber || "") + "</div></div>";
    }).join("");
  }

  $("list").addEventListener("click", function (e) {
    var item = e.target.closest(".item");
    if (!item) return;
    selectedId = item.dataset.id;
    $("fillBtn").disabled = false;
    render();
  });
  $("search").addEventListener("input", render);

  $("openBtn").addEventListener("click", function () {
    if (chrome.tabs && chrome.runtime) chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  });

  $("fillBtn").addEventListener("click", function () {
    var student = students.find(function (s) { return s.id === selectedId; });
    if (!student) return;
    $("msg").textContent = "Filling…";
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab || !tab.id || /^(chrome|edge|about|chrome-extension):/.test(tab.url || "")) {
        $("msg").textContent = "Open the official form in a normal tab first.";
        return;
      }
      // Inject the shared logic, then the fill routine, then run it with this student.
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["core.js", "content-fill.js"] }, function () {
        if (chrome.runtime.lastError) { $("msg").textContent = "Can't run on this page."; return; }
        chrome.scripting.executeScript({ target: { tabId: tab.id }, func: function (s) { return window.__apptFill(s); }, args: [student] }, function (res) {
          if (chrome.runtime.lastError) { $("msg").textContent = "Can't run on this page."; return; }
          var n = res && res[0] && res[0].result != null ? res[0].result : 0;
          $("msg").textContent = n > 0 ? ("Filled " + n + " field(s). Review and book yourself.") : "No matching fields found on this page.";
        });
      });
    });
  });

  Store.getStudents().then(function (list) { students = list; render(); });
})();
