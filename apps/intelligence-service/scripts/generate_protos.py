"""Generate the Python gRPC bindings consumed by intelligence-service.

adsq.proto is Planning's real ADS Q client; capability.proto is Capability
Resolver's real server contract; modelgw.proto is the
embedding-transport follow-up's real Embed client (embedding_client.py's
GrpcEmbeddingClient -- see that module's own doc), closing the gap
flagged in selection_binding/embedding_client.py's NotImplementedEmbeddingClient.
"""

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
PROTO_FILES = (
    "alter/adsq/v1/adsq.proto",
    "alter/capability/v1/capability.proto",
    "alter/modelgw/v1/modelgw.proto",
    "alter/planner/v1/planner.proto",
)


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
            *(str(PROTO_ROOT / path) for path in PROTO_FILES),
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
