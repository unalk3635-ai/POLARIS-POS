
const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "POLARIS POS",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Google Auth / CORS yönlendirmelerine izin ver
      sandbox: false
    }
  });

  // Google OAuth Pop-up veya dış bağlantı açıldığında tıkama yapmadan pencerede izin ver
  win.webContents.setWindowOpenHandler(({ url }) => {
    return { action: "allow" };
  });

  win.loadURL("http://localhost:3000");
}

app.whenReady().then(() => {
  require(path.join(__dirname, "server.js"));
  setTimeout(createWindow, 1000);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

