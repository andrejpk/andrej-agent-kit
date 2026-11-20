"""Offline checks for the design-panel-review skill's report builder."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / ".github" / "skills" / "design-panel-review"
NODE = shutil.which("node")


class DesignPanelReviewSkillTests(unittest.TestCase):
    def test_skill_front_matter(self) -> None:
        head = (SKILL / "SKILL.md").read_text(encoding="utf-8").split("---")[1]
        self.assertIn("name: design-panel-review", head)
        self.assertIn("description:", head)

    def test_sample_weights_sum_to_100(self) -> None:
        data = json.loads((SKILL / "examples" / "rounds.json").read_text(encoding="utf-8"))
        self.assertEqual(sum(w for _, _, w in data["criteria"]), 100)

    @unittest.skipUnless(NODE, "node is not installed")
    def test_report_marks_pending_and_recomputes_overall(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            data = json.loads((SKILL / "examples" / "rounds.json").read_text(encoding="utf-8"))
            data["rounds"][0]["scores"]["sol"]["overall"] = 9.9
            (Path(tmp) / "rounds.json").write_text(json.dumps(data), encoding="utf-8")
            script = str(SKILL / "scripts" / "build-report.mjs")

            live = subprocess.run([NODE, script, tmp], capture_output=True, text=True)
            self.assertEqual(live.returncode, 0, live.stderr)
            self.assertIn("round 0 sol: reported 9.9", live.stderr)
            html = (Path(tmp) / "report.html").read_text(encoding="utf-8")
            self.assertIn('http-equiv="refresh" content="30"', html)
            self.assertIn("pending", html)
            self.assertIn("partial", html)
            self.assertNotIn("9.9", html)

            shared = subprocess.run([NODE, script, tmp, "--share"], capture_output=True, text=True)
            self.assertEqual(shared.returncode, 0, shared.stderr)
            self.assertNotIn("http-equiv", (Path(tmp) / "report-share.html").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
