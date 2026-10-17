import tempfile
import unittest
from pathlib import Path

from google.protobuf import json_format, text_format
from tools.layout_corpus import artifacts, cases, check, classes


class LayoutCorpusTest(unittest.TestCase):
    def test_canonical_binary_text_twins_and_mode_coverage(self):
        files = artifacts()
        types = classes()
        View, Struct = types["meridian.ui.v1.ViewDescriptor"], types["google.protobuf.Struct"]
        modes = set()
        for case in cases():
            for kind, message_type in [("view", View), ("context", Struct), ("responses", Struct)]:
                name = f"{case['name']}.{kind}"
                message = message_type.FromString(files[name + ".binpb"])
                if (case["name"], kind) != ("unknown", "view"):
                    self.assertEqual(message, text_format.Parse(files[name + ".txtpb"].decode(), message_type()))
                if kind == "view" and message.layout.WhichOneof("mode"):
                    modes.add(message.layout.WhichOneof("mode"))
        self.assertEqual(modes, {f.name for f in View.DESCRIPTOR.fields_by_name["layout"].message_type.oneofs_by_name["mode"].fields})
        self.assertIn(b"\x2a\x00", files["unknown.view.binpb"])
        self.assertEqual(files, artifacts())

    def test_gates_preserve_scalar_types_and_expected_closed_states(self):
        files = artifacts()
        Struct = classes()["google.protobuf.Struct"]
        for name, value in [("null", None), ("empty", ""), ("false", False), ("zero", 0), ("open", "scope-A")]:
            context = json_format.MessageToDict(Struct.FromString(files[f"gate-{name}.context.binpb"]))
            self.assertEqual(context["selections"]["scope"], value)
            if name == "false": self.assertIs(context["selections"]["scope"], False)
        self.assertEqual(len({case["name"] for case in cases()}), len(cases()))

    def test_verifier_rejects_missing_stale_and_unexpected_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, "Missing/stale"):
                check(root, artifacts())
            check(root, artifacts(), True)
            check(root, artifacts())
            (root / "list.view.binpb").write_bytes(b"stale")
            with self.assertRaisesRegex(ValueError, "Missing/stale.*layout_corpus"):
                check(root, artifacts())
            check(root, artifacts(), True)
            (root / "stray.binpb").write_bytes(b"")
            with self.assertRaisesRegex(ValueError, "Unexpected"):
                check(root, artifacts())


if __name__ == "__main__":
    unittest.main()
