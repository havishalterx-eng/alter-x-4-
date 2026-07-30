"""Generate the ADS Q Python gRPC bindings consumed by Planning."""

from __future__ import annotations

import argparse
import filecmp
import subprocess
import sys
import tempfile
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_ROOT.parents[1]
PROTO_ROOT = REPO_ROOT / "packages" / "contracts" / "proto"
PROTO_FILE = "alter/adsq/v1/adsq.proto"


def generate(output: Path) -> None:
    subprocess.run(
        [
            sys.executable,
            "-m",
            "grpc_tools.protoc",
            f"-I{PROTO_ROOT}",
            f"--python_out={output}",
            f"--pyi_out={output}",
            f"--grpc_python_out={output}",
            str(PROTO_ROOT / PROTO_FILE),
        ],
        check=True,
    )


def _bindings(root: Path) -> dict[str, Path]:
    return {
        str(path.relative_to(root)): path
        for path in root.glob("alter/**/*")
        if path.is_file() and path.suffix in {".py", ".pyi"} and "_pb2" in path.name
    }


def check() -> int:
    with tempfile.TemporaryDirectory(prefix="alterx-intelligence-proto-") as directory:
        generated_root = Path(directory)
        generate(generated_root)
        expected, actual = _bindings(generated_root), _bindings(SERVICE_ROOT)
        differences = sorted(
            set(expected) ^ set(actual)
            | {
                name
                for name in expected.keys() & actual.keys()
                if not filecmp.cmp(expected[name], actual[name], shallow=False)
            }
        )
        if differences:
            print("Python protobuf bindings are stale; run scripts/generate_protos.py")
            for name in differences:
                print(f"  {name}")
            return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    if parser.parse_args().check:
        return check()
    generate(SERVICE_ROOT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
