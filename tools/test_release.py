import io
import base64
import hashlib
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import release
import release_registry


class FixtureRegistry(release_registry.Registry):
    """Real registry parsers/checksums, with HTTP and upload commands replaced."""

    def __init__(self, artifacts):
        self.artifacts = artifacts
        self.responses = {}
        self.reads = []
        super().__init__(reader=self.read)
        for short, _ in release.NPM:
            self.known(f"@savvifi/meridian-{short}")
        for name in release.CRATES:
            self.known(name)

    def read(self, url):
        self.reads.append(url)
        return self.responses.get(url)

    def root(self, name):
        if name.startswith("@"):
            return "https://registry.npmjs.org/" + release_registry.quote(name, safe="")
        return "https://crates.io/api/v1/crates/" + name

    def known(self, name):
        data = ({"name": name, "versions": {}, "dist-tags": {}} if name.startswith("@")
                else {"crate": {"id": name}})
        self.responses[self.root(name)] = json.dumps(data).encode()

    def new_names(self):
        for name in release.BOOTSTRAP:
            self.responses.pop(self.root(name), None)

    def publish(self, name):
        if name.startswith("@"):
            short = name.split("/")[-1]
            data = (self.artifacts / f"savvifi-{short}-1.0.0.tgz").read_bytes()
            url = f"https://registry.npmjs.org/{name}/-/{short}-1.0.0.tgz"
            package = {"name": name, "version": "1.0.0", "dist": {"tarball": url,
                       "integrity": "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()}}
            document = {"name": name, "versions": {"1.0.0": package}, "dist-tags": {"latest": "1.0.0"}}
            self.responses[self.root(name)] = json.dumps(document).encode()
        else:
            self.known(name)
            data = (self.artifacts / f"{name}-1.0.0.crate").read_bytes()
            url = f"https://static.crates.io/crates/{name}/{name}-1.0.0.crate"
            document = {"version": {"crate": name, "num": "1.0.0", "yanked": False,
                                   "checksum": hashlib.sha256(data).hexdigest()}}
            self.responses[self.root(name) + "/1.0.0"] = json.dumps(document).encode()
        self.responses[url] = data


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
                    "CARGO_REGISTRY_TOKEN": "fixture-short-lived-credential",
                    "MERIDIAN_RELEASE_PUBLISH_ENABLED": "true", "MERIDIAN_RELEASE_PUBLISH_REQUESTED": "true"}
        self.registry = FixtureRegistry(self.artifacts)

    def npm(self, short, **extra):
        data = {"name": f"@savvifi/meridian-{short}", "version": "1.0.0", **extra}
        archive(self.artifacts / f"savvifi-meridian-{short}-1.0.0.tgz", "package/package.json", json.dumps(data))

    def sums(self):
        (self.artifacts / "SHA256SUMS").write_text(release.checksums(self.artifacts, self.version))

    def target(self):
        target = self.root / "rust"
        (target / "package/tmp-crate").mkdir(parents=True, exist_ok=True)
        for name in release.CRATES:
            filename = f"{name}-1.0.0.crate"
            release.rust_archive(target, filename).write_bytes((self.artifacts / filename).read_bytes())
        return target

    def runner(self, calls):
        def execute(args, **kwargs):
            calls.append((args, kwargs))
            if args[:2] == ["cargo", "metadata"]:
                return workspace()
            if args[:2] == ["git", "rev-parse"]:
                return "a" * 40 + "\n"
            if args[:2] == ["cargo", "publish"] and "--dry-run" not in args:
                for i, item in enumerate(args):
                    if item == "--package":
                        self.registry.publish(args[i + 1])
            if args[:2] == ["npm", "publish"]:
                short = Path(args[2]).name.removeprefix("savvifi-meridian-").removesuffix("-1.0.0.tgz")
                self.registry.publish(f"@savvifi/meridian-{short}")
            return ""
        return execute

    def bootstrap_env(self):
        return {**self.env, "MERIDIAN_RELEASE_PUBLISH_REQUESTED": "false",
                "MERIDIAN_RELEASE_BOOTSTRAP_ENABLED": "true", "MERIDIAN_RELEASE_BOOTSTRAP_REQUESTED": "true",
                "MERIDIAN_BOOTSTRAP_NPM_TOKEN": "fixture-npm-credential",
                "MERIDIAN_BOOTSTRAP_CRATES_TOKEN": "fixture-crate-credential"}

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
                    {**self.env, "MERIDIAN_RELEASE_BOOTSTRAP_REQUESTED": "true"},
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
        target = self.target()
        calls = []
        release.publish(self.artifacts, target, env=self.env, runner=self.runner(calls), registry=self.registry)
        uploads = [args for args, _ in calls if args[:2] in (["cargo", "publish"], ["npm", "publish"])
                   and "--dry-run" not in args]
        self.assertEqual(len(uploads), 8)  # one explicit subset invocation, seven npm uploads
        self.assertEqual([uploads[0][i + 1] for i, a in enumerate(uploads[0]) if a == "--package"], list(release.CRATES))
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
        prepare, jobs = source.split("\n  publish:\n")
        publish, bootstrap = jobs.split("\n  bootstrap:\n")
        self.assertNotIn("id-token: write", prepare)
        self.assertNotIn("crates-io-auth-action@", prepare)
        for gate in ("github.event_name == 'workflow_dispatch'", "inputs.publish == true",
                     "github.ref_type == 'tag'", "github.repository == 'meridian-ux/meridian'",
                     "vars.MERIDIAN_RELEASE_PUBLISH_ENABLED == 'true'", "environment: meridian-release"):
            self.assertIn(gate, publish)
        self.assertIn("default: false", prepare)
        self.assertIn("name: release-packages-${{ github.sha }}", publish)
        self.assertIn("python3 tools/release.py preflight-publish", publish)
        self.assertLess(publish.index("rehearse-rust"), publish.index("uses: rust-lang/crates-io-auth-action@"))
        self.assertIn("inputs.bootstrap != true", publish)
        self.assertIn("inputs.publish != true", bootstrap)
        for gate in ("github.event_name == 'workflow_dispatch'", "inputs.bootstrap == true",
                     "github.ref_type == 'tag'", "github.repository == 'meridian-ux/meridian'",
                     "vars.MERIDIAN_RELEASE_BOOTSTRAP_ENABLED == 'true'", "environment: meridian-release"):
            self.assertIn(gate, bootstrap)
        self.assertNotIn("id-token: write", bootstrap)
        self.assertNotIn("crates-io-auth-action", bootstrap)
        self.assertNotIn("BOOTSTRAP_NPM_TOKEN", prepare + publish)
        self.assertIn("group: meridian-registry-publication", bootstrap)
        self.assertIn("python3 tools/release.py registry-plan", prepare)
        self.assertIn("if: steps.preflight.outputs.crates_missing == 'true'", publish)

    def test_bootstrap_uploads_only_four_new_names_with_separate_credentials(self):
        self.registry.new_names()
        calls = []
        release.publish(self.artifacts, self.target(), env=self.bootstrap_env(), bootstrap=True,
                        runner=self.runner(calls), registry=self.registry)
        uploads = [(a, k) for a, k in calls if a[:2] in (["cargo", "publish"], ["npm", "publish"])
                   and "--dry-run" not in a]
        self.assertEqual(len(uploads), 2)
        self.assertEqual([uploads[0][0][i + 1] for i, a in enumerate(uploads[0][0]) if a == "--package"], list(release.CRATES))
        self.assertIn("savvifi-meridian-web-1.0.0.tgz", uploads[1][0][2])
        self.assertEqual(uploads[0][1]["env"]["CARGO_REGISTRY_TOKEN"], "fixture-crate-credential")
        self.assertNotIn("NODE_AUTH_TOKEN", uploads[0][1]["env"])
        self.assertEqual(uploads[1][1]["env"]["NODE_AUTH_TOKEN"], "fixture-npm-credential")
        self.assertNotIn("CARGO_REGISTRY_TOKEN", uploads[1][1]["env"])
        for args, kwargs in calls:
            if args[:2] == ["cargo", "publish"]:
                self.assertNotIn("MERIDIAN_BOOTSTRAP_NPM_TOKEN", kwargs["env"])
                self.assertNotIn("MERIDIAN_BOOTSTRAP_CRATES_TOKEN", kwargs["env"])
                if "--dry-run" in args:
                    self.assertNotIn("CARGO_REGISTRY_TOKEN", kwargs["env"])

    def test_resume_after_bootstrap_only_uploads_six_existing_npm_packages(self):
        for name in release.BOOTSTRAP:
            self.registry.publish(name)
        calls = []
        release.publish(self.artifacts, self.target(), env=self.env, runner=self.runner(calls), registry=self.registry)
        uploads = [a for a, _ in calls if a[:2] in (["cargo", "publish"], ["npm", "publish"])]
        self.assertEqual(len(uploads), 6)
        self.assertTrue(all(a[:2] == ["npm", "publish"] for a in uploads))
        self.assertTrue(all("savvifi-meridian-web-1.0.0.tgz" not in a[2] for a in uploads))

    def test_partial_bootstrap_timeout_stops_then_explicit_retry_skips_confirmed_versions(self):
        self.registry.new_names()
        calls = []
        real = self.runner(calls)
        def timeout(args, **kwargs):
            if args[:2] == ["cargo", "publish"] and "--dry-run" not in args:
                calls.append((args, kwargs))
                for name in release.CRATES[:2]:
                    self.registry.publish(name)
                raise TimeoutError("ambiguous upload result")
            return real(args, **kwargs)
        with self.assertRaises(TimeoutError):
            release.publish(self.artifacts, self.target(), env=self.bootstrap_env(), bootstrap=True,
                            runner=timeout, registry=self.registry)
        self.assertFalse(any(a[:2] == ["npm", "publish"] for a, _ in calls))
        calls.clear()
        # Models a new separately authorized attempt; there is no automatic retry.
        release.publish(self.artifacts, self.target(), env=self.bootstrap_env(), bootstrap=True,
                        runner=self.runner(calls), registry=self.registry)
        cargo = [a for a, _ in calls if a[:2] == ["cargo", "publish"] and "--dry-run" not in a][0]
        self.assertEqual(cargo[cargo.index("--package") + 1:], ["meridian-tui"])

    def test_completed_release_is_verified_without_any_upload(self):
        for name in [*release.FIRST_PARTY_NAMES, *release.CRATES]:
            self.registry.publish(name)
        calls = []
        release.publish(self.artifacts, self.target(), env=self.env, runner=self.runner(calls), registry=self.registry)
        self.assertFalse(any(a[:2] in (["npm", "publish"], ["cargo", "publish"]) for a, _ in calls))

    def test_partial_npm_timeout_requires_new_attempt_and_skips_confirmed_tarball(self):
        for name in release.BOOTSTRAP:
            self.registry.publish(name)
        calls = []
        real = self.runner(calls)
        def timeout(args, **kwargs):
            value = real(args, **kwargs)
            if args[:2] == ["npm", "publish"]:
                raise TimeoutError("npm may have accepted upload")
            return value
        with self.assertRaises(TimeoutError):
            release.publish(self.artifacts, self.target(), env=self.env, runner=timeout, registry=self.registry)
        self.assertEqual(sum(a[:2] == ["npm", "publish"] for a, _ in calls), 1)
        calls.clear()
        release.publish(self.artifacts, self.target(), env=self.env, runner=self.runner(calls), registry=self.registry)
        uploads = [a for a, _ in calls if a[:2] == ["npm", "publish"]]
        self.assertEqual(len(uploads), 5)
        self.assertTrue(all("meridian-proto-ts-1.0.0.tgz" not in a[2] for a in uploads))

    def test_normal_lane_never_falls_back_to_bootstrap_credential(self):
        env = {**self.env, "CARGO_REGISTRY_TOKEN": "", "MERIDIAN_BOOTSTRAP_CRATES_TOKEN": "fixture-bootstrap"}
        calls = []
        with self.assertRaisesRegex(ValueError, "short-lived crate credential missing"):
            release.publish(self.artifacts, self.target(), env=env, runner=self.runner(calls), registry=self.registry)
        self.assertFalse(any(a[:2] in (["npm", "publish"], ["cargo", "publish"]) for a, _ in calls))

    def test_bootstrap_credentials_and_gate_fail_before_upload(self):
        self.registry.new_names()
        changes = [{"MERIDIAN_RELEASE_BOOTSTRAP_ENABLED": "false"},
                   {"MERIDIAN_RELEASE_BOOTSTRAP_REQUESTED": "false"},
                   {"MERIDIAN_RELEASE_PUBLISH_REQUESTED": "true"},
                   {"MERIDIAN_BOOTSTRAP_NPM_TOKEN": ""}, {"MERIDIAN_BOOTSTRAP_CRATES_TOKEN": ""},
                   {"GITHUB_EVENT_NAME": "push"}, {"GITHUB_REPOSITORY": "someone/fork"},
                   {"GITHUB_REF": "refs/heads/main"}]
        for change in changes:
            calls = []
            with self.subTest(change=change), self.assertRaises(ValueError):
                release.publish(self.artifacts, self.target(), env={**self.bootstrap_env(), **change}, bootstrap=True,
                                runner=self.runner(calls), registry=self.registry)
            self.assertFalse(any(a[:2] in (["npm", "publish"], ["cargo", "publish"]) for a, _ in calls))
        with self.assertRaisesRegex(ValueError, "1.0.0 boundary"):
            release.authorize({**self.bootstrap_env(), "GITHUB_REF": "refs/tags/v1.0.1"}, "1.0.1", True)

    def test_oidc_lane_rejects_unbootstrapped_names(self):
        self.registry.new_names()
        calls = []
        with self.assertRaisesRegex(ValueError, "bootstrap"):
            release.publish(self.artifacts, self.target(), env=self.env, runner=self.runner(calls), registry=self.registry)
        self.assertFalse(any(a[:2] in (["npm", "publish"], ["cargo", "publish"]) for a, _ in calls))

    def test_bootstrap_existing_name_without_target_version_requires_owner_review(self):
        calls = []
        with self.assertRaisesRegex(ValueError, "already exists"):
            release.publish(self.artifacts, self.target(), env=self.bootstrap_env(), bootstrap=True,
                            runner=self.runner(calls), registry=self.registry)
        self.assertFalse(any(a[:2] in (["npm", "publish"], ["cargo", "publish"]) for a, _ in calls))

    def test_published_archive_mismatch_anywhere_stops_before_first_upload(self):
        # Even the last package in the inventory is verified before any upload.
        name = "meridian-tui"
        self.registry.publish(name)
        self.registry.responses[f"https://static.crates.io/crates/{name}/{name}-1.0.0.crate"] = b"wrong"
        calls = []
        with self.assertRaisesRegex(ValueError, "registry bytes differ"):
            release.publish(self.artifacts, self.target(), env=self.env, runner=self.runner(calls), registry=self.registry)
        self.assertFalse(any(a[:2] in (["npm", "publish"], ["cargo", "publish"]) for a, _ in calls))

    def test_bad_npm_integrity_tarball_identity_and_dist_tag_reject(self):
        name = "@savvifi/meridian-web"
        for field in ("integrity", "tarball", "name", "latest", "bytes"):
            self.registry.publish(name)
            url = self.registry.root(name)
            document = json.loads(self.registry.responses[url])
            package = document["versions"]["1.0.0"]
            if field in ("integrity", "tarball"):
                package["dist"][field] = "https://untrusted.invalid/file" if field == "tarball" else "sha512-wrong"
            elif field == "name":
                package["name"] = "@someone/other"
            elif field == "latest":
                document["dist-tags"]["latest"] = "0.25.1"
            else:
                self.registry.responses[package["dist"]["tarball"]] = b"different"
            self.registry.responses[url] = json.dumps(document).encode()
            with self.subTest(field=field), self.assertRaises(ValueError):
                release.registry_state(self.artifacts, "1.0.0", self.registry)

    def test_yanked_crate_and_wrong_checksum_reject(self):
        name = "meridian-uiview"
        for field, value in (("yanked", True), ("checksum", "0" * 64), ("num", "0.25.1")):
            self.registry.publish(name)
            url = self.registry.root(name) + "/1.0.0"
            document = json.loads(self.registry.responses[url])
            document["version"][field] = value
            self.registry.responses[url] = json.dumps(document).encode()
            with self.subTest(field=field), self.assertRaises(ValueError):
                release.registry_state(self.artifacts, "1.0.0", self.registry)

    def test_unconfirmed_success_does_not_continue_to_next_registry(self):
        calls = []
        def runner(args, **kwargs):
            calls.append((args, kwargs))
            if args[:2] == ["cargo", "metadata"]:
                return workspace()
            return "a" * 40 + "\n" if args[:2] == ["git", "rev-parse"] else ""
        with self.assertRaisesRegex(ValueError, "not confirmed"):
            release.publish(self.artifacts, self.target(), env=self.env, runner=runner, registry=self.registry)
        self.assertFalse(any(a[:2] == ["npm", "publish"] for a, _ in calls))

    def test_selected_rehearsal_mismatch_stops_before_authenticated_upload(self):
        calls = []
        target = self.target()
        real = self.runner(calls)
        def tamper(args, **kwargs):
            if args[:2] == ["cargo", "publish"] and "--dry-run" in args:
                release.rust_archive(target, "meridian-tui-1.0.0.crate").write_bytes(b"changed")
            return real(args, **kwargs)
        with self.assertRaisesRegex(ValueError, "rehearsed crate differs"):
            release.publish(self.artifacts, target, env=self.env, runner=tamper, registry=self.registry)
        self.assertFalse(any(a[:2] in (["npm", "publish"], ["cargo", "publish"])
                             and "--dry-run" not in a for a, _ in calls))

    def test_registry_network_errors_never_mean_missing(self):
        from urllib.error import HTTPError
        for status in (401, 403, 429, 500):
            opener = unittest.mock.Mock()
            opener.open.side_effect = HTTPError("https://crates.io", status, "error", {}, None)
            with self.subTest(status=status), patch.object(release_registry, "build_opener", return_value=opener), \
                    self.assertRaisesRegex(ValueError, f"HTTP {status}"):
                release_registry.fetch("https://crates.io/api/v1/crates/meridian-tui")
        opener.open.side_effect = HTTPError("https://crates.io", 404, "not found", {}, None)
        with patch.object(release_registry, "build_opener", return_value=opener):
            self.assertIsNone(release_registry.fetch("https://crates.io/api/v1/crates/meridian-tui"))
        with self.assertRaisesRegex(ValueError, "redirects"):
            release_registry.NoRedirect().redirect_request(None, None, 302, "moved", {}, "https://untrusted.invalid")

    def test_registry_timeout_or_malformed_document_stops_before_upload(self):
        for problem in (TimeoutError("registry timed out"), b"not json", b"[]"):
            calls = []
            def reader(url):
                if url == self.registry.root("meridian-tui"):
                    if isinstance(problem, Exception):
                        raise problem
                    return problem
                return self.registry.read(url)
            with self.subTest(problem=problem), self.assertRaises((ValueError, TimeoutError)):
                release.publish(self.artifacts, self.target(), env=self.env, runner=self.runner(calls),
                                registry=release_registry.Registry(reader))
            self.assertFalse(any(a[:2] in (["npm", "publish"], ["cargo", "publish"]) for a, _ in calls))

    def test_registry_transport_is_unauthenticated_bounded_and_rejects_non_200(self):
        response = unittest.mock.MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.read.return_value = b'{}'
        opener = unittest.mock.Mock()
        opener.open.return_value = response
        with patch.object(release_registry, "build_opener", return_value=opener):
            self.assertEqual(release_registry.fetch("https://crates.io/api/v1/crates/meridian-tui"), b'{}')
            request = opener.open.call_args.args[0]
            self.assertEqual(request.get_method(), "GET")
            self.assertNotIn("Authorization", dict(request.header_items()))
            self.assertEqual(opener.open.call_args.kwargs["timeout"], 30)
            self.assertEqual(response.read.call_args.args, (64 * 1024 * 1024 + 1,))
            response.status = 201
            with self.assertRaisesRegex(ValueError, "unexpected registry response"):
                release_registry.fetch("https://crates.io/api/v1/crates/meridian-tui")

    def test_read_only_cli_plan_never_executes_commands_or_writes_state(self):
        with patch.object(sys, "argv", ["release.py", "registry-plan", "--artifacts", str(self.artifacts)]), \
                patch.object(release, "Registry", return_value=self.registry), patch.object(release, "run") as runner, \
                patch("sys.stdout", new_callable=io.StringIO) as output:
            release.main()
        runner.assert_not_called()
        self.assertEqual(len(output.getvalue().splitlines()), 10)
        self.assertEqual(len(list(self.artifacts.iterdir())), 11)

    def test_preflight_output_skips_oidc_when_no_crates_are_missing(self):
        for name in release.CRATES:
            self.registry.publish(name)
        output = self.root / "github-output"
        with patch.object(sys, "argv", ["release.py", "preflight-publish", "--artifacts", str(self.artifacts)]), \
                patch.dict(release.os.environ, {**self.env, "GITHUB_OUTPUT": str(output)}, clear=True), \
                patch.object(release, "Registry", return_value=self.registry), patch.object(release, "source_identity"):
            release.main()
        self.assertEqual(output.read_text(), "crates_missing=false\n")

    def test_completed_bootstrap_needs_no_credentials_and_uploads_nothing(self):
        for name in release.BOOTSTRAP:
            self.registry.publish(name)
        env = self.bootstrap_env()
        env.pop("MERIDIAN_BOOTSTRAP_NPM_TOKEN")
        env.pop("MERIDIAN_BOOTSTRAP_CRATES_TOKEN")
        calls = []
        release.publish(self.artifacts, self.target(), env=env, bootstrap=True,
                        runner=self.runner(calls), registry=self.registry)
        self.assertFalse(any(a[:2] in (["npm", "publish"], ["cargo", "publish"]) for a, _ in calls))


if __name__ == "__main__":
    unittest.main()
