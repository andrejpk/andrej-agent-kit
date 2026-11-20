"""Offline checks for the GitHub Copilot plugin bindings."""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins" / "pr-flow"


class CopilotBindingsTests(unittest.TestCase):
    def load(self, path: Path) -> dict:
        return json.loads(path.read_text(encoding="utf-8"))

    def test_marketplace_points_at_existing_plugins(self) -> None:
        market = self.load(ROOT / ".github" / "plugin" / "marketplace.json")
        self.assertEqual(market["name"], self.load(ROOT / ".claude-plugin" / "marketplace.json")["name"])
        names = {p["name"] for p in market["plugins"]}
        self.assertEqual(names, {"pr-flow"})
        for entry in market["plugins"]:
            manifest = self.load(ROOT / entry["source"] / ".github" / "plugin" / "plugin.json")
            self.assertEqual(manifest["name"], entry["name"])
            claude = self.load(ROOT / entry["source"] / ".claude-plugin" / "plugin.json")
            self.assertEqual(manifest["version"], claude["version"])

    def test_plugin_manifest_paths_exist(self) -> None:
        manifest = self.load(PLUGIN / ".github" / "plugin" / "plugin.json")
        self.assertTrue(list((PLUGIN / manifest["skills"]).glob("*/SKILL.md")))
        self.assertTrue(list((PLUGIN / manifest["agents"]).glob("*.agent.md")))

    def test_skills_have_front_matter(self) -> None:
        for skill in (PLUGIN / "skills").glob("*/SKILL.md"):
            head = skill.read_text(encoding="utf-8").split("---")[1]
            self.assertIn(f"name: {skill.parent.name}", head)
            self.assertIn("description:", head)

    def test_generated_agents_are_current(self) -> None:
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "sync_copilot_agents.py"), "--check"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_reviewer_stays_read_only(self) -> None:
        text = (PLUGIN / "copilot" / "agents" / "reviewer.agent.md").read_text(encoding="utf-8")
        self.assertIn("tools: ['read', 'search', 'execute']", text)
        self.assertNotIn("'edit'", text)


if __name__ == "__main__":
    unittest.main()
