import json
from pathlib import Path

LOAD_ROOT = Path(__file__).parents[3] / "tests" / "load" / "k6"


def test_slo_floors_match_the_phase_nine_test_plan() -> None:
    floors = json.loads((LOAD_ROOT / "slo-floors.json").read_text())

    assert floors["api_read_control"] == {
        "p95_ms": 300,
        "p99_ms": 1000,
        "availability": 0.999,
    }
    assert floors["run_start"] == {"p95_ms": 2000}
    assert floors["sse_reconnect"] == {"p95_connect_ms": 1000, "acceptance": 0.99}
    assert floors["event_ingestion"] == {
        "sustained_events_per_second": 100,
        "burst_events_per_second": 500,
        "burst_duration": "5m",
    }


def test_k6_scripts_load_real_endpoints_and_assert_slo_floors() -> None:
    scripts = {
        "api-mix.js": ("API_READ_PATH", "API_CONTROL_PATH", "p(95)<", "p(99)<"),
        "run-start.js": ("RUN_START_PATH", "RUN_START_BODY", "p(95)<"),
        "event-ingestion.js": (
            "EVENT_INGEST_PATH",
            "EVENT_INGEST_BODY",
            "constant-arrival-rate",
        ),
        "sse-reconnect.js": (
            "RUN_STREAM_PATH",
            "STREAM_HEALTH_PATH",
            "k6/x/sse",
            "sse_connections_accepted",
            "sse_gateway_healthy",
            "p(95)<",
        ),
    }
    for name, required_tokens in scripts.items():
        source = (LOAD_ROOT / name).read_text()
        assert "requiredEnv" in source
        if name != "sse-reconnect.js":
            assert "availability" in source
            assert "unexpected_responses" in source
        assert "handleSummary" in source
        for token in required_tokens:
            assert token in source
