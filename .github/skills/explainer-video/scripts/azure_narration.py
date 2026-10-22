"""Azure AI Speech synthesis and narration cache, independent of Manim."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import runpy
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
        self.voice = script.get("VOICE_NAME", "en-US-JennyNeural")
        self.language = script.get("LANGUAGE", "en-US")
        self.rate = script.get("SPEECH_RATE", "0%")
        if not isinstance(self.voice, str) or not re.fullmatch(r"[A-Za-z0-9-]+", self.voice):
            raise ValueError("VOICE_NAME must be an Azure voice short name")
        if not isinstance(self.language, str) or not re.fullmatch(r"[a-z]{2,3}-[A-Z]{2}", self.language):
            raise ValueError("LANGUAGE must be a locale such as en-US")
        if not isinstance(self.rate, str) or not re.fullmatch(r"[+-]?\d+%", self.rate):
            raise ValueError("SPEECH_RATE must be a percentage string")
        if not -50 <= int(self.rate[:-1]) <= 100:
            raise ValueError("SPEECH_RATE must be between -50% and 100%")
        self.region = "" if self.silent else speech_region(self.project)

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
        api_key, region = speech_credentials(self.project)
        self.audio.mkdir(parents=True, exist_ok=True)
        for key in missing:
            print(f"Synthesizing {key}", flush=True)
            content = synthesize(api_key, region, ssml(self.segments[key], self.voice, self.language, self.rate))
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
