import { defineConfig } from "deepsec/config";

export default defineConfig({
  projects: [
    { id: "media-manager", root: ".." },
    // <deepsec:projects-insert-above>
  ],
});
