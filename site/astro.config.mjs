import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// meridian-ux/meridian-ux.github.io → GitHub Pages ORG site, served at the
// root. A repo named <org>.github.io is what makes the bare domain resolve; as a
// project site under any other name it 404s at the root, which is what this fixes.
// No `base`: the site is served from the root, so links and public assets are
// authored as plain absolute paths. If a base is ever reintroduced, note that
// src/styles/global.css references fonts by absolute url() and cannot read
// import.meta.env.BASE_URL — the prefix has to be threaded through the CSS too,
// which is why the previous /site prefix was hardcoded in 28 places.
export default defineConfig({
  site: "https://meridian-ux.github.io",
  trailingSlash: "ignore",
  build: { format: "directory" },
  integrations: [sitemap()],
});
