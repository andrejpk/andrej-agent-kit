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

### Recommended: keyless Azure CLI authentication

API keys can remain disabled. Use an existing Speech resource with a custom
subdomain and **Cognitive Services Speech User** access for your signed-in
identity. Management-plane Reader access alone is not sufficient. If access
or the custom subdomain is missing, consult the resource owner; do not change
policy or assign roles as part of this workflow. Creating a custom subdomain
is irreversible. Sovereign-cloud endpoints are not supported.

Install the declared dependencies with `uv sync` in the skill package, not
your application repository. Install Azure CLI separately if needed, then
sign into the correct work tenant and subscription:

```powershell
az login --tenant "<tenant-id>" --output none
if ($LASTEXITCODE -ne 0) { throw "Azure login failed" }
az account set --subscription "<subscription-id>"
if ($LASTEXITCODE -ne 0) { throw "Azure subscription selection failed" }
az account show --query "{tenant:tenantId,subscription:id,user:user.name}" --output json
```

On macOS/Linux:

```bash
az login --tenant "<tenant-id>" --output none &&
az account set --subscription "<subscription-id>" &&
az account show --query '{tenant:tenantId,subscription:id,user:user.name}' --output json
```

Copy `.env.example` to `.env` beside the topic's `script.py` (do not overwrite
an existing file), and configure your endpoint **locally**:

```dotenv
AZURE_SPEECH_AUTH=cli
AZURE_SPEECH_ENDPOINT=https://<custom-name>.cognitiveservices.azure.com/
```

Use the HTTPS resource root, not a regional endpoint, service path, query
string, or token URL. Do not commit your endpoint, tenant, or subscription;
checked-in examples use placeholders. `.env` is Git-ignored. No resource key,
region, resource ID, or copied access token is needed in CLI mode.

The Azure Identity `AzureCliCredential` uses the current user's CLI login;
the Speech SDK requests short-lived tokens as needed for the Cognitive
Services scope. Tokens are not written to project files, audio metadata, or
logs. Azure CLI manages its own login cache. The client does not try other
credential providers, retrieve resource keys, or fall back to keys on failure.

Environment variables override `.env` values. With no `AZURE_SPEECH_AUTH`,
an endpoint selects CLI mode; otherwise the legacy key mode is retained.
Set `AZURE_SPEECH_AUTH=cli` explicitly to avoid ambiguity. Existing key/region
values are ignored in CLI mode. Silent previews do not contact Azure or
require Azure SDK packages, an endpoint, or a login.

Run under the same OS user and Azure CLI configuration used for `az login`.
An already-running Copilot app can use that CLI login cache, but it will not
inherit environment variables newly set in another terminal. Use the topic's
local `.env` for endpoint configuration in that case. Do not enable shell
tracing, Azure SDK debug logging, or environment dumps.

`check` validates local configuration and installed dependencies only. It
does not acquire a token, verify RBAC, or call Speech. A narrated build can
incur charges and needs content/destination approval. On authentication
failure, verify the CLI tenant/subscription and log in again if required;
on authorization failure, ask the resource owner to verify Speech User
access and allow time for role propagation. Network-restricted resources
also require your machine to have approved network/DNS access; never disable
firewalls or TLS checks to get around an error.

### Optional legacy API-key mode

Only where organizational policy permits keys, configure these locally:

```dotenv
AZURE_SPEECH_AUTH=key
AZURE_SPEECH_KEY=your-local-key
AZURE_SPEECH_REGION=eastus
```

Use the resource's actual region. Keys belong in the ignored `.env` or an
approved secret-injected environment, never in chat or source code.
Key mode retains the regional public-Azure REST implementation.

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
`SPEECH_RATE` in `script.py` to change it. CLI mode uses the custom resource
endpoint via the Speech SDK; key mode uses the regional REST endpoint.

Clips are cached by text, voice, language, rate, output format, and provider
configuration (region in key mode, custom endpoint in CLI mode).
Changing the endpoint or authentication mode invalidates the relevant cache;
token renewal does not.
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
| `scripts/azure_narration.py` | Azure CLI/Entra SDK and key-based REST synthesis, SSML, cache |
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
[Speech Entra authentication](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-configure-azure-ad-auth),
[Azure Speech voices](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts),
[Azure Speech pricing](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/).
