import json
from pathlib import Path
import tempfile
import unittest
from google.protobuf import text_format
from tools.stateful_corpus import ROOT, STATES, artifacts, check, classes


class StatefulCorpusTest(unittest.TestCase):
    def test_default_ids_reference_unique_authored_options_after_state_expansion(self):
        files = artifacts()
        View = classes()["meridian.ui.v1.ViewDescriptor"]
        for arm, field, default in (("choice", "options", "default_option_id"),
                                    ("connect_flow", "targets", "default_target_id")):
            for state in STATES:
                view = View.FromString(files[f"{arm}/{state}.view.binpb"])
                body = getattr(view.slots[0].panel, arm)
                ids = [item.id for item in getattr(body, field)]
                self.assertEqual(len(ids), len(set(ids)))
                selected = getattr(body, default)
                if selected:
                    self.assertIn(selected, ids, f"{arm}/{state}")

    def test_every_arm_state_and_value_case_has_both_twins(self):
        files = artifacts()
        arms = json.loads((ROOT / "schemas/conformance/coverage.json").read_text())["arms"]
        for arm in arms:
            for state in STATES:
                for kind in ("view", "responses"):
                    for extension in ("binpb", "txtpb"):
                        self.assertIn(f"{arm}/{state}.{kind}.{extension}", files)
        values = json.loads((ROOT / "schemas/conformance/value_types.json").read_text())["cases"]
        self.assertEqual(len(files), (len(arms) * 3 + len(values)) * 4)

    def test_text_twins_parse_to_the_exact_binary_messages(self):
        types = classes()
        files = artifacts()
        for path, content in files.items():
            if not path.endswith(".txtpb"):
                continue
            name = "meridian.ui.v1.ViewDescriptor" if ".view." in path else "google.protobuf.Struct"
            binary = types[name].FromString(files[path.replace(".txtpb", ".binpb")])
            text = text_format.Parse(content.decode(), types[name]())
            self.assertEqual(text, binary, path)

    def test_missing_changed_and_extra_files_fail_without_deleting_extras(self):
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            expected = {"case.view.binpb": b"fixture"}
            with self.assertRaisesRegex(ValueError, "Missing/stale"):
                check(directory, expected)
            check(directory, expected, write=True)
            (directory / "case.view.binpb").write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "Missing/stale"):
                check(directory, expected)
            extra = directory / "unrelated.txt"
            extra.write_text("keep")
            with self.assertRaisesRegex(ValueError, "Unexpected fixture"):
                check(directory, expected, write=True)
            self.assertEqual(extra.read_text(), "keep")


if __name__ == "__main__":
    unittest.main()
