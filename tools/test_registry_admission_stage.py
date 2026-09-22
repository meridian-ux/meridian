import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from registry_admission_stage import stage_module


class RegistryAdmissionStageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.registry_module = self.root / "modules" / "meridian"
        (self.registry_module / "0.25.1").mkdir(parents=True)
        (self.registry_module / "metadata.json").write_text(
            json.dumps({"versions": ["0.1.0", "0.25.1"]})
        )
        (self.registry_module / "0.25.1" / "MODULE.bazel").write_text(
            'module(name = "meridian", version = "0.25.1")\n'
        )
        self.source = self.root / "MODULE.bazel"
        self.source.write_text(
            '"""version = \\"0.0.1\\" is only prose"""\n'
            'module(\n    name = "meridian",\n    version = "0.26.0",\n)\n'
            'bazel_dep(name = "rules_rust", version = "0.70.0")\n'
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_stages_candidate_contents_at_latest_published_version(self):
        message = stage_module(self.source, self.registry_module)
        staged = (self.registry_module / "0.25.1" / "MODULE.bazel").read_text()
        self.assertEqual(message, "candidate: meridian@0.26.0 staged as published meridian@0.25.1")
        self.assertIn('version = "0.25.1"', staged)
        self.assertIn('bazel_dep(name = "rules_rust", version = "0.70.0")', staged)

    def test_rejects_non_meridian_module(self):
        self.source.write_text(
            'module(\n    name = "other",\n    version = "1.0.0",\n)\n'
        )
        with self.assertRaisesRegex(ValueError, "expected module"):
            stage_module(self.source, self.registry_module)

    def test_rejects_missing_published_module_directory(self):
        (self.registry_module / "0.25.1" / "MODULE.bazel").unlink()
        with self.assertRaisesRegex(ValueError, "missing"):
            stage_module(self.source, self.registry_module)

    def test_rejects_empty_registry_metadata(self):
        (self.registry_module / "metadata.json").write_text('{"versions": []}')
        with self.assertRaisesRegex(ValueError, "no Meridian versions"):
            stage_module(self.source, self.registry_module)


if __name__ == "__main__":
    unittest.main()
