import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import release


def archive(path, member, text):
    with tarfile.open(path, "w:gz") as package:
        data = text.encode()
        info = tarfile.TarInfo(member)
        info.size = len(data)
        package.addfile(info, io.BytesIO(data))


def workspace(extra=()):
    names = [*release.CRATES, *extra]
    return json.dumps({"workspace_members": names,
                       "packages": [{"id": n, "name": n, "version": "1.0.0", "publish": None} for n in names]})


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        self.root = Path(self.work.name)
        self.artifacts = self.root / "artifacts"
        self.artifacts.mkdir()
        self.version = "1.0.0"
        for name, _ in release.NPM:
            self.npm(name)
        for name in release.CRATES:
            text = f'[package]\nname = "{name}"\nversion = "1.0.0"\n'
            if name == "meridian-tui":
                text += '[dependencies.meridian-uiview]\nversion = "=1.0.0"\n'
            archive(self.artifacts / f"{name}-1.0.0.crate", f"{name}-1.0.0/Cargo.toml", text)
        self.sums()
        self.env = {"GITHUB_REPOSITORY": "meridian-ux/meridian", "GITHUB_EVENT_NAME": "workflow_dispatch",
                    "GITHUB_REF": "refs/tags/v1.0.0", "GITHUB_SHA": "a" * 40,
                    "MERIDIAN_RELEASE_PUBLISH_ENABLED": "true", "MERIDIAN_RELEASE_PUBLISH_REQUESTED": "true"}

    def npm(self, short, **extra):
        data = {"name": f"@savvifi/meridian-{short}", "version": "1.0.0", **extra}
        archive(self.artifacts / f"savvifi-meridian-{short}-1.0.0.tgz", "package/package.json", json.dumps(data))

    def sums(self):
        (self.artifacts / "SHA256SUMS").write_text(release.checksums(self.artifacts, self.version))

    def test_complete_set_has_seven_npm_packages_and_three_crates(self):
        self.assertEqual(len(release.filenames(self.version)), 10)
        release.verify(self.artifacts, self.version)

    def test_missing_extra_or_tampered_archive_rejects(self):
        name = release.filenames(self.version)[0]
        path = self.artifacts / name
        original = path.read_bytes()
        for mutation in ("missing", "extra", "changed"):
            with self.subTest(mutation=mutation):
                path.write_bytes(original)
                extra = self.artifacts / "unexpected.crate"
                if mutation == "missing":
                    path.unlink()
                elif mutation == "extra":
                    extra.write_bytes(b"extra")
                else:
                    path.write_bytes(b"changed")
                with self.assertRaises(ValueError):
                    release.verify(self.artifacts, self.version)
                if extra.exists():
                    extra.unlink()
        path.write_bytes(original)

    def test_rehashed_wrong_identity_and_dependency_skew_still_reject(self):
        for extra in ({"version": "0.25.1"}, {"private": True},
                      {"dependencies": {"@savvifi/meridian-proto-ts": "^1.0.0"}},
                      {"optionalDependencies": {"external": "file:../external"}},
                      {"peerDependencies": {"@savvifi/meridian-schemas": "workspace:*"}}):
            with self.subTest(extra=extra):
                self.npm("web", **extra)
                self.sums()
                with self.assertRaises(ValueError):
                    release.verify(self.artifacts, self.version)

    def test_normalized_crate_must_not_keep_path_or_skew(self):
        file = self.artifacts / "meridian-tui-1.0.0.crate"
        for declaration in ('version = "^1.0.0"', 'version = "=1.0.0"\npath = "../core"'):
            archive(file, "meridian-tui-1.0.0/Cargo.toml",
                    '[package]\nname="meridian-tui"\nversion="1.0.0"\n[dependencies.meridian-uiview]\n' + declaration)
            self.sums()
            with self.assertRaises(ValueError):
                release.verify(self.artifacts, self.version)

    def test_first_party_dependency_must_publish_before_its_consumer(self):
        self.npm("proto-ts", dependencies={"@savvifi/meridian-web": "1.0.0"})
        self.sums()
        with self.assertRaisesRegex(ValueError, "publication order"):
            release.verify(self.artifacts, self.version)

    def test_existing_output_is_never_cleared_or_repacked(self):
        original = (self.artifacts / "SHA256SUMS").read_bytes()
        with patch.object(release, "run") as runner, self.assertRaises(ValueError):
            release.prepare(self.artifacts)
        runner.assert_not_called()
        self.assertEqual((self.artifacts / "SHA256SUMS").read_bytes(), original)

    def test_unauthorized_context_never_reaches_an_upload(self):
        contexts = [{}, {**self.env, "GITHUB_EVENT_NAME": "pull_request"},
                    {**self.env, "GITHUB_EVENT_NAME": "push"},
                    {**self.env, "GITHUB_REF": "refs/heads/main"},
                    {**self.env, "GITHUB_REF": "refs/tags/v0.25.1"},
                    {**self.env, "GITHUB_REPOSITORY": "someone/fork"},
                    {**self.env, "MERIDIAN_RELEASE_PUBLISH_ENABLED": "false"},
                    {**self.env, "MERIDIAN_RELEASE_PUBLISH_REQUESTED": "false"}]
        for env in contexts:
            calls = []
            with self.subTest(env=env), self.assertRaises(ValueError):
                release.publish(self.artifacts, self.root / "rust", env=env,
                                runner=lambda *args, **kwargs: calls.append(args))
            self.assertEqual(calls, [])

    def test_mismatched_rehearsed_crate_prevents_all_uploads(self):
        target = self.root / "rust"
        (target / "package/tmp-crate").mkdir(parents=True)
        for name in release.CRATES:
            release.rust_archive(target, f"{name}-1.0.0.crate").write_bytes(b"different bytes")
        calls = []
        def runner(args, **kwargs):
            calls.append(args)
            if args[:2] == ["cargo", "metadata"]:
                return workspace()
            return "a" * 40 + "\n" if args[:2] == ["git", "rev-parse"] else ""
        with self.assertRaises(ValueError):
            release.publish(self.artifacts, target, env=self.env, runner=runner)
        self.assertTrue(all(args[0] == "git" or args[:2] == ["cargo", "metadata"] for args in calls))

    def test_guarded_upload_plan_keeps_verification_and_dependency_order(self):
        # No registry operation executes: only the command adapter is replaced.
        # Actual archives/metadata/checksum checks still execute above it.
        target = self.root / "rust"
        (target / "package/tmp-crate").mkdir(parents=True)
        for name in release.CRATES:
            filename = f"{name}-1.0.0.crate"
            release.rust_archive(target, filename).write_bytes((self.artifacts / filename).read_bytes())
        calls = []
        def runner(args, **kwargs):
            calls.append(args)
            if args[:2] == ["cargo", "metadata"]:
                return workspace()
            return "a" * 40 + "\n" if args[:2] == ["git", "rev-parse"] else ""
        release.publish(self.artifacts, target, env=self.env, runner=runner)
        uploads = [args for args in calls if args[:2] in (["cargo", "publish"], ["npm", "publish"])]
        self.assertEqual(len(uploads), 8)  # one workspace invocation, seven npm uploads
        self.assertIn("--workspace", uploads[0])
        self.assertIn("--locked", uploads[0])
        self.assertNotIn("--no-verify", uploads[0])
        self.assertNotIn("--allow-dirty", uploads[0])
        for args, (name, _) in zip(uploads[1:], release.NPM):
            self.assertIn(f"savvifi-meridian-{name}-1.0.0.tgz", args[2])
            self.assertIn("--ignore-scripts", args)
            self.assertEqual(args[args.index("--tag") + 1], "latest")

    def test_rehearsal_never_requests_upload_or_credentials(self):
        with patch.object(release, "run", return_value=workspace()) as runner:
            release.rust_rehearsal(self.root / "rust")
        args = runner.call_args.args[0]
        self.assertIn("--dry-run", args)
        self.assertIn("--workspace", args)
        self.assertIn("--locked", args)
        self.assertNotIn("--token", args)

    def test_an_additional_publishable_workspace_member_is_not_silently_uploaded(self):
        with self.assertRaisesRegex(ValueError, "three-crate release"):
            release.workspace_identity("1.0.0", runner=lambda *args, **kwargs: workspace(("surprise",)))

    def test_wrong_source_sha_never_reaches_upload(self):
        calls = []
        def runner(args, **kwargs):
            calls.append(args)
            return "b" * 40 + "\n"
        with self.assertRaisesRegex(ValueError, "SHA mismatch"):
            release.publish(self.artifacts, self.root / "rust", env=self.env, runner=runner)
        self.assertEqual(calls, [["git", "rev-parse", "HEAD"]])

    def test_workflow_credential_lane_is_separate_and_owner_gated(self):
        source = (release.ROOT / ".github/workflows/publish.yml").read_text()
        prepare, publish = source.split("\n  publish:\n")
        self.assertNotIn("id-token: write", prepare)
        self.assertNotIn("crates-io-auth-action@", prepare)
        for gate in ("github.event_name == 'workflow_dispatch'", "inputs.publish == true",
                     "github.ref_type == 'tag'", "github.repository == 'meridian-ux/meridian'",
                     "vars.MERIDIAN_RELEASE_PUBLISH_ENABLED == 'true'", "environment: meridian-release"):
            self.assertIn(gate, publish)
        self.assertIn("default: false", prepare)
        self.assertIn("name: release-packages-${{ github.sha }}", publish)
        self.assertIn("python3 tools/release.py authorize", publish)
        self.assertLess(publish.index("rehearse-rust"), publish.index("uses: rust-lang/crates-io-auth-action@"))


if __name__ == "__main__":
    unittest.main()
