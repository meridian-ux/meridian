"""Restore immutable GitHub artifacts; consume GitHub JSON and standard ZIP only."""

from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import stat
import subprocess
import zipfile

REPOSITORY = "meridian-ux/meridian"
REPOSITORY_ID = 1331268991
WORKFLOW = ".github/workflows/publish.yml"
LIMIT = 128 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def api(path):
    return json.loads(subprocess.run(["gh", "api", path], check=True, text=True,
                                     stdout=subprocess.PIPE).stdout)


def download(artifact_id, destination):
    # gh handles GitHub's signed download redirect without forwarding the API
    # credential to the storage host. Never place credentials in argv or files.
    with Path(destination).open("xb") as output:
        subprocess.run(["gh", "api", f"repos/{REPOSITORY}/actions/artifacts/{artifact_id}/zip"],
                       check=True, stdout=output)


def validate_inputs(artifact_id, expected_digest):
    require(bool(artifact_id) == bool(expected_digest), "retained artifact ID and ZIP digest must be paired")
    if artifact_id:
        require(re.fullmatch(r"[1-9][0-9]*", str(artifact_id)), "invalid retained artifact ID")
        require(re.fullmatch(r"sha256:[0-9a-f]{64}", expected_digest), "explicit retained ZIP digest required")


def origin(artifact_id, expected_digest, env, reader=api):
    require(env.get("GITHUB_REPOSITORY") == REPOSITORY
            and env.get("GITHUB_EVENT_NAME") == "workflow_dispatch", "restore requires an official manual run")
    sha = env.get("GITHUB_SHA", "")
    require(re.fullmatch(r"[0-9a-f]{40}", sha), "invalid restore source SHA")
    validate_inputs(artifact_id, expected_digest)
    require(bool(artifact_id), "retained artifact ID required")
    require(re.fullmatch(r"[1-9][0-9]*", env.get("GITHUB_RUN_ID", "")), "current run identity required")
    artifact = reader(f"repos/{REPOSITORY}/actions/artifacts/{artifact_id}")
    require(artifact.get("id") == int(artifact_id) and artifact.get("expired") is False
            and artifact.get("name") == f"release-packages-{sha}"
            and artifact.get("digest") == expected_digest, "retained artifact identity/digest mismatch")
    require(0 < artifact.get("size_in_bytes", 0) <= LIMIT, "retained ZIP size exceeds limit")
    source = artifact.get("workflow_run", {})
    require(source.get("repository_id") == REPOSITORY_ID
            and source.get("head_repository_id") == REPOSITORY_ID
            and source.get("head_sha") == sha, "retained artifact has a different repository/source")
    run_id = source.get("id")
    require(type(run_id) is int and run_id > 0 and str(run_id) != env.get("GITHUB_RUN_ID"),
            "retained artifact must come from a different completed run")
    run = reader(f"repos/{REPOSITORY}/actions/runs/{run_id}")
    workflow = reader(f"repos/{REPOSITORY}/actions/workflows/publish.yml")
    require(run.get("id") == run_id and run.get("status") == "completed"
            and run.get("event") in ("push", "workflow_dispatch")
            and run.get("head_sha") == sha and run.get("path") == WORKFLOW
            and run.get("workflow_id") == workflow.get("id")
            and type(workflow.get("id")) is int and workflow.get("path") == WORKFLOW
            and run.get("repository", {}).get("id") == REPOSITORY_ID
            and run.get("head_repository", {}).get("id") == REPOSITORY_ID,
            "retained artifact is not from the completed official release workflow/source")
    jobs = reader(f"repos/{REPOSITORY}/actions/runs/{run_id}/jobs?filter=all&per_page=100")
    require(jobs.get("total_count") == len(jobs.get("jobs", [])), "incomplete origin job inventory")
    created = datetime.fromisoformat(artifact["created_at"])
    # A partially failed publication is a valid origin, but only its successful
    # preparation job may vouch for an artifact created during that job.
    require(any(job.get("name") == "prepare" and job.get("conclusion") == "success"
                and job.get("head_sha") == sha
                and datetime.fromisoformat(job["started_at"]) <= created
                <= datetime.fromisoformat(job["completed_at"])
                for job in jobs["jobs"]), "no successful origin preparation covers this artifact")
    return artifact


def unpack(archive, destination, names, expected_digest):
    archive, destination = Path(archive), Path(destination)
    require(archive.stat().st_size <= LIMIT, "retained ZIP exceeds limit")
    with archive.open("rb") as stream:
        require("sha256:" + hashlib.file_digest(stream, "sha256").hexdigest() == expected_digest,
                "downloaded ZIP differs from approved digest")
    require(not destination.exists(), "restore staging must be new")
    with zipfile.ZipFile(archive) as package:
        entries = package.infolist()
        require(len(entries) == len(names) and {item.filename for item in entries} == set(names),
                "retained ZIP must contain exactly the flat release inventory")
        require(all(not item.is_dir() and not stat.S_ISLNK(item.external_attr >> 16)
                    and not item.flag_bits & 1 and 0 <= item.file_size <= LIMIT for item in entries)
                and sum(item.file_size for item in entries) <= LIMIT, "invalid/oversized retained ZIP entry")
        destination.mkdir()
        for item in entries:
            # No extractall, paths, permissions or executable bits from the ZIP.
            data = package.read(item)
            require(len(data) == item.file_size, "retained ZIP entry size mismatch")
            (destination / item.filename).write_bytes(data)
