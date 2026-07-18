import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// meridian-ux/site → GitHub Pages project site at meridian-ux.github.io/site/.
// `base` prefixes every route; internal links + public assets are authored with
// the /site prefix to match. For a custom domain later, set base:"/" + a CNAME.
export default defineConfig({
  site: "https://meridian-ux.github.io",
  base: "/site",
  trailingSlash: "ignore",
  build: { format: "directory" },
  integrations: [sitemap()],
});
