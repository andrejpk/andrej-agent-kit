"""Cross-platform checks, renders, joins, and visual review for explainer projects."""

from __future__ import annotations

import argparse
import ast
import importlib.util
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True

from azure_narration import Narration, probe_seconds, speech_credentials, work_directory

QUALITIES = {"low": ("-ql", "480p15"), "medium": ("-qm", "720p30"), "high": ("-qh", "1080p60")}


def scene_order(project: Path) -> list[str]:
    tree = ast.parse((project / "scenes.py").read_text(encoding="utf-8"))
    assignments = [
        node.value for node in tree.body
        if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "ORDER" for target in node.targets)
    ]
    if len(assignments) != 1:
        raise ValueError("scenes.py must declare exactly one literal ORDER list")
    order = ast.literal_eval(assignments[0])
    if not isinstance(order, list) or not order:
        raise ValueError("ORDER must be a nonempty list of scene class names")
    if any(not isinstance(name, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", name) for name in order):
        raise ValueError("ORDER must contain valid scene class names")
    if len(set(order)) != len(order):
        raise ValueError("ORDER must not contain duplicate scenes")
    classes = {node.name for node in tree.body if isinstance(node, ast.ClassDef)}
    if not set(order).issubset(classes):
        raise ValueError("Every scene in ORDER must be defined in scenes.py")
    return order


def check(project: Path) -> int:
    print(f"Generated files: {work_directory(project)}")
    missing = []
    for executable in ("uv", "ffmpeg", "ffprobe"):
        installed = shutil.which(executable) is not None
        print(f"{'OK' if installed else 'MISSING'}: {executable}")
        if not installed:
            missing.append(executable)
    installed = importlib.util.find_spec("manim") is not None
    print(f"{'OK' if installed else 'MISSING'}: Manim in this Python environment")
    if not installed:
        missing.append("Manim")
    supported_python = (3, 11) <= sys.version_info[:2] < (3, 14)
    print(f"{'OK' if supported_python else 'MISSING'}: supported Python (3.11-3.13)")
    if not supported_python:
        missing.append("supported Python")
    for filename in ("script.py", "scenes.py"):
        if not (project / filename).is_file():
            print(f"MISSING: {filename}")
            missing.append(filename)
    try:
        speech_credentials(project)
        print("OK: Azure Speech key and region configured (values not displayed; connection not tested)")
    except ValueError as exc:
        print(f"OPTIONAL for silent preview: {exc}")
    print("Optional: LaTeX for MathTex; Inter font for matching the default style.")
    if missing:
        print("See README setup instructions. No packages were installed.")
    return 1 if missing else 0


def has_audio(path: Path) -> bool:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
         "stream=codec_type", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    return "audio" in result.stdout.splitlines()


def require_media_tools() -> None:
    for name in ("ffmpeg", "ffprobe"):
        if shutil.which(name) is None:
            raise ValueError(f"{name} is required on PATH; see README setup instructions")


def build(project: Path, quality: str, silent: bool, force: bool) -> Path:
    project = project.resolve()
    workspace = work_directory(project)
    require_media_tools()
    if importlib.util.find_spec("manim") is None:
        raise ValueError("Manim is missing; run uv sync first")
    order = scene_order(project)
    narration = Narration(project, silent=silent)
    if silent:
        print("SILENT PREVIEW: estimated timings, no cloud calls, no cached audio")
    else:
        narration.generate(force=force)
    flag, resolution = QUALITIES[quality]
    print(f"Generated files: {workspace}")
    out_dir = workspace / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / f"build-{resolution}.json"
    # A failed rebuild must not leave old timings pointing at partially replaced scenes.
    manifest_path.unlink(missing_ok=True)
    media = workspace / "media"
    temp_dir = workspace / "tmp"
    temp_dir.mkdir(exist_ok=True)
    env = dict(
        os.environ, EXPLAINER_SILENT="1" if silent else "0",
        PYTHONDONTWRITEBYTECODE="1", TMP=str(temp_dir), TEMP=str(temp_dir), TMPDIR=str(temp_dir),
    )
    clips = []
    timings = {}
    for scene in order:
        log = workspace / f"media-{scene}.log"
        timing_path = media / "narration" / f"{scene}.json"
        timing_path.unlink(missing_ok=True)
        print(f"Rendering {scene} ({resolution})", flush=True)
        with log.open("w", encoding="utf-8") as stream:
            result = subprocess.run(
                [sys.executable, "-B", "-m", "manim", flag, "--disable_caching",
                 "--progress_bar", "none", "--media_dir", str(media), str(project / "scenes.py"), scene],
                cwd=workspace, env=env, stdout=stream, stderr=subprocess.STDOUT,
            )
        if result.returncode:
            raise RuntimeError(f"Rendering {scene} failed; see {log}")
        clip = media / "videos" / "scenes" / resolution / f"{scene}.mp4"
        if not clip.is_file() or not timing_path.is_file():
            raise RuntimeError(f"{scene} did not produce a video and Narrated timing record; see {log}")
        if has_audio(clip) == silent:
            raise RuntimeError(f"{scene} has an unexpected audio stream state; see {log}")
        timings[scene] = json.loads(timing_path.read_text(encoding="utf-8"))
        clips.append(clip)
    suffix = "-silent" if silent else ""
    output = out_dir / f"{project.name}-{resolution}{suffix}.mp4"
    temporary = output.with_suffix(".part.mp4")
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", dir=clips[0].parent, delete=False, encoding="utf-8") as stream:
        concat = Path(stream.name)
        for clip in clips:
            stream.write(f"file '{clip.name}'\n")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
             "-i", str(concat), "-c", "copy", "-movflags", "+faststart", str(temporary)],
            check=True,
        )
        duration = probe_seconds(temporary)
        if has_audio(temporary) == silent:
            raise RuntimeError("Joined video has an unexpected audio stream state")
        temporary.replace(output)
    finally:
        concat.unlink(missing_ok=True)
        temporary.unlink(missing_ok=True)
    manifest = {
        "output": output.name, "resolution": resolution, "silent": silent,
        "duration": duration, "order": order, "timings": timings,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"{output}\n{duration:.1f} seconds, {resolution}, {'silent preview' if silent else 'narrated'}")
    return output


def review(project: Path, quality: str, step: float) -> None:
    workspace = work_directory(project)
    require_media_tools()
    if not math.isfinite(step) or step <= 0:
        raise ValueError("--step must be a positive finite number of seconds")
    resolution = QUALITIES[quality][1]
    manifest_path = workspace / "out" / f"build-{resolution}.json"
    if not manifest_path.is_file():
        raise ValueError(f"Build at {quality} quality before reviewing")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    destination = workspace / "review"
    destination.mkdir(exist_ok=True)
    print("Reviewing the last completed build, using its recorded narration timings.")
    for scene in manifest["order"]:
        clip = workspace / "media" / "videos" / "scenes" / resolution / f"{scene}.mp4"
        duration = probe_seconds(clip)
        events = manifest["timings"][scene]
        narration = sum(event["seconds"] for event in events)
        rows = max(1, math.ceil(duration / step / 4))
        sheet = destination / f"{scene}.png"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(clip), "-vf",
             f"fps=1/{step},scale=427:240,tile=4x{rows}", "-frames:v", "1", "-update", "1", str(sheet)],
            check=True,
        )
        flag = " CHECK: excess slack" if duration - narration > 6 else ""
        estimate = " (estimated)" if manifest["silent"] else ""
        print(f"{scene}: video {duration:.1f}s, narration {narration:.1f}s{estimate}, slack {duration - narration:.1f}s{flag}")
        print(f"  {sheet}")
    joined = workspace / "out" / manifest["output"]
    if manifest["silent"]:
        print("Silent preview: speech and silence detection were not reviewed.")
        return
    if not has_audio(joined):
        raise RuntimeError("The final narrated video has no audio stream")
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(joined), "-af", "silencedetect=n=-45dB:d=2.5", "-f", "null", "-"],
        capture_output=True, text=True, check=True,
    )
    silences = [line for line in result.stderr.splitlines() if re.search(r"silence_(start|end)", line)]
    print("Silences longer than 2.5 seconds:\n" + ("\n".join(silences) if silences else "  none detected"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("check").add_argument("project", type=Path)
    builder = commands.add_parser("build")
    builder.add_argument("project", type=Path)
    builder.add_argument("--quality", choices=QUALITIES, default="high")
    builder.add_argument("--silent", action="store_true")
    builder.add_argument("--force", action="store_true")
    reviewer = commands.add_parser("review")
    reviewer.add_argument("project", type=Path)
    reviewer.add_argument("--quality", choices=QUALITIES, default="low")
    reviewer.add_argument("--step", type=float, default=3)
    args = parser.parse_args()
    project = args.project.resolve()
    try:
        if not project.is_dir():
            raise ValueError(f"Project directory does not exist: {project}")
        if args.command == "check":
            return check(project)
        if args.command == "build":
            if args.silent and args.force:
                raise ValueError("--force regenerates speech and cannot be used with --silent")
            build(project, args.quality, args.silent, args.force)
        else:
            review(project, args.quality, args.step)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
