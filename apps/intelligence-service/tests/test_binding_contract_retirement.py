from pathlib import Path


def test_retired_binding_proto_is_not_generated_or_served() -> None:
    service_root = Path(__file__).parent.parent
    generate_protos = service_root / "scripts" / "generate_protos.py"
    binding_proto = (
        service_root.parents[1]
        / "packages"
        / "contracts"
        / "proto"
        / "alter"
        / "binding"
        / "v1"
        / "binding.proto"
    )

    assert "alter/binding/v1/binding.proto" not in generate_protos.read_text()
    assert "option deprecated = true;" in binding_proto.read_text()
    assert not (service_root / "alter" / "binding").exists()
