"""Contracts for the repository's Copilot skill package."""

from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / ".github" / "skills"


def frontmatter(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    opening, *rest = text.splitlines()
    if opening != "---":
        raise AssertionError(f"{path} has no frontmatter")
    values: dict[str, str] = {}
    for line in rest:
        if line == "---":
            break
        key, separator, value = line.partition(":")
        if separator:
            values[key.strip()] = value.strip()
    return values


def local_markdown_links(path: Path) -> list[Path]:
    text = path.read_text(encoding="utf-8")
    links: list[Path] = []
    for destination in re.findall(r"\[[^\]]+\]\(([^)]+)\)", text):
        if "://" in destination or destination.startswith("#"):
            continue
        local = destination.split("#", 1)[0]
        if local:
            links.append((path.parent / local).resolve())
    return links


class CopilotBindingTests(unittest.TestCase):
    def test_expected_skills_are_discoverable_and_unique(self):
        expected = {"explainer-video", "pr-flow", "gh-orchestrator"}
        found: dict[str, Path] = {}

        for path in SKILLS.glob("*/SKILL.md"):
            metadata = frontmatter(path)
            name = metadata.get("name")
            self.assertTrue(name, f"{path} has no name")
            self.assertNotIn(name, found, f"duplicate skill name {name}")
            self.assertTrue(metadata.get("description"), f"{path} has no description")
            found[name] = path

        self.assertTrue(expected.issubset(found), f"missing skills: {expected - set(found)}")

    def test_installable_bindings_have_no_external_local_dependencies(self):
        for relative in (
            ".github/skills/pr-flow/SKILL.md",
            ".github/skills/gh-orchestrator/SKILL.md",
            ".github/agents/pr-flow-reviewer.agent.md",
        ):
            path = ROOT / relative
            self.assertEqual(
                local_markdown_links(path),
                [],
                f"{relative} cannot be copied independently",
            )

    def test_gh_binding_documents_unsupported_automation(self):
        text = (SKILLS / "gh-orchestrator" / "SKILL.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("Copilot boundaries", text)
        for unavailable in (
            "webhook filters",
            "T3 thread",
            "private T3 Artifact",
            "after the Copilot session exits",
        ):
            self.assertIn(unavailable, text)

        self.assertNotRegex(text, r"\b(t3_thread_|schedule_task|delegate_task)\b")

    def test_copilot_reviewer_is_a_repo_agent_binding(self):
        path = ROOT / ".github" / "agents" / "pr-flow-reviewer.agent.md"
        metadata = frontmatter(path)
        self.assertEqual(metadata["name"], "pr-flow-reviewer")
        self.assertTrue(metadata["description"])
        self.assertEqual(metadata["tools"], '["read", "search"]')
        text = path.read_text(encoding="utf-8")
        self.assertIn("Do not edit files, commit, push, or write", text)
        self.assertTrue(
            (ROOT / "plugins" / "pr-flow" / "agents" / "reviewer.md").is_file()
        )

    def test_readme_lists_all_installable_project_skills(self):
        text = (ROOT / "README.md").read_text(encoding="utf-8")
        for name in ("explainer-video", "pr-flow", "gh-orchestrator"):
            self.assertRegex(
                text,
                re.compile(rf"\.github[/\\]skills[/\\]{re.escape(name)}"),
            )
