/*
 * Storage for the dashboard and the popup. Uses the extension's chrome.storage.local when the
 * page runs inside the extension (so the popup and dashboard share one list), and falls back to
 * localStorage when the dashboard is opened as a plain website. Everything stays on this computer;
 * nothing is sent anywhere.
 */
;(function (root) {
  "use strict";
  var KEY = "appt_students_v1";
  var hasChrome = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;

  function getStudents() {
    return new Promise(function (resolve) {
      if (hasChrome) {
        chrome.storage.local.get(KEY, function (res) { resolve((res && res[KEY]) || []); });
      } else {
        try { resolve(JSON.parse(localStorage.getItem(KEY) || "[]")); }
        catch (e) { resolve([]); }
      }
    });
  }

  function saveStudents(list) {
    return new Promise(function (resolve) {
      var arr = list || [];
      if (hasChrome) {
        var o = {}; o[KEY] = arr;
        chrome.storage.local.set(o, function () { resolve(arr); });
      } else {
        try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch (e) {}
        resolve(arr);
      }
    });
  }

  root.ApptStore = { getStudents: getStudents, saveStudents: saveStudents, backend: hasChrome ? "extension" : "browser" };
})(typeof globalThis !== "undefined" ? globalThis : this);
