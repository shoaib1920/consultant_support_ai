/*
 * Appointment Assistant — core logic (no DOM, no storage, no network).
 * Shared by the web dashboard, the extension popup, the page-fill script, and the tests.
 *
 * What this tool does: it keeps the student data in one place and, when a staff member has
 * opened an official form themselves, fills the visible fields so they don't retype.
 * What it never does: it does not book, submit, click "next", poll for slots, open tabs by
 * itself, or bypass any check. A human reviews and books. Filling a field is all this does.
 */
;(function (root) {
  "use strict";

  // Canonical fields we store for each student and can fill into a form.
  var CANON = ["fullName", "givenNames", "surname", "passportNumber", "passportExpiry", "dob", "nationality", "gender", "email", "phone", "address", "city"];

  var LABELS = {
    fullName: "Full name (as per passport)",
    givenNames: "Given name(s)",
    surname: "Surname / family name",
    passportNumber: "Passport number",
    passportExpiry: "Passport expiry (YYYY-MM-DD)",
    dob: "Date of birth (YYYY-MM-DD)",
    nationality: "Nationality",
    gender: "Gender",
    email: "Email",
    phone: "Phone",
    address: "Address",
    city: "City",
  };

  // Words that, in an imported file's column/key, mean this canonical field.
  var KEY_SYNONYMS = {
    fullName: ["fullname", "name", "applicantname", "studentname", "nameasperpassport"],
    givenNames: ["givenname", "givennames", "firstname", "forename", "given"],
    surname: ["surname", "lastname", "familyname"],
    passportNumber: ["passportnumber", "passportno", "passport", "documentnumber", "docnumber"],
    passportExpiry: ["passportexpiry", "expiry", "expirydate", "dateofexpiry", "validuntil"],
    dob: ["dob", "dateofbirth", "birthdate", "birth"],
    nationality: ["nationality", "citizenship"],
    gender: ["gender", "sex"],
    email: ["email", "emailaddress", "mail"],
    phone: ["phone", "mobile", "mobileno", "contact", "contactnumber", "telephone", "cell"],
    address: ["address", "street", "addressline"],
    city: ["city", "town"],
  };

  // Words that, in a live form field's name/id/label/placeholder, mean this canonical field.
  // Order matters: more specific fields are matched before generic ones.
  var FIELD_SYNONYMS = {
    givenNames: ["given name", "givenname", "first name", "firstname", "forename"],
    surname: ["surname", "last name", "lastname", "family name", "familyname"],
    passportNumber: ["passport number", "passport no", "passportnumber", "passport #", "document number", "documentnumber"],
    passportExpiry: ["passport expiry", "expiry date", "date of expiry", "valid until", "expirydate"],
    dob: ["date of birth", "dateofbirth", "birth date", "birthdate", "dob"],
    nationality: ["nationality", "citizenship"],
    gender: ["gender", "sex"],
    email: ["email", "e-mail", "mail address"],
    phone: ["phone", "mobile", "contact number", "telephone", "cell"],
    address: ["address", "street"],
    city: ["city", "town"],
    // fullName last and only on strong phrases, so a bare "name" doesn't grab it wrongly.
    fullName: ["full name", "fullname", "applicant name", "name as per passport", "name on passport"],
  };

  var MATCH_ORDER = ["givenNames", "surname", "passportNumber", "passportExpiry", "dob", "nationality", "gender", "email", "phone", "address", "city", "fullName"];

  var APPT_TYPES = ["Biometrics (VFS)", "Visa interview (embassy)", "Campus France interview", "Document submission", "Other"];
  var APPT_STATUS = ["To book", "Booked", "Attended", "Rescheduled", "Cancelled"];

  function uid() {
    try {
      if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) {}
    return "s_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function squash(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function normalizeKey(key) {
    var k = squash(key);
    for (var i = 0; i < CANON.length; i++) {
      var field = CANON[i];
      var syns = KEY_SYNONYMS[field];
      for (var j = 0; j < syns.length; j++) {
        if (k === syns[j]) return field;
      }
    }
    // looser contains match, longest synonym first
    for (var a = 0; a < CANON.length; a++) {
      var f2 = CANON[a];
      var ss = KEY_SYNONYMS[f2].slice().sort(function (x, y) { return y.length - x.length; });
      for (var b = 0; b < ss.length; b++) {
        if (k.indexOf(ss[b]) !== -1) return f2;
      }
    }
    return null;
  }

  function blankStudent() {
    return {
      id: uid(), fullName: "", givenNames: "", surname: "", passportNumber: "", passportExpiry: "",
      dob: "", nationality: "", gender: "", email: "", phone: "", address: "", city: "",
      appointmentType: APPT_TYPES[0], appointmentStatus: APPT_STATUS[0], appointmentDate: "", appointmentTime: "",
      location: "", referenceNo: "", photoReady: false, docsReady: false, feePaid: false, notes: "",
    };
  }

  function coerceStudent(obj) {
    var s = blankStudent();
    Object.keys(obj || {}).forEach(function (rawKey) {
      var val = obj[rawKey];
      // pass through fields that are already canonical / state fields
      if (s.hasOwnProperty(rawKey) && rawKey !== "id") {
        if (typeof s[rawKey] === "boolean") s[rawKey] = val === true || val === "true" || val === 1 || val === "1" || val === "yes";
        else s[rawKey] = val == null ? "" : String(val).trim();
        return;
      }
      var field = normalizeKey(rawKey);
      if (field && !s[field]) s[field] = val == null ? "" : String(val).trim();
    });
    if (!s.fullName && (s.givenNames || s.surname)) s.fullName = (s.givenNames + " " + s.surname).trim();
    return s;
  }

  // Minimal but correct CSV: handles quoted fields and escaped quotes.
  function csvToRows(text) {
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;
    var s = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ""; }); });
  }

  // Accepts a JSON array, a single JSON object, or CSV with a header row.
  function parseStudents(text) {
    var t = String(text || "").trim();
    if (!t) return { students: [], error: "Nothing to import." };
    if (t[0] === "[" || t[0] === "{") {
      try {
        var data = JSON.parse(t);
        var arr = Array.isArray(data) ? data : [data];
        return { students: arr.map(coerceStudent), error: null };
      } catch (e) {
        return { students: [], error: "That looks like JSON but could not be read: " + e.message };
      }
    }
    var rows = csvToRows(t);
    if (rows.length < 2) return { students: [], error: "CSV needs a header row and at least one student row." };
    var headers = rows[0];
    var out = [];
    for (var r = 1; r < rows.length; r++) {
      var obj = {};
      for (var c = 0; c < headers.length; c++) obj[headers[c]] = rows[r][c];
      out.push(coerceStudent(obj));
    }
    return { students: out, error: null };
  }

  function bookingSheet(student) {
    return CANON.filter(function (f) { return student[f]; }).map(function (f) {
      return { field: f, label: LABELS[f], value: student[f] };
    });
  }

  function readiness(student) {
    var items = [
      { key: "passportNumber", label: "Passport number entered", ok: !!student.passportNumber, required: true },
      { key: "dob", label: "Date of birth entered", ok: !!student.dob, required: true },
      { key: "email", label: "Email entered", ok: !!student.email, required: true },
      { key: "phone", label: "Phone entered", ok: !!student.phone, required: true },
      { key: "photoReady", label: "Photo ready (meets embassy spec)", ok: !!student.photoReady, required: true },
      { key: "docsReady", label: "Documents ready", ok: !!student.docsReady, required: true },
      { key: "feePaid", label: "Fee arranged", ok: !!student.feePaid, required: false },
    ];
    var missing = items.filter(function (i) { return i.required && !i.ok; });
    return { items: items, ready: missing.length === 0, missing: missing.map(function (i) { return i.label; }) };
  }

  function daysBetween(fromISO, toISO) {
    var a = new Date(fromISO + "T00:00:00");
    var b = new Date(toISO + "T00:00:00");
    return Math.round((b - a) / 86400000);
  }

  function reminders(students, todayISO) {
    var today = todayISO || new Date().toISOString().slice(0, 10);
    var overdue = [];
    var upcoming = [];
    (students || []).forEach(function (s) {
      if (!s.appointmentDate) return;
      var done = s.appointmentStatus === "Attended" || s.appointmentStatus === "Cancelled";
      if (done) return;
      var d = daysBetween(today, s.appointmentDate);
      if (d < 0) overdue.push({ student: s, days: d });
      else if (d <= 7) upcoming.push({ student: s, days: d });
    });
    overdue.sort(function (a, b) { return a.days - b.days; });
    upcoming.sort(function (a, b) { return a.days - b.days; });
    return { overdue: overdue, upcoming: upcoming };
  }

  // Given descriptors of the fields on the page the staff has opened, decide which to fill.
  // fields: [{ name, id, label, placeholder, aria }]. Returns [{ index, field, value, label }].
  // Never returns anything for submit/search buttons — it only maps data inputs.
  function planAutofill(fields, student) {
    var plan = [];
    var usedField = {};
    (fields || []).forEach(function (f, index) {
      var hay = squash([f.label, f.name, f.id, f.placeholder, f.aria].join(" "));
      if (!hay) return;
      for (var m = 0; m < MATCH_ORDER.length; m++) {
        var canon = MATCH_ORDER[m];
        if (usedField[canon]) continue;
        if (!student[canon]) continue;
        var syns = FIELD_SYNONYMS[canon];
        var hit = syns.some(function (syn) { return hay.indexOf(squash(syn)) !== -1; });
        if (hit) {
          plan.push({ index: index, field: canon, value: student[canon], label: LABELS[canon] });
          usedField[canon] = true;
          break;
        }
      }
    });
    return plan;
  }

  // --- Licensing / trial (pure logic; Firebase I/O lives in firebase-glue.js) ---
  var TRIAL_DAYS = 14;

  // Decide what the app may do, from a stored licence record and the current time.
  //   record: { status: "trial" | "paid" | "blocked" | null, trialStartMs: number | null }
  //   nowMs:  milliseconds since epoch (injectable so tests can set the clock)
  // Returns { active, status, daysLeft, reason } — the dashboard shows the dashboard only when active.
  function licenseState(record, nowMs, trialDays) {
    var days = trialDays || TRIAL_DAYS;
    var rec = record || {};
    var now = typeof nowMs === "number" ? nowMs : Date.now();
    var status = rec.status || "none";
    if (status === "blocked") return { active: false, status: "blocked", daysLeft: 0, reason: "blocked" };
    if (status === "paid") return { active: true, status: "paid", daysLeft: Infinity, reason: "paid" };
    if (status !== "trial" || !rec.trialStartMs) return { active: false, status: "none", daysLeft: days, reason: "no-trial" };
    var elapsedDays = (now - rec.trialStartMs) / 86400000;
    var left = Math.ceil(days - elapsedDays);
    if (left <= 0) return { active: false, status: "trial", daysLeft: 0, reason: "trial-expired" };
    return { active: true, status: "trial", daysLeft: left, reason: "trial" };
  }

  var API = {
    CANON: CANON, LABELS: LABELS, FIELD_SYNONYMS: FIELD_SYNONYMS, KEY_SYNONYMS: KEY_SYNONYMS,
    APPT_TYPES: APPT_TYPES, APPT_STATUS: APPT_STATUS, TRIAL_DAYS: TRIAL_DAYS,
    uid: uid, normalizeKey: normalizeKey, blankStudent: blankStudent, coerceStudent: coerceStudent,
    csvToRows: csvToRows, parseStudents: parseStudents, bookingSheet: bookingSheet,
    readiness: readiness, reminders: reminders, planAutofill: planAutofill, daysBetween: daysBetween,
    licenseState: licenseState,
  };

  root.ApptCore = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
