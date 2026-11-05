/*
 * Electron entry point for the Appointment Assistant desktop app.
 * It opens the very same login.html / dashboard.html that the web version uses, in a normal
 * window. The licence check, trial and sign-in all work exactly as on the web — this wrapper
 * adds nothing to the behaviour, it only makes the app open as a program (an .exe).
 */
const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "Appointment Assistant",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload-book.js needs Node to read the fill scripts; the page stays isolated
      webviewTag: true, // the in-app browser (book.html) embeds the official site in a <webview>
      preload: path.join(__dirname, "preload-book.js"),
    },
  });
  win.removeMenu();
  win.loadFile("login.html");
  win.webContents.on("did-finish-load", () => console.log("[appt] page loaded ok"));
  win.webContents.on("render-process-gone", (_e, d) => console.log("[appt] renderer gone:", d.reason));

  // Any link meant to open a new window opens in the real browser instead of inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
