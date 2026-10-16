import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from publish_manifests import PACKAGES, ROOT, module_version, published
import json
import tomllib


class PublishedManifestTests(unittest.TestCase):
    def test_web_publication_manifest_is_generated_and_private_only_in_development(self):
        self.assertIn(("packages/web/package.json", "packages/web/web.package.json"), PACKAGES)
        dev = json.loads((ROOT / "packages/web/package.json").read_text())
        self.assertTrue(dev["private"])
        out = published(dev, module_version())
        self.assertEqual(out["name"], "@savvifi/meridian-web")
        self.assertNotIn("private", out)
        self.assertEqual(out["exports"]["."]["import"], "./src/browser.js")
        self.assertEqual(out["exports"]["."]["types"], "./src/browser.d.ts")
        for name in ("@savvifi/meridian-proto-ts", "@savvifi/meridian-schemas"):
            self.assertEqual(out["dependencies"][name], module_version())

    def test_crate_registry_dependencies_follow_the_module_version(self):
        cargo = tomllib.loads((ROOT / "Cargo.toml").read_text())
        version = module_version()
        self.assertEqual(cargo["workspace"]["package"]["version"], version)
        for name in ("meridian-uiview", "theme-proto"):
            dep = cargo["workspace"]["dependencies"][name]
            self.assertEqual(dep["version"], "=" + version)
            self.assertTrue((ROOT / dep["path"] / "Cargo.toml").is_file())

    def test_resolves_workspace_pins_and_removes_development_fields(self):
        result = published(
            {
                "name": "@example/widget",
                "version": "0.0.0",
                "private": True,
                "scripts": {"test": "vitest"},
                "devDependencies": {"vitest": "1.0.0"},
                "dependencies": {
                    "@example/core": "workspace:*",
                    "react": "^19.0.0",
                },
                "peerDependencies": {"react": "^19.0.0"},
            },
            "0.25.1",
        )

        self.assertEqual(result["version"], "0.25.1")
        self.assertEqual(result["dependencies"], {"@example/core": "0.25.1"})
        self.assertEqual(result["peerDependencies"], {"react": "^19.0.0"})
        self.assertNotIn("private", result)
        self.assertNotIn("scripts", result)
        self.assertNotIn("devDependencies", result)

    def test_rejects_non_star_workspace_protocols(self):
        with self.assertRaises(SystemExit):
            published(
                {
                    "name": "@example/widget",
                    "dependencies": {"@example/core": "workspace:^"},
                },
                "0.25.1",
            )


if __name__ == "__main__":
    unittest.main()
