/*
 * Runs in the page the staff has open, only when they click "Fill the open form".
 * It reads the visible input fields, asks core.js which ones match the student's data, and types
 * those values in. It then stops. It does NOT click any button, submit, navigate, or search — the
 * staff reviews the form and books themselves. Defined as window.__apptFill so the popup can call it.
 */
window.__apptFill = function (student) {
  "use strict";
  var Core = window.ApptCore;
  if (!Core || !student) return 0;

  function labelFor(el) {
    if (el.id) {
      var l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l) return l.textContent || "";
    }
    var p = el.closest("label");
    if (p) return p.textContent || "";
    return "";
  }

  function visible(el) {
    if (el.disabled || el.readOnly) return false;
    if (el.type === "hidden" || el.type === "password" || el.type === "file") return false;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    var st = window.getComputedStyle(el);
    return st.display !== "none" && st.visibility !== "hidden";
  }

  var inputs = Array.prototype.filter.call(
    document.querySelectorAll('input, textarea, select'),
    function (el) {
      if (el.tagName === "INPUT") {
        var t = (el.type || "text").toLowerCase();
        if (["text", "email", "tel", "search", "date", "number", ""].indexOf(t) === -1) return false;
      }
      return visible(el);
    }
  );

  var descriptors = inputs.map(function (el) {
    return { name: el.name || "", id: el.id || "", placeholder: el.placeholder || "", aria: el.getAttribute("aria-label") || "", label: labelFor(el) };
  });

  var plan = Core.planAutofill(descriptors, student);
  var filled = 0;
  plan.forEach(function (p) {
    var el = inputs[p.index];
    if (!el) return;
    try {
      if (el.tagName === "SELECT") {
        var opt = Array.prototype.find.call(el.options, function (o) {
          return o.value.toLowerCase() === String(p.value).toLowerCase() || o.textContent.trim().toLowerCase() === String(p.value).toLowerCase();
        });
        if (!opt) return;
        el.value = opt.value;
      } else {
        el.focus();
        el.value = p.value;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.style.outline = "2px solid #1f9d6b";
      el.style.outlineOffset = "1px";
      filled++;
    } catch (e) {}
  });

  // A small banner so the staff knows filling happened and that booking is still their job.
  try {
    var old = document.getElementById("__appt_banner");
    if (old) old.remove();
    var b = document.createElement("div");
    b.id = "__appt_banner";
    b.textContent = "Appointment Assistant filled " + filled + " field(s). Please review and book yourself.";
    b.style.cssText = "position:fixed;z-index:2147483647;left:50%;bottom:18px;transform:translateX(-50%);background:#13233f;color:#fff;padding:10px 16px;border-radius:10px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35)";
    document.body.appendChild(b);
    setTimeout(function () { if (b.parentNode) b.remove(); }, 5000);
  } catch (e) {}

  return filled;
};
