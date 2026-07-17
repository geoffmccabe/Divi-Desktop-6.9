// The only bridge between the React UI and the Rust engine. Read-only status
// today; wallet actions will be added as explicitly-named channels — never a
// raw "run anything" surface.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("divi", {
  nodeStatus: () => ipcRenderer.invoke("node-status"),
});
