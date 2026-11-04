// Run: node --test   (from the appointment-assistant folder). No dependencies.
const test = require("node:test");
const assert = require("node:assert");
const C = require("../core.js");

test("parses a JSON array and fills a derived full name", () => {
  const { students, error } = C.parseStudents('[{"givenNames":"Ali","surname":"Khan","passport no":"AB123456"}]');
  assert.equal(error, null);
  assert.equal(students.length, 1);
  assert.equal(students[0].fullName, "Ali Khan");
  assert.equal(students[0].passportNumber, "AB123456");
  assert.ok(students[0].id);
});

test("parses CSV with a header row and mixed column names", () => {
  const csv = 'Full Name,Passport Number,Date of Birth,Email\n"Khan, Ayesha",CD987654,2001-05-09,a@x.com';
  const { students, error } = C.parseStudents(csv);
  assert.equal(error, null);
  assert.equal(students.length, 1);
  assert.equal(students[0].fullName, "Khan, Ayesha"); // comma preserved inside quotes
  assert.equal(students[0].passportNumber, "CD987654");
  assert.equal(students[0].dob, "2001-05-09");
  assert.equal(students[0].email, "a@x.com");
});

test("reports a helpful error for broken JSON", () => {
  const { error } = C.parseStudents('[{"name": }]');
  assert.match(error, /could not be read/);
});

test("booking sheet lists only filled fields, with labels", () => {
  const s = Object.assign(C.blankStudent(), { fullName: "Ali Khan", passportNumber: "AB1", email: "" });
  const sheet = C.bookingSheet(s);
  const fields = sheet.map((r) => r.field);
  assert.ok(fields.includes("fullName"));
  assert.ok(fields.includes("passportNumber"));
  assert.ok(!fields.includes("email")); // empty -> omitted
  assert.equal(sheet.find((r) => r.field === "fullName").label, "Full name (as per passport)");
});

test("readiness flags what is missing before booking", () => {
  const s = C.blankStudent();
  let r = C.readiness(s);
  assert.equal(r.ready, false);
  assert.ok(r.missing.length >= 4);
  Object.assign(s, { passportNumber: "AB1", dob: "2000-01-01", email: "a@x.com", phone: "03001234567", photoReady: true, docsReady: true });
  r = C.readiness(s);
  assert.equal(r.ready, true);
  assert.equal(r.missing.length, 0);
});

test("reminders split overdue and upcoming, and ignore attended", () => {
  const mk = (date, status) => Object.assign(C.blankStudent(), { appointmentDate: date, appointmentStatus: status || "Booked" });
  const students = [mk("2026-11-02"), mk("2026-11-07"), mk("2026-12-30"), mk("2026-11-01", "Attended")];
  const r = C.reminders(students, "2026-11-05");
  assert.equal(r.overdue.length, 1); // only 11-02 (11-01 is attended)
  assert.equal(r.overdue[0].student.appointmentDate, "2026-11-02");
  assert.equal(r.upcoming.length, 1); // 11-07 within 7 days; 12-30 is far
  assert.equal(r.upcoming[0].student.appointmentDate, "2026-11-07");
});

test("autofill maps page fields to student data, specific before generic", () => {
  const student = Object.assign(C.blankStudent(), {
    fullName: "Ali Khan", givenNames: "Ali", surname: "Khan", passportNumber: "AB123456",
    dob: "2000-01-01", email: "a@x.com", phone: "03001234567", nationality: "Pakistani",
  });
  const fields = [
    { label: "Given Name", name: "firstName" },
    { label: "Surname", name: "lastName" },
    { label: "Passport Number", name: "passport_no" },
    { label: "Date of Birth", name: "dob" },
    { label: "Email Address", name: "email" },
    { label: "Mobile Number", name: "mobile" },
    { label: "Nationality", name: "nationality" },
    { label: "Search flights", name: "q" }, // unrelated -> must stay untouched
  ];
  const plan = C.planAutofill(fields, student);
  const byIndex = Object.fromEntries(plan.map((p) => [p.index, p.field]));
  assert.equal(byIndex[0], "givenNames");
  assert.equal(byIndex[1], "surname");
  assert.equal(byIndex[2], "passportNumber");
  assert.equal(byIndex[3], "dob");
  assert.equal(byIndex[4], "email");
  assert.equal(byIndex[5], "phone");
  assert.equal(byIndex[6], "nationality");
  assert.equal(byIndex[7], undefined); // unrelated field not filled
  assert.ok(!plan.some((p) => p.field === "fullName")); // given+surname matched, generic name not forced
});

test("autofill never fills a field the student has no value for", () => {
  const student = Object.assign(C.blankStudent(), { email: "a@x.com" });
  const plan = C.planAutofill([{ label: "Passport Number", name: "pp" }, { label: "Email", name: "em" }], student);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].field, "email");
});

// --- Licence / trial gating ---
const DAY = 86400000;

test("new paid account is active forever", () => {
  const s = C.licenseState({ status: "paid", trialStartMs: null }, Date.now());
  assert.equal(s.active, true);
  assert.equal(s.status, "paid");
});

test("fresh trial is active with 14 days left", () => {
  const now = 1_700_000_000_000;
  const s = C.licenseState({ status: "trial", trialStartMs: now }, now);
  assert.equal(s.active, true);
  assert.equal(s.daysLeft, 14);
});

test("trial on day 13 is still active with 1 day left", () => {
  const start = 1_700_000_000_000;
  const s = C.licenseState({ status: "trial", trialStartMs: start }, start + 13 * DAY);
  assert.equal(s.active, true);
  assert.equal(s.daysLeft, 1);
});

test("trial past 14 days is blocked and expired", () => {
  const start = 1_700_000_000_000;
  const s = C.licenseState({ status: "trial", trialStartMs: start }, start + 14 * DAY + 1000);
  assert.equal(s.active, false);
  assert.equal(s.reason, "trial-expired");
});

test("blocked account is never active, even within the trial window", () => {
  const now = 1_700_000_000_000;
  const s = C.licenseState({ status: "blocked", trialStartMs: now }, now);
  assert.equal(s.active, false);
  assert.equal(s.reason, "blocked");
});

test("missing licence record is not active", () => {
  const s = C.licenseState(null, Date.now());
  assert.equal(s.active, false);
  assert.equal(s.reason, "no-trial");
});
