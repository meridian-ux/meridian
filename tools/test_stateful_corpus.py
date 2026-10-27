import json
import copy
from pathlib import Path
import tempfile
import unittest
from unittest import mock
from google.protobuf import descriptor_pb2, descriptor_pool, json_format, message_factory, text_format
from tools.stateful_corpus import ROOT, STATES, INPUT_ARMS, artifacts, check, classes, input_cases, input_index, declared_value_types, rendered_value_arms, validate_value_coverage, main


class StatefulCorpusTest(unittest.TestCase):
    def test_editable_input_forms_author_their_submit_label_and_rpc(self):
        files = artifacts()
        View = classes()["meridian.ui.v1.ViewDescriptor"]
        for case in input_cases():
            view = View.FromString(files[f"form/input-{case['name']}.view.binpb"])
            form = view.slots[0].panel.form
            self.assertEqual(form.submit_affordance.label, "Save")
            self.assertEqual(form.submit_affordance.WhichOneof("invoke"), "rpc")
            self.assertEqual(form.submit_affordance.rpc.service, "fixture.Inputs")
            self.assertEqual(form.submit_affordance.rpc.method, "Submit")

    def test_open_panel_activation_does_not_make_current_action_content_a_value_display(self):
        panel = classes()["meridian.ui.v1.PanelDescriptor"].DESCRIPTOR
        affordance = panel.file.pool.FindMessageTypeByName("meridian.ui.v1.Affordance")
        target = affordance.fields_by_name["open_panel"]
        self.assertEqual(target.containing_oneof.name, "invoke")
        self.assertEqual(target.message_type.full_name, panel.full_name)
        self.assertTrue({"action", "catalog", "steps"}.isdisjoint(rendered_value_arms(panel)))
        self.assertIn("table", rendered_value_arms(panel))

    def test_new_real_affordance_display_field_still_fails_the_coverage_gate(self):
        # Add an actual display field in memory only. A type-wide Affordance
        # exclusion would incorrectly hide this future coverage requirement.
        image = descriptor_pb2.FileDescriptorSet.FromString(
            (ROOT / "crates/core/rust/uiview/proto/gen/meridian_ui_v1.binpb").read_bytes())
        affordance = next(message for file in image.file for message in file.message_type
                          if file.package == "meridian.ui.v1" and message.name == "Affordance")
        affordance.field.add(name="test_only_display", number=500, label=1, type=11,
                             type_name=".meridian.ui.v1.ValueDisplay")
        pool = descriptor_pool.DescriptorPool()
        for file in image.file:
            pool.Add(file)
        panel = pool.FindMessageTypeByName("meridian.ui.v1.PanelDescriptor")
        self.assertTrue({"action", "catalog", "steps"} <= rendered_value_arms(panel))
        current = classes()
        updated = {**current, "meridian.ui.v1.PanelDescriptor": message_factory.GetMessageClass(panel)}
        read = json.loads((ROOT / "schemas/conformance/value_types.json").read_text())
        constrained = json.loads((ROOT / "schemas/conformance/constrained_value_types.json").read_text())
        with mock.patch("tools.stateful_corpus.classes", return_value=updated):
            with self.assertRaisesRegex(ValueError, "complete, non-overlapping typed fixture family"):
                validate_value_coverage(read, constrained, input_cases())

    def test_recording_validates_before_writing_the_index_or_any_fixture(self):
        with mock.patch("sys.argv", ["stateful_corpus.py", "--write"]), \
                mock.patch("tools.stateful_corpus.artifacts", side_effect=ValueError("incomplete family")), \
                mock.patch("tools.stateful_corpus.check_input_index") as index, \
                mock.patch("tools.stateful_corpus.check") as fixtures:
            with self.assertRaisesRegex(ValueError, "incomplete family"):
                main()
            index.assert_not_called()
            fixtures.assert_not_called()

    def test_generator_rejects_missing_duplicate_and_unknown_value_arms(self):
        read = json.loads((ROOT / "schemas/conformance/value_types.json").read_text())
        constrained = json.loads((ROOT / "schemas/conformance/constrained_value_types.json").read_text())
        validate_value_coverage(read, constrained, input_cases())
        for replacement in ([], ["copy_value"], ["copy_value", "copy_value"], ["copy_value", "ghost"]):
            invalid = copy.deepcopy(constrained)
            invalid["stringArms"] = replacement
            with self.subTest(arms=replacement), self.assertRaisesRegex(ValueError, "typed fixture family"):
                validate_value_coverage(read, invalid, input_cases())

    def test_generator_requires_each_declared_type_in_every_payload_family(self):
        read = json.loads((ROOT / "schemas/conformance/value_types.json").read_text())
        constrained = json.loads((ROOT / "schemas/conformance/constrained_value_types.json").read_text())
        for family in ("read", "string", "number", "input"):
            a, b, c = copy.deepcopy(read), copy.deepcopy(constrained), input_cases()
            if family == "read": a["cases"] = [case for case in a["cases"] if case["type"] != 3]
            elif family == "input": c = [case for case in c if case["field"]["display"]["type"] != 3]
            else:
                key = "strings" if family == "string" else "numbers"
                b[key] = [case for case in b[key] if case["type"] != 3]
            with self.subTest(family=family), self.assertRaisesRegex(ValueError, f"{family}: missing declared ValueType"):
                validate_value_coverage(a, b, c)
        with mock.patch("tools.stateful_corpus.declared_value_types", return_value=declared_value_types() | {123}):
            with self.assertRaisesRegex(ValueError, "missing declared ValueType fixtures.*123"):
                validate_value_coverage(read, constrained, input_cases())

    def test_generator_rejects_loss_of_an_input_kind_even_when_types_remain_covered(self):
        read = json.loads((ROOT / "schemas/conformance/value_types.json").read_text())
        constrained = json.loads((ROOT / "schemas/conformance/constrained_value_types.json").read_text())
        inputs = [case for case in input_cases() if "masked" not in case["field"]]
        with self.assertRaisesRegex(ValueError, "Missing input kind fixtures.*masked"):
            validate_value_coverage(read, constrained, inputs)

    def test_input_index_covers_every_value_type_and_input_kind_as_protobuf(self):
        cases = input_cases()
        Field = classes()["meridian.ui.v1.FormField"]
        types = {v.number for v in Field.DESCRIPTOR.file.pool.FindEnumTypeByName("meridian.ui.v1.ValueType").values}
        self.assertTrue(types <= {case["field"]["display"]["type"] for case in cases})
        self.assertIn(999, {case["field"]["display"]["type"] for case in cases})
        self.assertEqual(len(cases), len({case["name"] for case in cases}))
        kinds = {json_format.ParseDict(case["field"], Field()).WhichOneof("kind") for case in cases}
        self.assertEqual(kinds, {field.name for field in Field.DESCRIPTOR.oneofs_by_name["kind"].fields})
        files = input_index()
        Struct = classes()["google.protobuf.Struct"]
        binary = Struct.FromString(files["input_values.binpb"])
        self.assertEqual(binary, text_format.Parse(files["input_values.txtpb"].decode(), Struct()))
        index = json_format.MessageToDict(binary)
        self.assertEqual(index["arms"], list(INPUT_ARMS))
        for case, twin in zip(cases, index["cases"]):
            self.assertEqual(case["raw"], twin["raw"])
            if isinstance(case["raw"], bool):
                self.assertIs(type(twin["raw"]), bool)

    def test_input_cases_cross_every_input_arm_and_readonly_form_without_formatting_defaults(self):
        files = artifacts()
        View = classes()["meridian.ui.v1.ViewDescriptor"]
        for case in input_cases():
            for arm in INPUT_ARMS:
                view = View.FromString(files[f"{arm}/input-{case['name']}.view.binpb"])
                body = getattr(view.slots[0].panel, arm)
                field = body.fields[0] if arm in ("form", "prompt") else body.inputs[0] if arm == "lro" else body.slots[0].field
                expected = json_format.ParseDict(case["field"], type(field)())
                self.assertEqual(field, expected, f"{arm}/{case['name']}")
            read = View.FromString(files[f"form/read-{case['name']}.view.binpb"])
            self.assertEqual(read.slots[0].panel.form.mode, 1)

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
        panel = classes()["meridian.ui.v1.PanelDescriptor"].DESCRIPTOR
        declared = rendered_value_arms(panel)
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
        self.assertEqual(len(files), (len(arms) * 3 + len(corpus["cases"]) * len(corpus["panelArms"]) + typed_count
                                     + len(input_cases()) * (len(INPUT_ARMS) + 1)) * 4)

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
