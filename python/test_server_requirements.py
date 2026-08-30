"""Static guards for the Docker image's dependency manifest.

The image installs requirements-server.txt; if a cloud engine the server can
run (``LTS_ENGINE=deepgram``) is missing from that manifest, the image boots
(/health OK, the SDK is imported lazily) but dies with ModuleNotFoundError on
the first WebSocket client. These tests pin the manifest to the engines the
server actually runs — the exact regression that shipped the deepgram mode
without deepgram-sdk in the image.
"""

from pathlib import Path

REQUIREMENTS = Path(__file__).parent / "requirements-server.txt"


def _declared() -> list[str]:
    lines = REQUIREMENTS.read_text(encoding="utf-8").splitlines()
    return [ln for ln in lines if ln and not ln.lstrip().startswith("#") and "://" not in ln]


def test_deepgram_sdk_declared_for_cloud_engine() -> None:
    deps = "\n".join(_declared())
    assert "deepgram-sdk" in deps, (
        "LTS_ENGINE=deepgram streams audio to Deepgram Nova-3; the Docker image "
        "(requirements-server.txt) must install deepgram-sdk or the first "
        "client connection raises ModuleNotFoundError."
    )


def test_core_runtime_deps_present() -> None:
    deps = "\n".join(_declared())
    for name in ("faster-whisper", "websockets", "numpy", "requests"):
        assert name in deps, f"requirements-server.txt is missing core runtime dep: {name}"
