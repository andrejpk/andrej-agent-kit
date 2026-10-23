"""Offline contract tests: no credentials, Azure calls, or Manim installation."""

from __future__ import annotations

import ast
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import MagicMock, patch
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / ".github" / "skills" / "explainer-video"
sys.path.insert(0, str(SKILL / "scripts"))

import azure_narration as azure
import video


class NarrationFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        self.write_script()
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.workspace = tempfile.TemporaryDirectory()
        self.addCleanup(self.workspace.cleanup)
        os.environ["EXPLAINER_WORK_ROOT"] = self.workspace.name

    def write_script(self, extra="", segments=None):
        values = segments if segments is not None else {"intro": "A transfer can be retried.", "retry": "Return the saved result."}
        (self.project / "script.py").write_text(f"SEGMENTS = {values!r}\n{extra}", encoding="utf-8")

    def credentials(self):
        os.environ.update(AZURE_SPEECH_KEY="test-key-not-a-secret", AZURE_SPEECH_REGION="eastus")

    def seed(self, narration, key="intro", seconds=2.0):
        narration.audio.mkdir(parents=True, exist_ok=True)
        narration.clip(key).write_bytes(b"mock-audio")
        narration.clip(key).with_suffix(".json").write_text(json.dumps({
            "digest": narration.digest(key), "seconds": seconds,
            "audio_sha256": hashlib.sha256(b"mock-audio").hexdigest(),
        }), encoding="utf-8")


class NarrationTests(NarrationFixture):
    def test_environment_precedes_dotenv(self):
        (self.project / ".env").write_text(
            "AZURE_SPEECH_KEY='file-key'\nAZURE_SPEECH_REGION=westus\n", encoding="utf-8",
        )
        os.environ["AZURE_SPEECH_KEY"] = "environment-key"
        self.assertEqual(azure.speech_credentials(self.project), ("environment-key", "westus"))

    def test_missing_credentials_fail(self):
        with self.assertRaisesRegex(ValueError, "AZURE_SPEECH_KEY"):
            azure.Narration(self.project).generate()

    def test_same_size_script_edit_is_read_even_with_unchanged_timestamp(self):
        self.write_script(segments={"intro": "First text."})
        script = self.project / "script.py"
        before = script.stat()
        first = azure.Narration(self.project).digest("intro")
        self.write_script(segments={"intro": "Other text."})
        os.utime(script, ns=(before.st_atime_ns, before.st_mtime_ns))
        second = azure.Narration(self.project)
        self.assertEqual(second.segments["intro"], "Other text.")
        self.assertNotEqual(first, second.digest("intro"))

    def test_region_cannot_inject_host(self):
        os.environ["AZURE_SPEECH_REGION"] = "eastus.example.com/path"
        with self.assertRaisesRegex(ValueError, "public Azure region"):
            azure.speech_region(self.project)

    def test_ssml_escapes_text(self):
        text = 'Transfer <one hundred> & "retry".'
        root = ET.fromstring(azure.ssml(text, "en-US-JennyNeural", "en-US", "0%"))
        prosody = root.find(f".//{{{azure.SSML_NS}}}prosody")
        self.assertEqual(prosody.text, text)
        self.assertEqual(root.attrib[azure.XML_LANG], "en-US")
        self.assertEqual(len(list(prosody)), 0)

    def test_azure_request_contract(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b"audio"
        with patch.object(azure.urllib.request, "build_opener") as opener:
            opener.return_value.open.return_value = response
            result = azure.synthesize("test-key", "eastus", b"<speak/>")
        request = opener.return_value.open.call_args.args[0]
        headers = {key.lower(): value for key, value in request.header_items()}
        self.assertEqual(request.full_url, "https://eastus.tts.speech.microsoft.com/cognitiveservices/v1")
        self.assertEqual(headers["ocp-apim-subscription-key"], "test-key")
        self.assertEqual(headers["x-microsoft-outputformat"], azure.OUTPUT_FORMAT)
        self.assertEqual(headers["content-type"], "application/ssml+xml")
        self.assertEqual(request.data, b"<speak/>")
        self.assertEqual(result, b"audio")
        self.assertIsInstance(opener.call_args.args[0], azure.NoRedirect)

    def test_redirect_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "refusing to forward"):
            azure.NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.com")

    def test_http_error_does_not_expose_response_body(self):
        error = urllib.error.HTTPError("https://example.com", 401, "unauthorized", {}, None)
        with patch.object(azure.urllib.request, "build_opener") as opener:
            opener.return_value.open.side_effect = error
            with self.assertRaisesRegex(RuntimeError, "HTTP 401"):
                azure.synthesize("test-key", "eastus", b"not logged")

    def test_network_error_fails_explicitly(self):
        with patch.object(azure.urllib.request, "build_opener") as opener:
            opener.return_value.open.side_effect = urllib.error.URLError("offline")
            with self.assertRaisesRegex(RuntimeError, "no silent fallback"):
                azure.synthesize("test-key", "eastus", b"text")

    def test_empty_response_fails(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b""
        with patch.object(azure.urllib.request, "build_opener") as opener:
            opener.return_value.open.return_value = response
            with self.assertRaisesRegex(RuntimeError, "empty audio"):
                azure.synthesize("test-key", "eastus", b"text")

    def test_cache_reuses_unchanged_and_regenerates_only_changed_segment(self):
        self.credentials()
        narration = azure.Narration(self.project)
        with patch.object(azure, "synthesize", return_value=b"audio") as synthesize, patch.object(
            azure, "probe_seconds", return_value=2.0,
        ):
            narration.generate()
            self.assertEqual(synthesize.call_count, 2)
            narration.generate()
            self.assertEqual(synthesize.call_count, 2)
            narration.segments["retry"] += " No second debit."
            narration.generate()
            self.assertEqual(synthesize.call_count, 3)
            narration.generate(force=True)
            self.assertEqual(synthesize.call_count, 5)
        self.assertFalse(list(narration.audio.glob("*.part")))

    def test_silent_ignores_cached_audio_and_needs_no_credentials(self):
        narration = azure.Narration(self.project)
        self.seed(narration)
        silent = azure.Narration(self.project, silent=True)
        self.assertFalse(silent.has_audio("intro"))
        self.assertAlmostEqual(silent.duration("intro"), 2.4)
        with self.assertRaisesRegex(ValueError, "silent mode"):
            silent.generate()

    def test_missing_audio_does_not_silently_estimate(self):
        with self.assertRaisesRegex(ValueError, "Missing or stale"):
            azure.Narration(self.project).duration("intro")

    def test_corrupt_audio_is_not_cached(self):
        narration = azure.Narration(self.project)
        self.seed(narration)
        self.assertTrue(narration.has_audio("intro"))
        narration.clip("intro").write_bytes(b"corrupt")
        self.assertFalse(narration.has_audio("intro"))

    def test_voice_rate_language_and_region_invalidate_cache(self):
        narration = azure.Narration(self.project)
        for attribute, changed in (
            ("voice", "en-US-GuyNeural"), ("language", "en-GB"),
            ("rate", "-10%"), ("region", "westus"),
        ):
            with self.subTest(attribute=attribute):
                self.seed(narration)
                original = getattr(narration, attribute)
                setattr(narration, attribute, changed)
                self.assertFalse(narration.has_audio("intro"))
                setattr(narration, attribute, original)

    def test_invalid_segment_name_and_empty_text_are_rejected(self):
        for segments in ({}, {"../outside": "text"}, {"intro": "  "}, {"intro": 123}):
            with self.subTest(segments=segments):
                self.write_script(segments=segments)
                with self.assertRaises(ValueError):
                    azure.Narration(self.project)

    def test_invalid_voice_settings_are_rejected(self):
        for extra in ("SPEECH_RATE = 'fast'", "SPEECH_RATE = '101%'", "LANGUAGE = 'invalid'", "VOICE_NAME = ''"):
            with self.subTest(extra=extra):
                self.write_script(extra=extra)
                with self.assertRaises(ValueError):
                    azure.Narration(self.project)

    def test_failed_audio_probe_preserves_old_clip_and_cleans_temporary_files(self):
        self.credentials()
        narration = azure.Narration(self.project)
        self.seed(narration)
        with patch.object(azure, "synthesize", return_value=b"bad audio"), patch.object(
            azure, "probe_seconds", side_effect=ValueError("invalid duration"),
        ):
            with self.assertRaisesRegex(ValueError, "invalid duration"):
                narration.generate(force=True)
        self.assertEqual(narration.clip("intro").read_bytes(), b"mock-audio")
        self.assertFalse(list(narration.audio.glob("*.part")))

    def test_probe_rejects_invalid_duration(self):
        for value in ("0", "-1", "nan", "inf"):
            with self.subTest(value=value), patch.object(azure.subprocess, "run") as run:
                run.return_value.stdout = value
                with self.assertRaisesRegex(ValueError, "Invalid media duration"):
                    azure.probe_seconds(Path("clip.mp3"))


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory()
        self.addCleanup(self.workspace.cleanup)
        environment = patch.dict(os.environ, {"EXPLAINER_WORK_ROOT": self.workspace.name})
        environment.start()
        self.addCleanup(environment.stop)

    def test_example_references_all_segments_once_in_scene_order(self):
        project = SKILL / "examples" / "banking-transfer"
        narration = azure.Narration(project, silent=True)
        order = video.scene_order(project)
        tree = ast.parse((project / "scenes.py").read_text(encoding="utf-8"))
        classes = {node.name: node for node in tree.body if isinstance(node, ast.ClassDef)}
        keys = []
        for name in order:
            for node in ast.walk(classes[name]):
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "say":
                    keys.append(ast.literal_eval(node.args[0]))
        self.assertEqual(keys, list(narration.segments))

    def test_all_python_sources_compile(self):
        for path in [*SKILL.rglob("*.py"), *ROOT.joinpath("tests").glob("*.py")]:
            with self.subTest(path=path):
                compile(path.read_text(encoding="utf-8"), str(path), "exec")

    def test_invalid_scene_order_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            project = Path(folder)
            for source in ("ORDER = []", "ORDER = ['Missing']", "ORDER = ['X', 'X']\nclass X: pass"):
                with self.subTest(source=source):
                    (project / "scenes.py").write_text(source, encoding="utf-8")
                    with self.assertRaises(ValueError):
                        video.scene_order(project)

    def test_failed_speech_never_starts_renderer(self):
        with tempfile.TemporaryDirectory() as folder:
            project = Path(folder)
            with patch.object(video, "require_media_tools"), patch.object(
                video.importlib.util, "find_spec", return_value=object(),
            ), patch.object(video, "scene_order", return_value=["Scene1"]), patch.object(
                video, "Narration",
            ) as narration, patch.object(video.subprocess, "run") as run:
                narration.return_value.generate.side_effect = RuntimeError("Azure unavailable")
                with self.assertRaisesRegex(RuntimeError, "Azure unavailable"):
                    video.build(project, "low", False, False)
                run.assert_not_called()

    def test_silent_build_does_not_generate_and_passes_flag_to_renderer(self):
        with tempfile.TemporaryDirectory() as folder:
            project = Path(folder)
            with patch.object(video, "require_media_tools"), patch.object(
                video.importlib.util, "find_spec", return_value=object(),
            ), patch.object(video, "scene_order", return_value=["Scene1"]), patch.object(
                video, "Narration",
            ) as narration, patch.object(video.subprocess, "run") as run:
                run.return_value.returncode = 1
                with self.assertRaisesRegex(RuntimeError, "Rendering Scene1 failed"):
                    video.build(project, "low", True, False)
                narration.return_value.generate.assert_not_called()
                self.assertEqual(run.call_args.kwargs["env"]["EXPLAINER_SILENT"], "1")
                self.assertEqual(run.call_args.kwargs["env"]["PYTHONDONTWRITEBYTECODE"], "1")
                self.assertEqual(run.call_args.kwargs["cwd"], azure.work_directory(project))
                self.assertIn(str(project / "scenes.py"), run.call_args.args[0])

    def test_cli_rejects_force_silent_combination(self):
        project = SKILL / "examples" / "banking-transfer"
        result = subprocess.run(
            [sys.executable, str(SKILL / "scripts" / "video.py"), "build", str(project), "--silent", "--force"],
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("cannot be used with --silent", result.stderr)

    def test_completed_build_joins_order_and_persists_review_manifest(self):
        for silent in (False, True):
            with self.subTest(silent=silent), tempfile.TemporaryDirectory(prefix="video space ") as folder:
                project = Path(folder)
                workspace = azure.work_directory(project)
                media = workspace / "media"
                clip_folder = media / "videos" / "scenes" / "480p15"

                def run(command, **kwargs):
                    if "-m" in command:
                        scene = command[-1]
                        clip_folder.mkdir(parents=True, exist_ok=True)
                        (clip_folder / f"{scene}.mp4").write_bytes(b"fake-render")
                        timing = media / "narration"
                        timing.mkdir(exist_ok=True)
                        (timing / f"{scene}.json").write_text(json.dumps([
                            {"key": "intro", "start": 0, "seconds": 2, "estimated": silent},
                        ]), encoding="utf-8")
                    else:
                        concat = Path(command[command.index("-i") + 1])
                        self.assertEqual(concat.read_text(encoding="utf-8"), "file 'S1.mp4'\nfile 'S2.mp4'\n")
                        Path(command[-1]).write_bytes(b"fake-joined-output")
                    return subprocess.CompletedProcess(command, 0)

                with patch.object(video, "require_media_tools"), patch.object(
                    video.importlib.util, "find_spec", return_value=object(),
                ), patch.object(video, "scene_order", return_value=["S1", "S2"]), patch.object(
                    video, "Narration",
                ) as narration, patch.object(video.subprocess, "run", side_effect=run), patch.object(
                    video, "has_audio", return_value=not silent,
                ), patch.object(video, "probe_seconds", return_value=5.0):
                    output = video.build(project, "low", silent, False)
                self.assertTrue(output.is_file())
                self.assertEqual("-silent" in output.stem, silent)
                manifest = json.loads((workspace / "out" / "build-480p15.json").read_text(encoding="utf-8"))
                self.assertEqual(manifest["order"], ["S1", "S2"])
                self.assertEqual(manifest["silent"], silent)
                self.assertEqual(manifest["output"], output.name)
                self.assertFalse(list(clip_folder.glob("*.txt")))
                self.assertEqual(list(project.iterdir()), [])
                if silent:
                    narration.return_value.generate.assert_not_called()
                else:
                    narration.return_value.generate.assert_called_once_with(force=False)

    def test_failed_rebuild_invalidates_review_manifest(self):
        with tempfile.TemporaryDirectory() as folder:
            project = Path(folder)
            workspace = azure.work_directory(project)
            (workspace / "out").mkdir(parents=True)
            manifest = workspace / "out" / "build-480p15.json"
            manifest.write_text("{}", encoding="utf-8")
            with patch.object(video, "require_media_tools"), patch.object(
                video.importlib.util, "find_spec", return_value=object(),
            ), patch.object(video, "scene_order", return_value=["Scene1"]), patch.object(
                video, "Narration",
            ), patch.object(video.subprocess, "run") as run:
                run.return_value.returncode = 1
                with self.assertRaises(RuntimeError):
                    video.build(project, "low", True, False)
            self.assertFalse(manifest.exists())


class CliSpeechTests(NarrationFixture):
    """Keyless contract tests use fake SDK modules and never run az or Speech."""

    def setUp(self):
        super().setUp()
        self.endpoint = "https://example-speech.cognitiveservices.azure.com/"
        os.environ.update(AZURE_SPEECH_AUTH="cli", AZURE_SPEECH_ENDPOINT=self.endpoint)

    def fake_sdk(self):
        sdk = MagicMock()
        sdk.ResultReason.SynthesizingAudioCompleted = "completed"
        sdk.ResultReason.Canceled = "canceled"
        result = sdk.SpeechSynthesizer.return_value.speak_ssml_async.return_value.get.return_value
        result.reason = "completed"
        result.audio_data = b"fake-mp3"
        identity = MagicMock()
        credential = identity.AzureCliCredential.return_value.__enter__.return_value

        class AuthenticationError(Exception):
            pass

        class UnavailableError(Exception):
            pass

        identity.CredentialUnavailableError = UnavailableError
        core = MagicMock()
        core.ClientAuthenticationError = AuthenticationError
        modules = {
            "azure": MagicMock(), "azure.core": MagicMock(), "azure.core.exceptions": core,
            "azure.identity": identity, "azure.cognitiveservices": MagicMock(),
            "azure.cognitiveservices.speech": sdk,
        }
        modules["azure"].cognitiveservices.speech = sdk
        return patch.dict(sys.modules, modules), sdk, identity, credential, result, AuthenticationError

    def test_cli_uses_endpoint_and_ignores_stale_key_region(self):
        os.environ.update(AZURE_SPEECH_KEY="ignored-key", AZURE_SPEECH_REGION="invalid/region")
        narration = azure.Narration(self.project)
        self.assertEqual(narration.auth_mode, "cli")
        self.assertEqual(narration.endpoint, self.endpoint)
        self.assertEqual(narration.region, "")

    def test_endpoint_alone_selects_cli_but_explicit_key_preserves_legacy(self):
        del os.environ["AZURE_SPEECH_AUTH"]
        self.assertEqual(azure.speech_auth(self.project), ("cli", self.endpoint))
        os.environ["AZURE_SPEECH_AUTH"] = "key"
        self.assertEqual(azure.speech_auth(self.project), ("key", ""))

    def test_dotenv_config_and_environment_precedence(self):
        del os.environ["AZURE_SPEECH_AUTH"]
        del os.environ["AZURE_SPEECH_ENDPOINT"]
        (self.project / ".env").write_text(
            f"AZURE_SPEECH_AUTH=cli\nAZURE_SPEECH_ENDPOINT={self.endpoint}\n", encoding="utf-8",
        )
        self.assertEqual(azure.speech_auth(self.project), ("cli", self.endpoint))
        os.environ["AZURE_SPEECH_ENDPOINT"] = "https://override.cognitiveservices.azure.com"
        self.assertEqual(azure.speech_auth(self.project)[1], "https://override.cognitiveservices.azure.com/")

    def test_cli_rejects_unsafe_or_regional_endpoints(self):
        for endpoint in (
            "", "http://example.cognitiveservices.azure.com", "https://eastus.api.cognitive.microsoft.com/",
            "https://example.cognitiveservices.azure.com.evil.test/", "https://user@example.cognitiveservices.azure.com/",
            "https://example.cognitiveservices.azure.com:443/", "https://example.cognitiveservices.azure.com/tts",
            "https://example.cognitiveservices.azure.com/?x=1", "https://example.cognitiveservices.azure.com/#fragment",
        ):
            with self.subTest(endpoint=endpoint):
                os.environ["AZURE_SPEECH_ENDPOINT"] = endpoint
                with self.assertRaisesRegex(ValueError, "CLI authentication requires"):
                    azure.Narration(self.project)
        os.environ["AZURE_SPEECH_AUTH"] = "typo"
        with self.assertRaisesRegex(ValueError, "must be cli or key"):
            azure.speech_auth(self.project)

    def test_silent_ignores_invalid_endpoint_and_never_authenticates(self):
        os.environ["AZURE_SPEECH_ENDPOINT"] = "invalid"
        with patch.object(azure, "synthesize_cli") as synth:
            narration = azure.Narration(self.project, silent=True)
            self.assertGreater(narration.duration("intro"), 0)
            synth.assert_not_called()

    def test_cli_cache_is_endpoint_specific_and_auth_mode_specific(self):
        narration = azure.Narration(self.project)
        self.seed(narration)
        self.assertTrue(narration.has_audio("intro"))
        os.environ["AZURE_SPEECH_ENDPOINT"] = "https://second.cognitiveservices.azure.com/"
        self.assertFalse(azure.Narration(self.project).has_audio("intro"))
        os.environ["AZURE_SPEECH_AUTH"] = "key"
        self.assertFalse(azure.Narration(self.project).has_audio("intro"))

    def test_cli_generates_caches_without_key_and_never_calls_key_transport(self):
        narration = azure.Narration(self.project)
        with patch.object(azure, "check_cli_dependencies"), patch.object(
            azure, "synthesize_cli", return_value=b"fake-mp3",
        ) as synth, patch.object(azure, "synthesize") as key_synth, patch.object(
            azure, "speech_credentials",
        ) as keys, patch.object(azure, "probe_seconds", return_value=2):
            narration.generate()
            self.assertEqual(synth.call_count, 2)
            self.assertEqual(synth.call_args.args[0], self.endpoint)
            narration.generate()
            self.assertEqual(synth.call_count, 2)
            key_synth.assert_not_called()
            keys.assert_not_called()
        meta = json.loads(narration.clip("intro").with_suffix(".json").read_text(encoding="utf-8"))
        self.assertEqual(set(meta), {"digest", "seconds", "audio_sha256"})

    def test_cli_failure_never_falls_back_or_changes_cache(self):
        narration = azure.Narration(self.project)
        self.seed(narration)
        with patch.object(azure, "check_cli_dependencies"), patch.object(
            azure, "synthesize_cli", side_effect=RuntimeError("login failed"),
        ), patch.object(azure, "synthesize") as keys:
            with self.assertRaisesRegex(RuntimeError, "login failed"):
                narration.generate(force=True)
            keys.assert_not_called()
        self.assertEqual(narration.clip("intro").read_bytes(), b"mock-audio")

    def test_sdk_receives_cli_credential_ssml_mp3_and_no_speaker_output(self):
        modules, sdk, identity, credential, result, _ = self.fake_sdk()
        body = azure.ssml("A & B", "en-US-JennyNeural", "en-US", "0%")
        with modules:
            self.assertEqual(azure.synthesize_cli(self.endpoint, body), b"fake-mp3")
        identity.AzureCliCredential.assert_called_once_with(process_timeout=30)
        credential.get_token.assert_called_once_with(azure.TOKEN_SCOPE)
        sdk.SpeechConfig.assert_called_once_with(endpoint=self.endpoint, token_credential=credential)
        sdk.SpeechConfig.return_value.set_speech_synthesis_output_format.assert_called_once_with(
            sdk.SpeechSynthesisOutputFormat.Audio24Khz96KBitRateMonoMp3,
        )
        sdk.SpeechSynthesizer.assert_called_once_with(
            speech_config=sdk.SpeechConfig.return_value, audio_config=None,
        )
        sdk.SpeechSynthesizer.return_value.speak_ssml_async.assert_called_once_with(body.decode("utf-8"))
        identity.AzureCliCredential.return_value.__exit__.assert_called_once()

    def test_expired_login_is_actionable_and_redacted(self):
        modules, sdk, _, credential, _, error = self.fake_sdk()
        credential.get_token.side_effect = error("sensitive diagnostic")
        with modules, self.assertRaisesRegex(RuntimeError, "az login") as raised:
            azure.synthesize_cli(self.endpoint, b"text")
        self.assertNotIn("sensitive diagnostic", str(raised.exception))
        sdk.SpeechConfig.assert_not_called()

    def test_sdk_cancellation_and_errors_are_redacted(self):
        modules, sdk, _, _, result, _ = self.fake_sdk()
        result.reason = "canceled"
        result.cancellation_details.error_code.name = "AuthenticationFailure"
        result.cancellation_details.error_details = "sensitive diagnostic"
        with modules, self.assertRaisesRegex(RuntimeError, "AuthenticationFailure") as raised:
            azure.synthesize_cli(self.endpoint, b"text")
        self.assertNotIn("sensitive diagnostic", str(raised.exception))
        modules, sdk, _, _, _, _ = self.fake_sdk()
        sdk.SpeechConfig.side_effect = RuntimeError("sensitive diagnostic")
        with modules, self.assertRaisesRegex(RuntimeError, "Speech SDK failed") as raised:
            azure.synthesize_cli(self.endpoint, b"text")
        self.assertNotIn("sensitive diagnostic", str(raised.exception))

    def test_sdk_empty_audio_fails(self):
        modules, _, _, _, result, _ = self.fake_sdk()
        result.audio_data = b""
        with modules, self.assertRaisesRegex(RuntimeError, "empty audio"):
            azure.synthesize_cli(self.endpoint, b"text")

    def test_cli_dependencies_are_checked_without_authentication(self):
        with patch.object(azure.shutil, "which", return_value=None):
            with self.assertRaisesRegex(ValueError, "Azure CLI is missing"):
                azure.check_cli_dependencies()
        with patch.object(azure.shutil, "which", return_value="az"), patch.object(
            azure.importlib.metadata, "version", side_effect=azure.importlib.metadata.PackageNotFoundError,
        ):
            with self.assertRaisesRegex(ValueError, "restore"):
                azure.check_cli_dependencies()
        with patch.object(azure.shutil, "which", return_value="az"), patch.object(
            azure.importlib.metadata, "version", return_value="1.20.0",
        ):
            with self.assertRaisesRegex(ValueError, "requires"):
                azure.check_cli_dependencies()

    def test_check_reports_cli_mode_without_token_or_synthesis(self):
        (self.project / "scenes.py").write_text("ORDER = ['S1']", encoding="utf-8")
        output = io.StringIO()
        with patch.object(video, "check_cli_dependencies"), patch.object(
            azure, "synthesize_cli",
        ) as synth, redirect_stdout(output):
            video.check(self.project)
        self.assertIn("Azure CLI authentication configured", output.getvalue())
        self.assertIn("have NOT been tested", output.getvalue())
        self.assertNotIn("key and region configured", output.getvalue())
        synth.assert_not_called()


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = self.root / "source"
        self.project.mkdir()
        environment = patch.dict(os.environ, {"EXPLAINER_WORK_ROOT": str(self.root / "generated")})
        environment.start()
        self.addCleanup(environment.stop)

    def test_stable_and_distinct_for_same_named_projects(self):
        first = self.project / "demo"
        second = self.root / "other" / "demo"
        self.assertEqual(azure.work_directory(first), azure.work_directory(first))
        self.assertNotEqual(azure.work_directory(first), azure.work_directory(second))
        self.assertFalse(azure.work_directory(first).is_relative_to(self.project))
        self.assertFalse(azure.work_directory(first).exists())

    def test_source_directory_is_rejected_without_git(self):
        os.environ["EXPLAINER_WORK_ROOT"] = str(self.project / "generated")
        with self.assertRaisesRegex(ValueError, "outside the source project"):
            azure.work_directory(self.project)

    def test_any_git_repository_and_worktree_are_rejected(self):
        for marker in ("directory", "file"):
            with self.subTest(marker=marker):
                repo = self.root / marker
                repo.mkdir()
                if marker == "directory":
                    (repo / ".git").mkdir()
                else:
                    (repo / ".git").write_text("gitdir: elsewhere", encoding="utf-8")
                os.environ["EXPLAINER_WORK_ROOT"] = str(repo / "nested" / "generated")
                with self.assertRaisesRegex(ValueError, "outside Git repositories"):
                    azure.work_directory(self.project)

    def test_relative_override_is_rejected(self):
        os.environ["EXPLAINER_WORK_ROOT"] = "relative"
        with self.assertRaisesRegex(ValueError, "absolute path"):
            azure.work_directory(self.project)

    def test_platform_default_directories(self):
        for platform, suffix in (
            ("win32", ("local",)),
            ("darwin", ("Library", "Application Support")),
            ("linux", ("xdg",)),
        ):
            with self.subTest(platform=platform), patch.dict(os.environ, {
                "EXPLAINER_WORK_ROOT": "", "LOCALAPPDATA": str(self.root / "local"),
                "XDG_DATA_HOME": str(self.root / "xdg"),
            }), patch.object(azure.sys, "platform", platform), patch.object(
                azure.Path, "home", return_value=self.root,
            ):
                expected = self.root.joinpath(*suffix, "andrejky-agent-kit", "explainer-video")
                self.assertEqual(azure.work_directory(self.project).parent, expected.resolve())

    def test_review_uses_external_workspace(self):
        workspace = azure.work_directory(self.project)
        (workspace / "out").mkdir(parents=True)
        (workspace / "out" / "build-480p15.json").write_text(json.dumps({
            "order": ["S1"], "timings": {"S1": [{"seconds": 2}]},
            "silent": True, "output": "preview.mp4",
        }), encoding="utf-8")
        with patch.object(video, "require_media_tools"), patch.object(
            video, "probe_seconds", return_value=3,
        ), patch.object(video.subprocess, "run") as run:
            video.review(self.project, "low", 3)
        command = run.call_args.args[0]
        self.assertEqual(command[command.index("-i") + 1], str(workspace / "media" / "videos" / "scenes" / "480p15" / "S1.mp4"))
        self.assertEqual(command[-1], str(workspace / "review" / "S1.png"))
        self.assertEqual(list(self.project.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
