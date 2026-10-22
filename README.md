# andrejky-agent-kit

A GitHub Copilot skill package for making narrated, animated explainer videos
with **Manim** and **Azure AI Speech**. No Claude plugin runtime or ElevenLabs
account is needed.

The included banking example explains **idempotent bank transfers**: a request
is retried after a timeout, but an atomic ledger transaction moves the money
only once. It uses fictional accounts and amounts, not customer data.

## Use with GitHub Copilot

Open this repository in a Copilot-enabled editor, the Copilot app, or Copilot
CLI. The project skill is discovered at
`.github/skills/explainer-video/SKILL.md`.

Try:

> Use the explainer-video skill to explain why a retried bank transfer must not
> debit the account twice. Start with the banking-transfer example and make a
> silent preview before generating Azure narration.

To use it in another repository, copy the entire
`.github/skills/explainer-video` folder into that repository's `.github/skills`.
To install it personally for Copilot CLI, copy the folder into
`$HOME\.copilot\skills\explainer-video`. Copy the whole folder, not just
`SKILL.md`; the scripts and example are part of the skill. Check before
overwriting an existing installation. Personal installations are not
automatically available to the cloud agent.

## Local setup

Requires Python 3.11-3.13, [uv](https://docs.astral.sh/uv/), and
[FFmpeg](https://ffmpeg.org/download.html) with both `ffmpeg` and `ffprobe` on
PATH. Manim may require Cairo and Pango development libraries on Linux/macOS;
see [Manim installation](https://docs.manim.community/en/stable/installation.html).
The example uses `Text` and does not need LaTeX. Inter is optional; Pango uses
its default font if it is unavailable.

On Windows, install both `ffmpeg` and `ffprobe` with WinGet:

```powershell
winget install --id Gyan.FFmpeg --exact --source winget
```

Open a new terminal to pick up the updated PATH, then verify:

```powershell
ffmpeg -version
ffprobe -version
```

If Copilot still cannot find the tools, restart its hosting app or CLI
session so it inherits the updated PATH.

Run from this repository in PowerShell:

```powershell
uv sync --python 3.12
$skill = ".github\skills\explainer-video"
$topic = "$skill\examples\banking-transfer"
uv run python "$skill\scripts\video.py" check "$topic"
uv run python "$skill\scripts\video.py" build "$topic" --quality low --silent
uv run python "$skill\scripts\video.py" review "$topic" --quality low
```

The Python commands are cross-platform; use your shell's path conventions.
`check` only inspects the environment; it installs nothing. Review contact
sheets in the external workspace's `review` directory before a final render.

## Source files versus generated files

Keeping `script.py`, `scenes.py`, and the helper scripts in a repository is
optional. Generated files never belong there. `check` and `build` print a
stable workspace location for each source directory:

| Platform | Default workspace root |
| --- | --- |
| Windows | `%LOCALAPPDATA%\andrejky-agent-kit\explainer-video` |
| macOS | `~/Library/Application Support/andrejky-agent-kit/explainer-video` |
| Linux | `$XDG_DATA_HOME/andrejky-agent-kit/explainer-video`, defaulting to `~/.local/share/...` |

Each topic gets a `<topic-name>-<source-path-hash>` subdirectory, so two
repositories with a topic named `demo` do not share files. It contains
`audio`, `media`, `out`, `review`, temporary files, build manifests, and logs.
Build and review resolve the same location regardless of the shell's current
directory. Render subprocesses run there with bytecode writes disabled.
For source-relative assets in your scenes, use `Path(__file__).parent`,
not the current working directory.

Optionally set `EXPLAINER_WORK_ROOT` to another absolute directory outside
repositories. The tool rejects workspaces inside the source directory or any
Git repository/worktree, even if they would be ignored by Git. Existing files
from older in-repository renders are not automatically moved or deleted.
Do not copy finished media back into a repository unless explicitly requested.

This separates **generated artifacts**, not Python dependencies: the tool
still uses the Python environment you launch it with. Use the skill package's
environment rather than adding Manim to the application project's dependencies.

## Azure voice-over

Use an existing Azure Speech resource. This package does not provision resources,
change permissions, or make paid calls during tests or silent previews.

Set `AZURE_SPEECH_REGION` to the resource's region (for example, `eastus`) and
inject `AZURE_SPEECH_KEY` using your approved secret-management tooling.
Alternatively, copy the example's `.env.example` to `.env` beside `script.py`
and fill it in locally. Environment variables take precedence over that file.
`.env` is ignored by Git. Never paste keys into chat, scripts, or command
arguments. The implementation deliberately does not execute secret-retrieval
shell commands or search unrelated credential stores.

### Use your Azure CLI login to load the credentials

`az login` authenticates the Azure CLI, not this package's Speech requests.
The current client uses a Speech resource key, not a CLI/Entra access token.
Use an **existing, approved Speech resource** with local/key authentication
enabled. You need its subscription ID, resource group, and resource name,
plus permission to read the resource and list its keys. Ordinary Reader
access is not enough to list keys. If access or key authentication is denied,
stop and consult the resource owner; do not weaken policy or rotate keys.

Run this locally in PowerShell, replacing the three placeholders:

```powershell
az login --output none
if ($LASTEXITCODE -ne 0) { throw "Azure login failed" }

$subscription = "<subscription-id>"
$resourceGroup = "<resource-group>"
$speechResource = "<speech-resource-name>"

$env:AZURE_SPEECH_REGION = az cognitiveservices account show --subscription $subscription --resource-group $resourceGroup --name $speechResource --query location --output tsv --only-show-errors
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($env:AZURE_SPEECH_REGION)) {
    throw "Could not read the Speech resource region"
}
$env:AZURE_SPEECH_KEY = az cognitiveservices account keys list --subscription $subscription --resource-group $resourceGroup --name $speechResource --query key1 --output tsv --only-show-errors
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($env:AZURE_SPEECH_KEY)) {
    throw "Could not retrieve the Speech resource key"
}
```

The assignments capture the key without displaying it or writing a `.env`
file. Do not run with shell tracing, Azure CLI `--debug`, or environment
dumps. Run the video command **in that same terminal**. An already-running
Copilot app does not inherit environment variables set in a different shell.
For Copilot CLI, launch it from the configured terminal; for the app, use
its approved environment/secret configuration or run the build yourself.
No secret should be pasted into chat.

On macOS/Linux, the equivalent is:

```bash
az login --output none &&
subscription="<subscription-id>" &&
resource_group="<resource-group>" &&
speech_resource="<speech-resource-name>" &&
AZURE_SPEECH_REGION="$(az cognitiveservices account show --subscription "$subscription" --resource-group "$resource_group" --name "$speech_resource" --query location --output tsv --only-show-errors)" &&
test -n "$AZURE_SPEECH_REGION" &&
AZURE_SPEECH_KEY="$(az cognitiveservices account keys list --subscription "$subscription" --resource-group "$resource_group" --name "$speech_resource" --query key1 --output tsv --only-show-errors)" &&
test -n "$AZURE_SPEECH_KEY" &&
export AZURE_SPEECH_REGION AZURE_SPEECH_KEY ||
{ echo "Azure Speech credential setup failed; do not run the build." >&2; }
```

Disable shell tracing (`set +x`) before retrieval if it is enabled. These
commands read the existing resource and key; they do not create resources,
change permissions, or generate paid speech. If you do not have a resource
yet, arrange one through your Azure administrator before proceeding.

### Render from the configured terminal

```powershell
# Run from the package directory; $skill and $topic are set in Local setup.
uv run python "$skill\scripts\video.py" check "$topic"
uv run python "$skill\scripts\video.py" build "$topic" --quality high
uv run python "$skill\scripts\video.py" review "$topic" --quality high
```

Azure receives the narration text. Confirm that the content is approved for
that resource and region before generation; synthesis can incur charges.
The default voice is `en-US-JennyNeural`; edit `VOICE_NAME`, `LANGUAGE`, and
`SPEECH_RATE` in `script.py` to change it. Regional public-Azure Speech endpoints
are supported; private/custom endpoints, sovereign clouds, and Entra
authentication are not implemented in this version.

Clips are cached by text, voice, language, rate, region, and output format.
Changing one segment regenerates only that clip. Authentication, network, or
rendering errors fail the build instead of producing an apparently successful
silent final video. `--silent` explicitly disables all audio, including cached
clips, and uses estimated narration timings.

Output:
`<external-workspace>\out\<topic-name>-1080p60.mp4` (or `480p15` for low quality).
Silent previews include `-silent` in their filename.

## Package contents

| Path under `.github/skills/explainer-video` | Purpose |
| --- | --- |
| `SKILL.md` | Copilot workflow, content safeguards, visual and review guidance |
| `scripts/azure_narration.py` | Azure REST synthesis, SSML, per-segment cache |
| `scripts/explainer_kit.py` | Visual helpers and narration-paced Manim scenes |
| `scripts/video.py` | Cross-platform prerequisite checks, build, review |
| `examples/banking-transfer` | Complete narration and animated scenes |

For another video, copy the example folder, then edit `script.py` and
`scenes.py`. When moving an example outside the installed skill, copy
`azure_narration.py` and `explainer_kit.py` beside `scenes.py` as well.
Run it in a uv project with Manim installed. Video scripts are executable
Python: review them before building untrusted projects.

## Development

```powershell
python -m unittest discover -s tests -v
```

Tests use the standard library and mocked Azure responses; they need neither
Azure credentials nor Manim. Integration rendering requires the setup above.
Keep generated media and secrets out of commits.

Adapted from the owner's personal `agent-kit` explainer-video skill. Only the
video workflow was brought over; the original sports domain, plugin marketplace,
and unrelated skills were not copied. No upstream license was present in the
provided folder; no new license or ownership grant is inferred here.

References:
[Copilot agent skills](https://docs.github.com/en/copilot/concepts/customizations/agent-skills),
[Azure Speech REST API](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech),
[Azure CLI resource keys](https://learn.microsoft.com/en-us/cli/azure/cognitiveservices/account/keys#az-cognitiveservices-account-keys-list),
[Azure Speech voices](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts),
[Azure Speech pricing](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/).
