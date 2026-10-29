"""Azure AI Speech synthesis and narration cache, independent of Manim."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import math
import os
import re
import runpy
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from xml.etree import ElementTree as ET

WORDS_PER_SECOND = 2.5
OUTPUT_FORMAT = "audio-24khz-96kbitrate-mono-mp3"
SSML_NS = "http://www.w3.org/2001/10/synthesis"
XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"
TOKEN_SCOPE = "https://cognitiveservices.azure.com/.default"


def work_directory(project: Path) -> Path:
    """Stable, project-specific artifact storage outside source and Git trees."""
    project = Path(project).resolve()
    override = os.environ.get("EXPLAINER_WORK_ROOT")
    if override:
        root = Path(override).expanduser()
        if not root.is_absolute():
            raise ValueError("EXPLAINER_WORK_ROOT must be an absolute path outside repositories")
    else:
        if sys.platform == "win32":
            base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
        elif sys.platform == "darwin":
            base = Path.home() / "Library" / "Application Support"
        else:
            base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
        if not base.is_absolute():
            raise ValueError("The user data directory must be an absolute path")
        root = base / "andrejky-agent-kit" / "explainer-video"
    identity = hashlib.sha256(os.path.normcase(str(project)).encode("utf-8")).hexdigest()[:16]
    name = re.sub(r"[^A-Za-z0-9_-]", "-", project.name)[:60] or "video"
    workspace = (root / f"{name}-{identity}").resolve()
    if workspace.is_relative_to(project):
        raise ValueError("Generated files must be outside the source project; choose another EXPLAINER_WORK_ROOT")
    for parent in (workspace, *workspace.parents):
        if (parent / ".git").exists():
            raise ValueError("Generated files must be outside Git repositories; choose another EXPLAINER_WORK_ROOT")
    return workspace


def load_script(project: Path) -> dict:
    path = project / "script.py"
    if not path.is_file():
        raise ValueError(f"Missing narration script: {path}")
    # Read source on each run so rapid same-size edits cannot reuse stale bytecode.
    return runpy.run_path(str(path))


def dotenv(path: Path) -> dict[str, str]:
    """Read simple KEY=value entries; no interpolation or shell execution."""
    if not path.is_file():
        return {}
    values = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.removeprefix("export ").partition("=")
        if not sep:
            raise ValueError(f"Expected KEY=value in {path}")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def setting(project: Path, name: str) -> str:
    if name in os.environ:
        return os.environ[name].strip()
    return dotenv(project / ".env").get(name, "").strip()


def speech_region(project: Path) -> str:
    region = setting(project, "AZURE_SPEECH_REGION")
    if region and not re.fullmatch(r"[a-z][a-z0-9]{1,39}", region):
        raise ValueError("AZURE_SPEECH_REGION must be a public Azure region name, such as eastus")
    return region


def speech_credentials(project: Path) -> tuple[str, str]:
    key = setting(project, "AZURE_SPEECH_KEY")
    region = speech_region(project)
    if not key or not region:
        raise ValueError("Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION, or request an explicit --silent preview")
    return key, region


def speech_auth(project: Path) -> tuple[str, str]:
    endpoint = setting(project, "AZURE_SPEECH_ENDPOINT")
    mode = setting(project, "AZURE_SPEECH_AUTH") or ("cli" if endpoint else "key")
    if mode not in ("cli", "key"):
        raise ValueError("AZURE_SPEECH_AUTH must be cli or key")
    if mode == "key":
        return mode, ""
    if not re.fullmatch(
        r"https://[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.cognitiveservices\.azure\.com/?",
        endpoint, re.IGNORECASE,
    ):
        raise ValueError(
            "CLI authentication requires AZURE_SPEECH_ENDPOINT=https://<custom-name>.cognitiveservices.azure.com/ "
            "(public Azure HTTPS resource root, not a regional endpoint)"
        )
    return mode, endpoint.lower().rstrip("/") + "/"


def check_cli_dependencies() -> None:
    if shutil.which("az") is None:
        raise ValueError("Azure CLI is missing from PATH; install it and run az login in the resource's tenant")
    for package in ("azure-identity", "azure-cognitiveservices-speech"):
        try:
            version = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            raise ValueError(f"{package} is missing; restore the skill package dependencies with uv sync") from None
        minimum = (1, 52) if package == "azure-cognitiveservices-speech" else (1, 25)
        parts = tuple(int(part) for part in version.split(".")[:2])
        if parts < minimum or parts >= (2, 0):
            raise ValueError(f"{package} requires >={minimum[0]}.{minimum[1]},<2; run uv sync")


def synthesize_cli(endpoint: str, body: bytes) -> bytes:
    """Use only the CLI credential, never a fallback credential chain or a key."""
    from azure.core.exceptions import ClientAuthenticationError
    from azure.identity import AzureCliCredential, CredentialUnavailableError
    import azure.cognitiveservices.speech as speechsdk

    with AzureCliCredential(process_timeout=30) as credential:
        try:
            # Fail with actionable guidance before entering the native SDK callback.
            credential.get_token(TOKEN_SCOPE)
        except (ClientAuthenticationError, CredentialUnavailableError):
            raise RuntimeError(
                "Azure CLI authentication failed. Run az login --tenant <tenant-id> and "
                "az account set --subscription <subscription-id> in this user's environment. "
                "No API-key fallback was attempted."
            ) from None
        try:
            config = speechsdk.SpeechConfig(endpoint=endpoint, token_credential=credential)
            config.set_speech_synthesis_output_format(
                speechsdk.SpeechSynthesisOutputFormat.Audio24Khz96KBitRateMonoMp3,
            )
            synthesizer = speechsdk.SpeechSynthesizer(speech_config=config, audio_config=None)
            result = synthesizer.speak_ssml_async(body.decode("utf-8")).get()
        except RuntimeError:
            raise RuntimeError(
                "Azure Speech SDK failed. Check CLI login, custom endpoint, network access, "
                "and Cognitive Services Speech User permissions. No API-key fallback was attempted."
            ) from None
        if result.reason != speechsdk.ResultReason.SynthesizingAudioCompleted:
            if result.reason == speechsdk.ResultReason.Canceled:
                # Native error_details can contain request data; do not log them.
                code = result.cancellation_details.error_code.name
                raise RuntimeError(
                    f"Azure Speech synthesis canceled ({code}). Check CLI login, Speech User permissions, "
                    "endpoint/network access, voice, and quota. No API-key fallback was attempted."
                )
            raise RuntimeError("Azure Speech SDK did not complete synthesis; no audio was cached")
        audio = bytes(result.audio_data)
        if not audio:
            raise RuntimeError("Azure Speech returned empty audio")
        return audio


def ssml(text: str, voice: str, language: str, rate: str) -> bytes:
    root = ET.Element("speak", {"xmlns": SSML_NS, "version": "1.0", XML_LANG: language})
    node = ET.SubElement(root, "voice", {"name": voice})
    ET.SubElement(node, "prosody", {"rate": rate}).text = text
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("Azure Speech returned a redirect; refusing to forward the credential")


def synthesize(key: str, region: str, body: bytes) -> bytes:
    url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
            "User-Agent": "andrejky-agent-kit",
        },
        method="POST",
    )
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=120) as response:
            audio = response.read()
    except urllib.error.HTTPError as exc:
        # Response bodies may echo user text. Keep them out of logs.
        status = exc.code
        exc.close()
        raise RuntimeError(
            f"Azure Speech failed (HTTP {status}). Check the resource key, region, voice, and quota."
        ) from None
    except (urllib.error.URLError, TimeoutError):
        raise RuntimeError("Azure Speech connection failed or timed out; no silent fallback was used") from None
    if not audio:
        raise RuntimeError("Azure Speech returned empty audio")
    return audio


def probe_seconds(path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    seconds = float(result.stdout.strip())
    if not math.isfinite(seconds) or seconds <= 0:
        raise ValueError(f"Invalid media duration for {path}")
    return seconds


class Narration:
    def __init__(self, project: Path, *, silent: bool | None = None):
        self.project = Path(project).resolve()
        self.audio = work_directory(self.project) / "audio"
        self.silent = os.environ.get("EXPLAINER_SILENT") == "1" if silent is None else silent
        script = load_script(self.project)
        self.segments = script.get("SEGMENTS")
        if not isinstance(self.segments, dict) or not self.segments:
            raise ValueError("SEGMENTS must be a nonempty dictionary")
        for key, text in self.segments.items():
            if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*", key):
                raise ValueError("Segment names must start with a letter and contain only letters, digits, _ or -")
            if not isinstance(text, str) or not text.strip():
                raise ValueError(f"Segment {key} must contain nonempty narration text")
        self.voice = script.get("VOICE_NAME", "en-US-Andrew:DragonHDLatestNeural")
        self.language = script.get("LANGUAGE", "en-US")
        self.rate = script.get("SPEECH_RATE", "0%")
        if not isinstance(self.voice, str) or not         re.fullmatch(r"[A-Za-z0-9-]+(:[A-Za-z0-9]+)?", self.voice):
                    raise ValueError(
                        "VOICE_NAME must be an Azure voice short name, optionally with one ':Variant' suffix "
                        "(for example en-US-Andrew:DragonHDLatestNeural)"
                    )
        if not isinstance(self.language, str) or not re.fullmatch(r"[a-z]{2,3}-[A-Z]{2}", self.language):
            raise ValueError("LANGUAGE must be a locale such as en-US")
        if not isinstance(self.rate, str) or not re.fullmatch(r"[+-]?\d+%", self.rate):
            raise ValueError("SPEECH_RATE must be a percentage string")
        if not -50 <= int(self.rate[:-1]) <= 100:
            raise ValueError("SPEECH_RATE must be between -50% and 100%")
        self.auth_mode, self.endpoint = ("key", "") if self.silent else speech_auth(self.project)
        self.region = "" if self.silent or self.auth_mode == "cli" else speech_region(self.project)

    @classmethod
    def beside(cls, file: str) -> Narration:
        return cls(Path(file).parent)

    def clip(self, key: str) -> Path:
        if key not in self.segments:
            raise ValueError(f"Unknown narration segment: {key}")
        return self.audio / f"{key}.mp3"

    def digest(self, key: str) -> str:
        payload = {
            "provider": "azure-speech-rest-v1", "text": self.segments[key],
            "voice": self.voice, "language": self.language, "rate": self.rate,
            "region": self.region, "format": OUTPUT_FORMAT,
        }
        if self.auth_mode == "cli":
            payload.update(provider="azure-speech-sdk-cli-v1", endpoint=self.endpoint)
        return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()

    def metadata(self, key: str) -> dict | None:
        path = self.clip(key).with_suffix(".json")
        if not path.exists():
            return None
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            raise ValueError(f"Invalid audio cache metadata: {path}; regenerate with --force") from None
        if not isinstance(value, dict):
            raise ValueError(f"Invalid audio cache metadata: {path}; regenerate with --force")
        return value

    def has_audio(self, key: str) -> bool:
        if self.silent:
            return False
        meta = self.metadata(key)
        path = self.clip(key)
        if not path.is_file() or meta is None or meta.get("digest") != self.digest(key):
            return False
        seconds = meta.get("seconds")
        if not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or seconds <= 0:
            raise ValueError(f"Invalid cached duration for {key}; regenerate with --force")
        return meta.get("audio_sha256") == hashlib.sha256(path.read_bytes()).hexdigest()

    def duration(self, key: str) -> float:
        if self.has_audio(key):
            return self.metadata(key)["seconds"]
        if not self.silent:
            raise ValueError(f"Missing or stale narration for {key}; generate audio or use --silent")
        return len(self.segments[key].split()) / WORDS_PER_SECOND + 0.4

    def generate(self, *, force: bool = False) -> None:
        if self.silent:
            raise ValueError("Cannot generate audio in silent mode")
        missing = [key for key in self.segments if force or not self.has_audio(key)]
        if not missing:
            print(f"Using {len(self.segments)} cached Azure narration clips")
            return
        if self.auth_mode == "cli":
            check_cli_dependencies()
        else:
            api_key, region = speech_credentials(self.project)
        self.audio.mkdir(parents=True, exist_ok=True)
        for key in missing:
            print(f"Synthesizing {key}", flush=True)
            body = ssml(self.segments[key], self.voice, self.language, self.rate)
            if self.auth_mode == "cli":
                content = synthesize_cli(self.endpoint, body)
            else:
                content = synthesize(api_key, region, body)
            clip = self.clip(key)
            temp_audio = clip.with_suffix(".mp3.part")
            temp_meta = clip.with_suffix(".json.part")
            try:
                temp_audio.write_bytes(content)
                seconds = probe_seconds(temp_audio)
                temp_meta.write_text(json.dumps({
                    "digest": self.digest(key), "seconds": seconds,
                    "audio_sha256": hashlib.sha256(content).hexdigest(),
                }), encoding="utf-8")
                temp_audio.replace(clip)
                temp_meta.replace(clip.with_suffix(".json"))
            finally:
                temp_audio.unlink(missing_ok=True)
                temp_meta.unlink(missing_ok=True)
        print(f"{len(self.segments)} clips, {sum(self.duration(k) for k in self.segments):.1f} seconds")
