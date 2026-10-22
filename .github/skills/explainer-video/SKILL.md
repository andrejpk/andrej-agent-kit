---
name: explainer-video
description: Create narrated animated explainer, walkthrough, or demo videos with Manim and Azure AI Speech. Use for explanations of banking transaction processing, architecture, designs, prototypes, or results; requests for a Manim video; and narrated explanations of how something works. Includes a fictional banking transfer example covering idempotency, atomic ledger posting, and safe retries.
---

# Narrated explainer videos for GitHub Copilot

Write short narration segments, draw their mechanisms in Manim, and time
animation beats to Azure AI Speech clips. Deliver an MP4 with embedded audio.
Use the bundled `scripts` and `examples` relative to this skill directory,
not relative to an assumed repository root. Do not require Claude commands,
hooks, a marketplace, or other plugins.

## 1. Establish the story and boundaries

Ask where video source scripts should live unless the user already specified
it. Keeping source scripts in a repository is the user's choice; generated
artifacts must stay outside repositories.
Read the sources being explained. Separate measured facts from illustrative
assumptions; never invent benchmarks, customer results, or regulatory claims.
Choose three to five mechanisms that can be drawn.

For a banking demo, start with `examples/banking-transfer`. It explains a
fictional same-bank transfer, a lost response, and a retry with the same
idempotency key. It is not a real bank integration or a complete payment
processor. Real customer names, account numbers, balances, transaction IDs,
credentials, or confidential bank architecture must not be used.

The example's amounts are illustrative. Distinguish a database commit from
interbank clearing and settlement. Explain that idempotency depends on the
key scope, request matching, concurrency control, atomic recording, and
retention window, not on a magic "exactly once" network guarantee.

## 2. Prepare the project

The runtime requires Python 3.11-3.13, uv, Manim, ffmpeg, and ffprobe. Run:

```powershell
uv run python "<skill-dir>\scripts\video.py" check "<topic>"
```

The check installs nothing. Report missing prerequisites and ask before
installing system packages. LaTeX is optional; use `Text` rather than
`MathTex`, `Integer`, or `DecimalNumber` to avoid it.

On Windows, WinGet's `Gyan.FFmpeg` package supplies both `ffmpeg` and
`ffprobe`. After getting approval to install, run:

```powershell
winget install --id Gyan.FFmpeg --exact --source winget
```

Open a new terminal afterward so it picks up the updated PATH. If Copilot
still cannot find the tools, restart its hosting app or CLI session, then
verify both commands and rerun the prerequisite check:

```powershell
ffmpeg -version
ffprobe -version
uv run python "<skill-dir>\scripts\video.py" check "<topic>"
```

Copy the example to the selected topic folder. If it is outside the skill,
copy `scripts/explainer_kit.py` and `scripts/azure_narration.py` beside its
`scenes.py`. Use the skill package's Manim environment rather than adding
dependencies to the application being explained. In another working directory,
invoke that environment's Python explicitly and pass absolute script/topic
paths. Ignore `.env` and `.venv/` if used.
Do not overwrite existing user files without checking them first.

`video.py` stores generated files in a per-user workspace, not beside the
sources. The default root is `%LOCALAPPDATA%\andrejky-agent-kit\explainer-video`
on Windows, `~/Library/Application Support/andrejky-agent-kit/explainer-video`
on macOS, and `$XDG_DATA_HOME/andrejky-agent-kit/explainer-video` on Linux
(default `~/.local/share`). Each topic has a name plus a hash of its absolute
source path. `check` and `build` print the resolved workspace.

Audio, Manim media/caches, logs, temporary files, review images, manifests,
and final MP4s all belong in that workspace. An optional `EXPLAINER_WORK_ROOT`
must be absolute and outside Git repositories and the source directory;
the tool rejects unsafe locations rather than relying on `.gitignore`.
Use `video.py build`, not a direct `manim` invocation that bypasses this
layout. Render subprocesses disable bytecode writes and run in the external
workspace. Resolve source-relative assets using `Path(__file__).parent`.
Do not migrate or remove old artifacts without checking with the user.

Each project has:

```text
<topic>/
  script.py          SEGMENTS and voice configuration
  scenes.py          Narrated scenes and their ORDER
  explainer_kit.py   needed when outside the bundled example location
  azure_narration.py needed when outside the bundled example location
```

## 3. Write the narration

```python
SEGMENTS = {
    "intro": "A transfer response can be lost after the bank commits the transfer.",
    "retry": "The client retries with the same idempotency key. The bank returns the recorded result instead of moving the money again.",
}
VOICE_NAME = "en-US-JennyNeural"
LANGUAGE = "en-US"
SPEECH_RATE = "0%"
```

Use one idea per sentence and two to five sentences per segment. Aim for
8-25 seconds per clip. Spell out words and numbers that TTS might mangle:
"one hundred dollars", "A P I", "idempotency key". Use plain narration text,
not SSML; the kit escapes it safely and constructs SSML.

Use a voice supported by the Speech resource's region. `SPEECH_RATE` is a
percentage from `-50%` to `100%`. Azure synthesizes clips independently;
do not assume cross-clip context or claim ElevenLabs-style neighboring-text
support. Listen for consistency at clip boundaries if audio playback is
available.

## 4. Draw the mechanism

Use a dark background, thin colored outlines with faint fills, sparse text,
and motion that explains causality. Use one color per concept throughout.
Keep captions distinct from the narration, font sizes at least 20 at 1080p,
and objects at least 0.4 scene units inside the frame edges.

```python
Narrated.narration = Narration.beside(__file__)
ORDER = ["S1Problem"]

class S1Problem(Narrated):
    def construct(self):
        self.say("intro")
        title = T("One transfer, one posting", 40)
        self.play(Write(title), run_time=1.5)
        self.until(0.5)
        self.done()
        self.clear_all()
```

`say` starts a clip, `until` waits to a fraction of its length, and `done`
pads to its end. End one segment before starting the next. The kit warns
when animation overruns narration. Use one scene per section; set `ORDER`
to the exact rendering and joining order.

Helpers include `T`, `M`, `box`, `chip`, `edge`, `flow`, `database`, `device`,
`stat`, `lit`, and `heading`. A `box`'s first member is its outline and its
second is its label. Use `lit` to dim or restore it; `set_opacity(1)` would
make a faint fill solid. Dash individual paths, not a whole `VGroup`.

For the banking example, animate the request moving to the bank, show the
balanced posting in a single atomic boundary, lose the response, then show
the same key returning the saved result without another posting.

## 5. Preview without cloud calls

```powershell
uv run python "<skill-dir>\scripts\video.py" build "<topic>" --quality low --silent
uv run python "<skill-dir>\scripts\video.py" review "<topic>" --quality low
```

`--silent` is deliberate, uses estimated timings, and ignores cached audio.
Read every `<external-workspace>/review/<Scene>.png`. Fix overlap, tiny labels, off-frame elements,
unintended filled boxes, and objects left behind from earlier beats. Contact
sheets are samples, not proof that every frame is correct. Extract additional
frames around transitions when needed.

## 6. Generate narration and render

Use an existing Azure Speech resource. Configure `AZURE_SPEECH_KEY` and
`AZURE_SPEECH_REGION` in the environment or the topic's ignored `.env`.
Environment values take precedence. Never print credentials, inspect them
in a transcript, commit them, or place them on a command line.

If the user prefers Azure CLI, have them run `az login` themselves and identify
the existing resource's subscription, resource group, and name. CLI login is
not direct Speech authentication in this implementation. Capture
`az cognitiveservices account show --subscription <id> --resource-group <rg> --name <name> --query location --output tsv`
into `AZURE_SPEECH_REGION`, and capture
`az cognitiveservices account keys list --subscription <id> --resource-group <rg> --name <name> --query key1 --output tsv`
into `AZURE_SPEECH_KEY`, without displaying the result. Check each command's
exit status and reject empty values before building. Use the README's
PowerShell or macOS/Linux setup snippets when working from this package.
For a standalone installed skill, follow the same capture/check procedure.
Disable shell tracing and do not use CLI debug logging.

The caller needs permission to read the resource and list its keys.
If policy disables key authentication or access is denied, stop and consult
the resource owner; do not change policy, grant roles, or rotate keys.
Run the build in the configured terminal, or launch Copilot CLI from it.
An already-running Copilot app will not inherit newly set shell variables.
Do not request secrets in chat or imply that Entra/keyless auth is implemented.

Before sending narration, get the user's approval for the text, destination
resource/region, and potential Azure charges unless already authorized.
Do not create resources or change permissions as part of video generation.
Only narration text is sent, not code or source documents.

```powershell
uv run python "<skill-dir>\scripts\video.py" build "<topic>" --quality high
uv run python "<skill-dir>\scripts\video.py" review "<topic>" --quality high
```

Normal builds fail if narration cannot be generated; never hide a failed
speech request by silently falling back. `--force` regenerates all clips
and may incur charges again. Cache keys include the text and synthesis
configuration; changing one segment regenerates only that segment.

The kit uses the regional public Azure Speech REST endpoint, with escaped
SSML and subscription-key authentication. It does not use M365 browser TTS,
an undocumented endpoint, or an ElevenLabs dependency.

## 7. Review and hand off

Review the final-resolution contact sheets, the per-scene timing table, and
silence detection. Slack over about six seconds or pauses over 2.5 seconds
need inspection; fix animation durations or narration where appropriate.
Check that the joined final file has an audio stream. Review the end of
each clip for cut-off speech.

Report the path, duration, and resolution of the final MP4. Clearly label
silent previews. State exactly what was reviewed; if you cannot listen,
say so and name words to spot-check, especially "idempotency", "ledger",
"debit", "credit", and "settlement". Do not claim a successful narrated
render from only a silent or mocked test.

Do not commit or publish generated video or narration unless asked.
