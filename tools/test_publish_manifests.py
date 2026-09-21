import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from publish_manifests import published


class PublishedManifestTests(unittest.TestCase):
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
