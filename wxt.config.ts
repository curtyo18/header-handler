import { defineConfig } from "wxt";
import preact from "@preact/preset-vite";

export default defineConfig({
  manifest: {
    name: "Header Handler",
    description: "Add, overwrite, and remove request headers with shareable profiles.",
    permissions: ["declarativeNetRequest", "webRequest", "storage", "sidePanel"],
    host_permissions: ["<all_urls>"],
    action: {},
    options_ui: { open_in_tab: true, page: "options.html" },
    side_panel: { default_path: "sidepanel.html" },
  },
  vite: () => ({ plugins: [preact()] }),
});
