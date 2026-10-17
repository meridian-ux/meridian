import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from affordance_rust_probe import protected_inputs, require_adoption_failure


def diagnostic(code="E0004", path="crates/core/rust/uiview/src/static_view.rs"):
    return json.dumps({"reason": "compiler-message", "message": {
        "level": "error", "code": {"code": code},
        "message": "non-exhaustive patterns: `&Some(Invoke::Rpc(_))`, `&Some(Invoke::Navigate(_))`, `&Some(Invoke::OpenPanel(_))` and 2 more not covered",
        "spans": [{"is_primary": True, "file_name": path}],
    }})


def failed_build(*messages):
    return "\n".join([*messages, json.dumps({"reason": "build-finished", "success": False})])


class RustProposalFailureTests(unittest.TestCase):
    def test_accepts_only_the_known_typed_dispatch_blocker(self):
        errors = require_adoption_failure(101, failed_build(diagnostic()), "could not compile")
        self.assertEqual(len(errors), 1)

    def test_does_not_call_unexpected_candidate_success_a_failure_proof(self):
        with self.assertRaisesRegex(RuntimeError, "unexpectedly compiles"):
            require_adoption_failure(0, "", "")

    def test_rejects_dependency_network_and_tool_failures(self):
        for output in ["", "not JSON", '{"reason":"build-finished","success":false}', "[]"]:
            with self.subTest(output=output), self.assertRaisesRegex(RuntimeError, "Unexpected candidate failure"):
                require_adoption_failure(101, output, "failed to download dependency")

    def test_rejects_other_compiler_errors_even_alongside_the_expected_one(self):
        with self.assertRaisesRegex(RuntimeError, "Unexpected candidate failure"):
            require_adoption_failure(101, failed_build(diagnostic(), diagnostic("E0308")), "")

    def test_rejects_an_exhaustive_match_failure_in_another_consumer(self):
        with self.assertRaisesRegex(RuntimeError, "Unexpected candidate failure"):
            require_adoption_failure(101, failed_build(diagnostic(path="crates/tui/rust/tui/src/content.rs")), "")

    def test_rejects_nonprimary_spans(self):
        event = json.loads(diagnostic())
        event["message"]["spans"][0]["is_primary"] = False
        with self.assertRaisesRegex(RuntimeError, "Unexpected candidate failure"):
            require_adoption_failure(101, failed_build(json.dumps(event)), "")

    def test_rejects_an_unrelated_nonexhaustive_match_in_the_same_file(self):
        event = json.loads(diagnostic())
        event["message"]["message"] = "non-exhaustive patterns: OtherEnum::Future not covered"
        with self.assertRaisesRegex(RuntimeError, "Unexpected candidate failure"):
            require_adoption_failure(101, failed_build(json.dumps(event)), "")

    def test_rejects_a_killed_or_incomplete_build_even_with_the_expected_error(self):
        for code, output in [(101, diagnostic()), (-9, failed_build(diagnostic()))]:
            with self.subTest(code=code), self.assertRaisesRegex(RuntimeError, "Unexpected candidate failure"):
                require_adoption_failure(code, output, "")

    def test_canonical_input_guard_detects_policy_changes_and_new_protos(self):
        with tempfile.TemporaryDirectory(prefix="meridian-rust-probe-test-") as temporary:
            root = Path(temporary)
            for name in ["Cargo.lock", "Cargo.toml", "buf.yaml", "buf.gen.yaml"]:
                (root / name).write_text("baseline", encoding="utf-8")
            (root / "schemas/proto").mkdir(parents=True)
            before = protected_inputs(root)
            (root / "buf.yaml").write_text("changed policy", encoding="utf-8")
            self.assertNotEqual(protected_inputs(root), before)
            (root / "buf.yaml").write_text("baseline", encoding="utf-8")
            self.assertEqual(protected_inputs(root), before)
            (root / "schemas/proto/new.proto").write_text("syntax = 'proto3';", encoding="utf-8")
            self.assertNotEqual(protected_inputs(root), before)

    def test_canonical_input_guard_does_not_silently_ignore_missing_policy(self):
        with tempfile.TemporaryDirectory(prefix="meridian-rust-probe-test-") as temporary:
            with self.assertRaises(FileNotFoundError):
                protected_inputs(Path(temporary))


if __name__ == "__main__":
    unittest.main()
