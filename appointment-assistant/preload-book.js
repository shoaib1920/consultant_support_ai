/*
 * Preload for the in-app browser page (book.html) of the desktop app.
 * It reads the SAME core.js + content-fill.js that the Chrome extension uses, and hands their text
 * to the page so it can inject them into the embedded <webview> and fill the form there.
 * Runs with Node access (trusted, local files only); the page itself stays isolated.
 */
const { contextBridge } = require("electron");
const fs = require("fs");
const path = require("path");

function read(file) {
  try {
    return fs.readFileSync(path.join(__dirname, file), "utf8");
  } catch (e) {
    return "";
  }
}

contextBridge.exposeInMainWorld("apptBridge", {
  // Injected together into the embedded page; content-fill.js defines window.__apptFill.
  fillScript: read("core.js") + "\n;" + read("content-fill.js"),
});
