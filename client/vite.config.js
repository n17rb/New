import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// روابط مباشرة زي /t/i/... (فاتورة الزبون) أو /m/2 (دخول المصنع):
// إذا الاستضافة ما لقيت الملف بتعرض 404.html — فبنخليها نفس التطبيق عشان يفتح الصفحة الصح بدل شاشة سودا
const spaFallback = () => {
  let outDir = "dist";
  return {
    name: "spa-404-fallback",
    apply: "build",
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
    closeBundle() {
      const index = resolve(outDir, "index.html");
      if (existsSync(index)) copyFileSync(index, resolve(outDir, "404.html"));
    },
  };
};

export default defineConfig({
  plugins: [react(), spaFallback()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
});
