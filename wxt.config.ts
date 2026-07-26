import { defineConfig } from "wxt";
import preact from "@preact/preset-vite";

export default defineConfig({
  manifest: {
    name: "Header Handler",
    description: "Add, overwrite, and remove request headers with shareable profiles.",
    permissions: ["declarativeNetRequest", "webRequest", "storage", "sidePanel"],
    host_permissions: ["<all_urls>"],
    // Toolbar button icon is pinned to the pre-rebrand render on purpose — the
    // brand refresh below only replaces the top-level `icons` (extensions
    // page, install dialog, right-click menu), not this one.
    action: {
      default_icon: { 16: "icons/toolbar/16.png", 48: "icons/toolbar/48.png", 128: "icons/toolbar/128.png" },
    },
    side_panel: { default_path: "sidepanel.html" },
  },
  vite: () => ({ plugins: [preact()] }),
});
