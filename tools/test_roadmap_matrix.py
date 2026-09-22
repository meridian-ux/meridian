import io
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import roadmap_matrix
from roadmap_matrix import matrix_diff, splice_matrix


class RoadmapMatrixTests(unittest.TestCase):
    def test_splices_generated_matrix_without_changing_surrounding_text(self):
        roadmap = """# Roadmap
before
<!-- matrix:start -->
stale
<!-- matrix:end -->
after
"""

        result = splice_matrix(roadmap, "| arm | parity |\n|---|---|")

        self.assertEqual(
            result,
            """# Roadmap
before
<!-- matrix:start -->
| arm | parity |
|---|---|
<!-- matrix:end -->
after
""",
        )

    def test_accepts_an_empty_generated_region(self):
        roadmap = "<!-- matrix:start -->\n<!-- matrix:end -->\n"

        self.assertEqual(
            splice_matrix(roadmap, "generated"),
            "<!-- matrix:start -->\ngenerated\n<!-- matrix:end -->\n",
        )

    def test_rejects_missing_or_duplicate_marker_pairs(self):
        with self.assertRaisesRegex(ValueError, "found 0"):
            splice_matrix("# Roadmap\n", "generated")

        duplicate = (
            "<!-- matrix:start -->\none\n<!-- matrix:end -->\n"
            "<!-- matrix:start -->\ntwo\n<!-- matrix:end -->\n"
        )
        with self.assertRaisesRegex(ValueError, "found 2"):
            splice_matrix(duplicate, "generated")

    def test_diff_names_committed_and_generated_roadmaps(self):
        diff = matrix_diff("old\n", "new\n")

        self.assertIn("--- ROADMAP.md (committed)", diff)
        self.assertIn("+++ ROADMAP.md (generated)", diff)
        self.assertIn("-old", diff)
        self.assertIn("+new", diff)

    def test_check_fails_with_diff_and_remediation_when_matrix_is_stale(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "ROADMAP.md").write_text(
                "<!-- matrix:start -->\nstale\n<!-- matrix:end -->\n"
            )
            stderr = io.StringIO()

            with (
                patch.object(roadmap_matrix, "ROOT", root),
                patch.object(roadmap_matrix, "render", return_value="generated"),
                redirect_stderr(stderr),
            ):
                status = roadmap_matrix.main(["--check"])

        self.assertEqual(status, 1)
        self.assertIn("-stale", stderr.getvalue())
        self.assertIn("+generated", stderr.getvalue())
        self.assertIn("tools/roadmap_matrix.py --write", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
