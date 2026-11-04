/* Dashboard behaviour. Pure UI + storage; all data logic lives in core.js. */
(function () {
  "use strict";
  var C = window.ApptCore;
  var Store = window.ApptStore;
  var students = [];

  var $ = function (id) { return document.getElementById(id); };
  var toastTimer;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

  function fillTypeSelect() {
    var sel = $("f_appointmentType");
    sel.innerHTML = C.APPT_TYPES.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join("");
  }

  function load() {
    Store.getStudents().then(function (list) { students = list; render(); });
  }
  function persist() { return Store.saveStudents(students); }

  function statusBadge(s) {
    var tone = s === "Attended" ? "green" : s === "Cancelled" ? "muted" : s === "Booked" ? "amber" : s === "Rescheduled" ? "amber" : "red";
    return '<span class="badge ' + tone + '">' + esc(s) + "</span>";
  }

  function render() {
    renderReminders();
    renderRows();
  }

  function renderReminders() {
    var r = C.reminders(students);
    var el = $("reminders");
    if (!r.overdue.length && !r.upcoming.length) { el.innerHTML = '<div class="empty">No overdue or upcoming appointments.</div>'; return; }
    var html = "";
    r.overdue.forEach(function (x) {
      html += '<div class="remind red"><strong>' + esc(x.student.fullName || "Unnamed") + "</strong> — overdue by " + Math.abs(x.days) + " day(s) (" + esc(x.student.appointmentDate) + ")</div>";
    });
    r.upcoming.forEach(function (x) {
      html += '<div class="remind amber"><strong>' + esc(x.student.fullName || "Unnamed") + "</strong> — in " + x.days + " day(s) (" + esc(x.student.appointmentDate) + ")</div>";
    });
    el.innerHTML = html;
  }

  function renderRows() {
    var q = ($("search").value || "").toLowerCase().trim();
    var list = students.filter(function (s) {
      if (!q) return true;
      return (s.fullName + " " + s.passportNumber).toLowerCase().indexOf(q) !== -1;
    });
    $("count").textContent = "(" + students.length + ")";
    $("emptyList").style.display = students.length ? "none" : "block";
    var tbody = $("rows");
    tbody.innerHTML = list.map(function (s) {
      var rd = C.readiness(s);
      var typeOpts = C.APPT_TYPES.map(function (t) { return '<option' + (t === s.appointmentType ? " selected" : "") + ">" + esc(t) + "</option>"; }).join("");
      var statusOpts = C.APPT_STATUS.map(function (t) { return '<option' + (t === s.appointmentStatus ? " selected" : "") + ">" + esc(t) + "</option>"; }).join("");
      return '<tr data-id="' + s.id + '">' +
        "<td><div style=\"font-weight:600\">" + esc(s.fullName || "Unnamed") + "</div><div class=\"muted\">" + esc(s.passportNumber || "") + "</div></td>" +
        '<td><select data-k="appointmentType">' + typeOpts + "</select></td>" +
        '<td><select data-k="appointmentStatus">' + statusOpts + "</select></td>" +
        '<td><input type="date" data-k="appointmentDate" value="' + esc(s.appointmentDate) + '" style="width:140px"></td>' +
        '<td><input data-k="location" value="' + esc(s.location) + '" placeholder="Centre" style="width:120px"><input data-k="referenceNo" value="' + esc(s.referenceNo) + '" placeholder="Ref no." style="width:120px;margin-top:4px"></td>' +
        "<td>" + (rd.ready ? '<span class="badge green">Ready</span>' : '<span class="badge red" title="' + esc(rd.missing.join(", ")) + '">' + rd.missing.length + " missing</span>") + "</td>" +
        '<td style="white-space:nowrap"><button class="btn subtle sm" data-act="sheet">Data sheet</button> <button class="btn danger sm" data-act="del">Delete</button></td>' +
        "</tr>";
    }).join("");
  }

  // Add student
  $("addBtn").addEventListener("click", function () {
    var s = C.blankStudent();
    ["fullName", "passportNumber", "givenNames", "surname", "nationality", "dob", "passportExpiry", "gender", "email", "phone", "city", "address", "appointmentType", "appointmentDate", "location"].forEach(function (k) {
      var el = $("f_" + k);
      if (el) s[k] = el.value.trim();
    });
    if (!s.fullName && (s.givenNames || s.surname)) s.fullName = (s.givenNames + " " + s.surname).trim();
    if (!s.fullName && !s.passportNumber) { toast("Enter at least a name or passport number."); return; }
    students.unshift(s);
    persist().then(render);
    $("clearForm").click();
    toast("Student added.");
  });
  $("clearForm").addEventListener("click", function () {
    ["fullName", "passportNumber", "givenNames", "surname", "dob", "passportExpiry", "gender", "email", "phone", "city", "address", "appointmentDate", "location"].forEach(function (k) { if ($("f_" + k)) $("f_" + k).value = ""; });
    $("f_nationality").value = "Pakistani";
  });

  // Import
  $("importBtn").addEventListener("click", function () {
    var res = C.parseStudents($("bulk").value);
    if (res.error) { $("importMsg").textContent = res.error; return; }
    if (!res.students.length) { $("importMsg").textContent = "No students found."; return; }
    students = res.students.concat(students);
    persist().then(render);
    $("importMsg").textContent = "Imported " + res.students.length + " student(s).";
    $("bulk").value = "";
    toast("Imported " + res.students.length + " student(s).");
  });
  $("sampleBtn").addEventListener("click", function () {
    $("bulk").value = "Full Name,Passport Number,Date of Birth,Nationality,Email,Phone\nAli Khan,AB1234567,2001-03-14,Pakistani,ali@example.com,03001234567\nAyesha Noor,CD7654321,2000-11-02,Pakistani,ayesha@example.com,03007654321";
  });

  // Row edits (event delegation)
  $("rows").addEventListener("change", function (e) {
    var tr = e.target.closest("tr");
    if (!tr) return;
    var s = students.find(function (x) { return x.id === tr.dataset.id; });
    if (!s) return;
    var k = e.target.dataset.k;
    if (k) { s[k] = e.target.value; persist().then(renderReminders); if (k === "appointmentDate" || k === "appointmentStatus") renderRows(); }
  });
  $("rows").addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    var tr = e.target.closest("tr");
    var s = students.find(function (x) { return x.id === tr.dataset.id; });
    if (!s) return;
    if (btn.dataset.act === "del") {
      if (!confirm("Delete " + (s.fullName || "this student") + "?")) return;
      students = students.filter(function (x) { return x.id !== s.id; });
      persist().then(render);
      toast("Deleted.");
    } else if (btn.dataset.act === "sheet") {
      openSheet(s);
    }
  });

  $("search").addEventListener("input", renderRows);

  // Export / clear
  $("exportBtn").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify(students, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "students.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("clearAll").addEventListener("click", function () {
    if (!students.length) return;
    if (!confirm("Remove all " + students.length + " students from this computer?")) return;
    students = [];
    persist().then(render);
    toast("Cleared.");
  });

  // Booking data sheet
  function openSheet(s) {
    $("sheetName").textContent = "Booking data sheet — " + (s.fullName || "Unnamed");
    var rd = C.readiness(s);
    $("readiness").innerHTML = rd.items.map(function (i) {
      return '<span class="badge ' + (i.ok ? "green" : i.required ? "red" : "muted") + '" style="margin:2px 4px 2px 0">' + (i.ok ? "✓ " : "• ") + esc(i.label) + "</span>";
    }).join("");
    var sheet = C.bookingSheet(s);
    $("sheet").innerHTML = sheet.map(function (r) {
      return '<div class="sheet-row"><div><div class="lbl">' + esc(r.label) + '</div><div class="val">' + esc(r.value) + '</div></div><button class="btn subtle sm" data-copy="' + esc(r.value) + '">Copy</button></div>';
    }).join("") || '<div class="empty">No data entered for this student yet.</div>';
    $("sheetDlg").showModal();
  }
  $("sheet").addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-copy]");
    if (!btn) return;
    copyText(btn.getAttribute("data-copy"));
  });
  $("copyAll").addEventListener("click", function () {
    var txt = Array.prototype.map.call(document.querySelectorAll("#sheet .sheet-row"), function (row) {
      return row.querySelector(".lbl").textContent + ": " + row.querySelector(".val").textContent;
    }).join("\n");
    copyText(txt);
  });
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast("Copied."); }, function () { toast("Copy failed."); });
    else { var ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); toast("Copied."); } catch (e) {} ta.remove(); }
  }
  $("sheetClose").addEventListener("click", function () { $("sheetDlg").close(); });

  fillTypeSelect();
  load();
})();
