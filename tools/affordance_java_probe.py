#!/usr/bin/env python3
"""Compile old Java consumers against isolated migration descriptors; never install a JDK."""
import argparse
import hashlib
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_SHA256 = "3ca892fd6ea8b37d01bb6917dbc0bf2637548b756753f65a28d4f1d4d982347f"


def run(command, *, failure=False):
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=120)
    if failure:
        if result.returncode == 0 or "descriptor ownership changed" not in result.stderr:
            raise RuntimeError(f"Expected descriptor-ownership failure: {result.stdout}\n{result.stderr}")
    elif result.returncode:
        raise RuntimeError(f"Command failed: {command}\n{result.stdout}\n{result.stderr}")
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scratch", type=Path, required=True, help="Retained Node proposal probe directory")
    parser.add_argument("--protoc", required=True)
    parser.add_argument("--java", required=True)
    parser.add_argument("--javac", required=True)
    parser.add_argument("--runtime-jar", type=Path, required=True, help="protobuf-java 4.33.4")
    parser.add_argument("--removal", action="store_true", help="Also require the actual final-removal consumer to pass")
    args = parser.parse_args()
    if hashlib.sha256(args.runtime_jar.read_bytes()).hexdigest() != RUNTIME_SHA256:
        raise RuntimeError("Expected the exact protobuf-java 4.33.4 runtime artifact")
    if run([args.protoc, "--version"]) != "libprotoc 33.4":
        raise RuntimeError("Use the repository-pinned protoc 33.4")
    version = run([args.javac, "-version"])
    if not version.startswith("javac 21."):
        raise RuntimeError("This probe is recorded with JDK 21")
    sources = sorted("proto/" + path.name for path in (ROOT / "schemas/proto").glob("*.proto")
                     if path.name != "interaction.proto")
    sources.append("google/api/field_behavior.proto")
    with tempfile.TemporaryDirectory(prefix="meridian-affordance-java-") as temporary:
        work = Path(temporary)
        classes = {}
        for name in ["old", "relocated", "candidate"]:
            generated, output = work / name / "sources", work / name / "classes"
            generated.mkdir(parents=True)
            output.mkdir()
            image = args.scratch / f"{name}.binpb"
            if not image.is_file():
                raise RuntimeError(f"Missing retained probe descriptor: {image}")
            paths = sources + ([] if name == "old" else ["proto/interaction.proto"])
            run([args.protoc, f"--descriptor_set_in={image}", f"--java_out={generated}", *paths])
            run([args.javac, "-cp", str(args.runtime_jar), "-d", str(output),
                 *map(str, sorted(generated.rglob("*.java")))])
            classes[name] = output
        consumers = work / "consumers"
        consumers.mkdir()
        run([args.javac, "-cp", f"{classes['old']}:{args.runtime_jar}", "-d", str(consumers),
             str(ROOT / "schemas/migration/LegacyAffordanceConsumer.java")])
        for name, output in classes.items():
            command = [args.java, "-cp", f"{consumers}:{output}:{args.runtime_jar}", "LegacyAffordanceConsumer"]
            print(f"{name}: {run(command)}")
            run([*command, "--legacy-descriptor"], failure=name != "old")
        if args.removal:
            run([args.javac, "-cp", f"{classes['candidate']}:{args.runtime_jar}", "-d", str(consumers),
                 str(ROOT / "schemas/migration/CanonicalAffordanceConsumer.java")])
            print(run([args.java, "-cp", f"{consumers}:{classes['candidate']}:{args.runtime_jar}", "CanonicalAffordanceConsumer"]))
        print(f"Java probe passed with {version}: unchanged legacy bytecode works in all three worlds; "
              "descriptor-ownership assertions fail in both migrated worlds as expected.")


if __name__ == "__main__":
    main()
