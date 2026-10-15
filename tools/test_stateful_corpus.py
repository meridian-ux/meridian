import json
from pathlib import Path
import tempfile
import unittest
from google.protobuf import json_format, text_format
from tools.stateful_corpus import ROOT, STATES, artifacts, check, classes


class StatefulCorpusTest(unittest.TestCase):
    def test_constrained_cases_cover_every_declared_type_without_coercing_the_payload(self):
        files = artifacts()
        View = classes()["meridian.ui.v1.ViewDescriptor"]
        kinds = {value.number for value in View.DESCRIPTOR.file.pool.FindEnumTypeByName("meridian.ui.v1.ValueType").values}
        corpus = json.loads((ROOT / "schemas/conformance/constrained_value_types.json").read_text())
        self.assertEqual(corpus["stringArms"], ["copy_value", "connect_flow"])
        self.assertEqual(corpus["numberArms"], ["stat"])
        for arm_key, case_key, raw_type in (("stringArms", "strings", str), ("numberArms", "numbers", (int, float))):
            cases = corpus[case_key]
            self.assertTrue(kinds <= {case["type"] for case in cases})
            self.assertIn(999, {case["type"] for case in cases})
            self.assertEqual(len(cases), len({case["name"] for case in cases}))
            for arm in corpus[arm_key]:
                for case in cases:
                    self.assertIsInstance(case["raw"], raw_type)
                    self.assertIsNot(type(case["raw"]), bool)
                    panel = View.FromString(files[f"{arm}/typed-{case['name']}.view.binpb"]).slots[0].panel
                    if arm == "stat":
                        self.assertEqual(panel.stat.value, case["raw"])
                        self.assertEqual(panel.stat.value_display.type, case["type"])
                    else:
                        value = panel.copy_value.value if arm == "copy_value" else panel.connect_flow.endpoint
                        self.assertEqual(value.value, case["raw"])
                        self.assertEqual(value.display.type, case["type"])

    def test_every_unrestricted_surface_preserves_raw_response_types(self):
        files = artifacts()
        Response = classes()["google.protobuf.Struct"]
        corpus = json.loads((ROOT / "schemas/conformance/value_types.json").read_text())
        for arm in corpus["panelArms"]:
            for case in corpus["cases"]:
                response = json_format.MessageToDict(Response.FromString(
                    files[f"{arm}/value-{case['name']}.responses.binpb"]))["fixture.Values.List"]
                raw = response["value"] if arm in ("record_card", "detail_header") else response["rows"][0]["value"]
                self.assertEqual(raw, case["raw"], f"{arm}/{case['name']}")
                if isinstance(case["raw"], bool):
                    self.assertIs(type(raw), bool)

    def test_unrestricted_value_surface_list_matches_the_canonical_schema(self):
        def carries_display(descriptor, seen):
            if descriptor.full_name == "meridian.ui.v1.ValueDisplay":
                return True
            if descriptor.full_name in seen:
                return False
            seen = seen | {descriptor.full_name}
            return any(field.message_type and carries_display(field.message_type, seen)
                       for field in descriptor.fields)
        panel = classes()["meridian.ui.v1.PanelDescriptor"].DESCRIPTOR
        declared = {field.name for field in panel.oneofs_by_name["body"].fields
                    if carries_display(field.message_type, set())}
        # These surfaces have string/numeric-only payloads or form input/default
        # semantics. They require dedicated typed fixtures, not coerced copies of
        # the unrestricted fetched-value cases. Keep their remaining work explicit.
        constrained = {"stat", "copy_value", "connect_flow", "form", "lro", "prompt", "llm_prompt"}
        corpus = json.loads((ROOT / "schemas/conformance/value_types.json").read_text())
        self.assertEqual(set(corpus["panelArms"]), declared - constrained)
        self.assertEqual(len(corpus["panelArms"]), len(set(corpus["panelArms"])))

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
        corpus = json.loads((ROOT / "schemas/conformance/value_types.json").read_text())
        for arm in corpus["panelArms"]:
            for value in corpus["cases"]:
                self.assertIn(f"{arm}/value-{value['name']}.view.binpb", files)
        constrained = json.loads((ROOT / "schemas/conformance/constrained_value_types.json").read_text())
        typed_count = len(constrained["stringArms"]) * len(constrained["strings"]) + len(constrained["numberArms"]) * len(constrained["numbers"])
        self.assertEqual(len(files), (len(arms) * 3 + len(corpus["cases"]) * len(corpus["panelArms"]) + typed_count) * 4)

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
