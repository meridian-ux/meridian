import copy
import hashlib
import io
import json
from pathlib import Path
import shutil
import sys
import tarfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).parent))
import release
import release_artifacts as retained
import test_release as fixtures


class RetainedArtifactTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.ReleaseTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root
        self.files = self.fixture.artifacts
        self.env = {**self.fixture.env, "GITHUB_RUN_ID": "9000"}
        self.output = self.root / "restored"
        self.zip = self.root / "original.zip"
        self.downloads = []
        self.source_records()
        self.pack()
        self.documents = {
            f"repos/{retained.REPOSITORY}/actions/artifacts/123": {
                "id": 123, "name": "release-packages-" + self.env["GITHUB_SHA"],
                "digest": self.digest, "expired": False, "size_in_bytes": self.zip.stat().st_size,
                "created_at": "2026-10-28T01:11:31Z",
                "workflow_run": {"id": 111, "head_sha": self.env["GITHUB_SHA"],
                                 "repository_id": retained.REPOSITORY_ID,
                                 "head_repository_id": retained.REPOSITORY_ID}},
            f"repos/{retained.REPOSITORY}/actions/runs/111": {
                "id": 111, "status": "completed", "conclusion": "failure",
                "event": "workflow_dispatch", "head_sha": self.env["GITHUB_SHA"],
                "workflow_id": 999, "path": retained.WORKFLOW,
                "repository": {"id": retained.REPOSITORY_ID},
                "head_repository": {"id": retained.REPOSITORY_ID}},
            f"repos/{retained.REPOSITORY}/actions/workflows/publish.yml": {
                "id": 999, "path": retained.WORKFLOW},
            f"repos/{retained.REPOSITORY}/actions/runs/111/jobs?filter=all&per_page=100": {
                "total_count": 1, "jobs": [{"name": "prepare", "head_sha": self.env["GITHUB_SHA"],
                    "conclusion": "success", "started_at": "2026-10-28T01:00:00Z",
                    "completed_at": "2026-10-28T01:12:00Z"}]},
        }

    def source_records(self, sha=None, dirty=None):
        for name in release.CRATES:
            path = self.files / f"{name}-1.0.0.crate"
            with tarfile.open(path) as package:
                files = {m.name: package.extractfile(m).read() for m in package.getmembers() if m.isfile()}
            git = {"sha1": sha or self.env["GITHUB_SHA"]}
            if dirty is not None:
                git["dirty"] = dirty
            files[f"{name}-1.0.0/.cargo_vcs_info.json"] = json.dumps({"git": git}).encode()
            with tarfile.open(path, "w:gz") as package:
                for member, data in files.items():
                    info = tarfile.TarInfo(member)
                    info.size = len(data)
                    package.addfile(info, io.BytesIO(data))
        self.fixture.sums()

    def pack(self):
        with zipfile.ZipFile(self.zip, "w") as package:
            for path in self.files.iterdir():
                package.write(path, path.name)
        self.digest = "sha256:" + hashlib.sha256(self.zip.read_bytes()).hexdigest()

    def reader(self, path):
        return copy.deepcopy(self.documents[path])

    def download(self, artifact_id, destination):
        self.downloads.append(artifact_id)
        shutil.copyfile(self.zip, destination)

    def rust(self, target, **kwargs):
        self.assertNotIn("GH_TOKEN", kwargs["env"])
        self.assertNotIn("GITHUB_TOKEN", kwargs["env"])
        (target / "package/tmp-crate").mkdir(parents=True)
        for name in release.CRATES:
            file = f"{name}-1.0.0.crate"
            shutil.copyfile(self.files / file, release.rust_archive(target, file))

    def restore(self):
        return release.restore(self.output, "123", self.digest, env=self.env,
                               reader=self.reader, downloader=self.download)

    def test_failed_publication_origin_restores_all_original_bytes_after_revalidation(self):
        # A failed overall run is expected after a partial upload. Its successful
        # preparation, exact source and artifact creation interval still prove origin.
        with patch.dict(release.os.environ, {"GH_TOKEN": "fixture-read-token", "GITHUB_TOKEN": "fixture-other-token"}), \
                patch.object(release, "consumer") as consumer, \
                patch.object(release, "rust_rehearsal", side_effect=self.rust), \
                patch.object(release, "run") as commands:
            self.restore()
        commands.assert_not_called()  # No upload, npm pack, or arbitrary shell operation.
        self.assertEqual(len(consumer.call_args.args[0]), 7)
        self.assertNotIn("GH_TOKEN", consumer.call_args.kwargs["env"])
        self.assertNotIn("GITHUB_TOKEN", consumer.call_args.kwargs["env"])
        self.assertEqual(self.downloads, ["123"])
        for original in self.files.iterdir():
            self.assertEqual((self.output / original.name).read_bytes(), original.read_bytes())

    def test_wrong_or_unproven_origin_fails_before_download(self):
        artifact = next(key for key in self.documents if key.endswith("artifacts/123"))
        run = next(key for key in self.documents if key.endswith("runs/111"))
        jobs = next(key for key in self.documents if "jobs?" in key)
        cases = [(artifact, "expired", True), (artifact, "digest", "sha256:" + "0" * 64),
                 (artifact, "name", "other-artifacts"), (run, "status", "in_progress"),
                 (run, "head_sha", "b" * 40), (run, "event", "pull_request"),
                 (run, "workflow_id", 12345), (run, "path", ".github/workflows/untrusted.yml"),
                 (artifact, "created_at", "2026-10-28T01:20:00Z"), (jobs, "total_count", 1000)]
        original = copy.deepcopy(self.documents)
        for path, field, value in cases:
            self.documents = copy.deepcopy(original)
            self.documents[path][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                self.restore()
            self.assertFalse(self.output.exists())
            self.assertEqual(self.downloads, [])
        for field, value in (("conclusion", "failure"), ("head_sha", "b" * 40)):
            self.documents = copy.deepcopy(original)
            self.documents[jobs]["jobs"][0][field] = value
            with self.subTest(job_field=field), self.assertRaises(ValueError):
                self.restore()
            self.assertEqual(self.downloads, [])
        for field in ("repository_id", "head_repository_id"):
            self.documents = copy.deepcopy(original)
            self.documents[artifact]["workflow_run"][field] = 555
            with self.subTest(repository=field), self.assertRaises(ValueError):
                self.restore()
            self.assertEqual(self.downloads, [])

    def test_input_context_and_pairing_require_explicit_manual_same_source_identity(self):
        retained.validate_inputs("", "")
        for artifact, digest in (("123", ""), ("", self.digest), ("../123", self.digest),
                                 ("0", self.digest), ("123", "sha256:wrong")):
            with self.subTest(artifact=artifact, digest=digest), self.assertRaises(ValueError):
                retained.validate_inputs(artifact, digest)
        for change in ({"GITHUB_REPOSITORY": "someone/fork"}, {"GITHUB_EVENT_NAME": "pull_request"},
                       {"GITHUB_SHA": "b" * 40}, {"GITHUB_RUN_ID": "111"}, {"GITHUB_RUN_ID": ""}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                retained.origin("123", self.digest, {**self.env, **change}, self.reader)

    def test_zip_digest_mismatch_stops_before_consumer_or_retention(self):
        self.zip.write_bytes(self.zip.read_bytes() + b"tampered")
        with patch.object(release, "consumer") as consumer, self.assertRaisesRegex(ValueError, "ZIP differs"):
            self.restore()
        consumer.assert_not_called()
        self.assertFalse(self.output.exists())

    def test_zip_traversal_duplicate_and_symlink_entries_are_not_extracted(self):
        for kind in ("traversal", "duplicate", "symlink"):
            bad = self.root / f"{kind}.zip"
            with zipfile.ZipFile(bad, "w") as package:
                for name in ("one", "two"):
                    package.writestr(name, b"data")
                if kind == "traversal":
                    package.writestr("../escape", b"bad")
                elif kind == "duplicate":
                    import warnings
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore", UserWarning)
                        package.writestr("one", b"duplicate")
                else:
                    info = zipfile.ZipInfo("link")
                    info.external_attr = 0o120777 << 16
                    package.writestr(info, b"/somewhere")
            digest = "sha256:" + hashlib.sha256(bad.read_bytes()).hexdigest()
            destination = self.root / f"{kind}-stage"
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                retained.unpack(bad, destination, {"one", "two", "link"} if kind == "symlink" else {"one", "two"}, digest)
            self.assertFalse(destination.exists())
            self.assertFalse((self.root / "escape").exists())

    def test_wrong_or_dirty_crate_source_rejects_before_revalidation(self):
        artifact = next(key for key in self.documents if key.endswith("artifacts/123"))
        for sha, dirty in (("b" * 40, None), (self.env["GITHUB_SHA"], True)):
            self.source_records(sha, dirty)
            self.pack()
            self.documents[artifact]["digest"] = self.digest
            with self.subTest(sha=sha, dirty=dirty), patch.object(release, "consumer") as consumer, \
                    self.assertRaisesRegex(ValueError, "crate source"):
                self.restore()
            consumer.assert_not_called()
            self.assertFalse(self.output.exists())

    def test_consumer_or_rust_failure_never_exposes_a_completed_restored_set(self):
        with patch.object(release, "consumer", side_effect=ValueError("consumer failed")), \
                self.assertRaisesRegex(ValueError, "consumer failed"):
            self.restore()
        self.assertFalse(self.output.exists())
        with patch.object(release, "consumer"), patch.object(release, "rust_rehearsal"), \
                self.assertRaises(FileNotFoundError):
            self.restore()
        self.assertFalse(self.output.exists())

    def test_existing_output_is_not_cleared_or_downloaded(self):
        self.output.mkdir()
        (self.output / "keep").write_text("untouched")
        with self.assertRaisesRegex(ValueError, "output must be new"):
            self.restore()
        self.assertEqual((self.output / "keep").read_text(), "untouched")
        self.assertEqual(self.downloads, [])

    def test_upload_jobs_still_download_only_their_own_revalidated_run(self):
        source = (release.ROOT / ".github/workflows/publish.yml").read_text()
        prepare, upload = source.split("\n  publish:\n")
        self.assertNotIn("id-token: write", prepare)
        self.assertIn("actions: read", prepare)
        self.assertIn("python3 tools/release.py restore", prepare)
        self.assertNotIn("run-id:", upload)
        self.assertNotIn("retained_artifact_id", upload)
        self.assertEqual(upload.count("name: release-packages-${{ github.sha }}"), 2)


if __name__ == "__main__":
    unittest.main()
