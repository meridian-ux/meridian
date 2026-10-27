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

    def test_workspace_crate_lock_versions_follow_the_module_version(self):
        for path, names in (
            ("Cargo.lock", {"meridian-uiview", "meridian-tui", "theme-proto"}),
            ("fuzz/Cargo.lock", {"meridian-uiview"}),
        ):
            with self.subTest(lockfile=path):
                lock = tomllib.loads((ROOT / path).read_text())
                packages = [package for package in lock["package"] if package["name"] in names]
                self.assertEqual({package["name"] for package in packages}, names)
                self.assertEqual(len(packages), len(names))
                for package in packages:
                    self.assertEqual(package["version"], module_version())

    def test_prerelease_workspace_pins_remain_exact_in_every_dependency_kind(self):
        version = "1.0.0-alpha.1"
        out = published({
            "name": "@example/widget", "version": "0.0.0", "private": True,
            "dependencies": {"@example/core": "workspace:*"},
            "peerDependencies": {"@example/theme": "workspace:*", "react": "^19.0.0"},
            "optionalDependencies": {"@example/kit": "workspace:*"},
        }, version)
        self.assertEqual(out["version"], version)
        self.assertEqual(out["dependencies"], {"@example/core": version})
        self.assertEqual(out["peerDependencies"], {"@example/theme": version, "react": "^19.0.0"})
        self.assertEqual(out["optionalDependencies"], {"@example/kit": version})
        self.assertNotIn("private", out)

    def test_first_party_explicit_old_ranges_cannot_leak_into_prerelease_artifacts(self):
        version = "1.0.0-alpha.1"
        out = published({
            "name": "@example/widget",
            "dependencies": {"@savvifi/meridian-schemas": "^0.25.0"},
            "peerDependencies": {"@savvifi/meridian-proto-ts": "^0.25.0", "react": "^19.0.0"},
            "optionalDependencies": {"@savvifi/meridian-web-react": "^0.25.0", "@savvifi/meridian-external-kit": "^0.4.0"},
        }, version)
        self.assertEqual(out["dependencies"], {"@savvifi/meridian-schemas": version})
        self.assertEqual(out["peerDependencies"], {"@savvifi/meridian-proto-ts": version, "react": "^19.0.0"})
        self.assertEqual(out["optionalDependencies"], {"@savvifi/meridian-web-react": version, "@savvifi/meridian-external-kit": "^0.4.0"})

    def test_every_shipped_first_party_edge_is_exactly_the_module_version(self):
        names = {json.loads((ROOT / dev).read_text())["name"] for dev, _ in PACKAGES}
        for dev, _ in PACKAGES:
            out = published(json.loads((ROOT / dev).read_text()), module_version())
            for field in ("dependencies", "peerDependencies", "optionalDependencies"):
                for name, pin in out.get(field, {}).items():
                    if name in names:
                        self.assertEqual(pin, module_version(), f"{out['name']} {field}.{name}")

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
