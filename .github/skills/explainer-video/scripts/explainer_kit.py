"""Manim visual helpers and narration-paced scenes, adapted from the personal kit."""

from __future__ import annotations

import json
import warnings
from pathlib import Path

from manim import *  # noqa: F403

from azure_narration import Narration

BG = "#0e1116"
FG = "#e8e6e3"
DIM = "#7d8590"
FONT = "Inter"
MONO = "DejaVu Sans Mono"
C1, C2, C3, C4, C5 = BLUE_C, TEAL_C, GREEN_C, YELLOW_C, GOLD_E
C_STORE = PURPLE_B
C_BAD = RED_C
C_FEED = WHITE


def T(text: str, size: float = 30, color=FG, weight=NORMAL, **kw) -> Text:
    return Text(text, font=FONT, font_size=size, color=color, weight=weight, **kw)


def M(text: str, size: float = 24, color=FG, **kw) -> Text:
    return Text(text, font=MONO, font_size=size, color=color, **kw)


def box(color, w: float = 1.2, h: float = 0.5, label: str | None = None, size: float = 20, fill: float = 0.18) -> VGroup:
    rect = RoundedRectangle(corner_radius=0.1, width=w, height=h, stroke_color=color, stroke_width=2.5)
    rect.set_fill(color, opacity=fill)
    group = VGroup(rect)
    if label:
        group.add(T(label, size, color=FG).move_to(rect))
    return group


def lit(node: VGroup, on: bool = True, fill: float = 0.18) -> Animation:
    """Restore stroke and label opacity without turning the fill solid."""
    target = node.copy().set_opacity(1 if on else 0.25)
    target[0].set_fill(opacity=fill if on else fill * 0.3)
    return Transform(node, target)


def chip(text: str, color, size: float = 20) -> VGroup:
    label = T(text, size, color=BG, weight=BOLD)
    background = RoundedRectangle(
        corner_radius=0.08, width=max(label.width + 0.22, 0.42),
        height=label.height + 0.18, stroke_width=0,
    ).set_fill(color, 1)
    return VGroup(background, label.move_to(background))


def database(color=C_STORE, w: float = 0.9, h: float = 1.0) -> VGroup:
    top = Ellipse(width=w, height=w * 0.32, stroke_color=color, stroke_width=2.5).set_fill(color, 0.35)
    body = Rectangle(width=w, height=h, stroke_width=0).set_fill(color, 0.18)
    body.next_to(top.get_center(), DOWN, buff=0)
    left = Line(top.get_left(), top.get_left() + DOWN * h, color=color, stroke_width=2.5)
    right = Line(top.get_right(), top.get_right() + DOWN * h, color=color, stroke_width=2.5)
    bottom = Arc(radius=1, start_angle=PI, angle=PI, color=color, stroke_width=2.5)
    bottom.stretch_to_fit_width(w).stretch_to_fit_height(w * 0.16)
    bottom.move_to(top.get_center() + DOWN * h, aligned_edge=UP)
    return VGroup(body, top, left, right, bottom)


def device(w: float = 0.8, h: float = 1.3, color=GREY_B, screen=C1) -> VGroup:
    shell = RoundedRectangle(corner_radius=0.14, width=w, height=h, stroke_color=color, stroke_width=2.5)
    shell.set_fill(GREY_E, 0.6)
    display = RoundedRectangle(corner_radius=0.06, width=w * 0.78, height=h * 0.55, stroke_width=0)
    display.set_fill(screen, 0.35).move_to(shell).shift(UP * h * 0.1)
    button = Circle(radius=w * 0.13, stroke_color=color, stroke_width=2)
    button.move_to(shell).shift(DOWN * h * 0.33)
    return VGroup(shell, display, button)


def edge(a: Mobject, b: Mobject, color=GREY_B, opacity: float = 0.55, width: float = 2.0) -> Line:
    return Line(a.get_right(), b.get_left(), color=color, stroke_width=width, stroke_opacity=opacity)


def flow(line: Line, color=C_FEED, run_time: float = 0.8, width: float = 6) -> Animation:
    return ShowPassingFlash(
        line.copy().set_stroke(color, width=width, opacity=1),
        time_width=0.45, run_time=run_time,
    )


def stat(big: str, small: str, color=FG, size: float = 56) -> VGroup:
    return VGroup(
        T(big, size, color=color, weight=BOLD), T(small, 22, color=DIM),
    ).arrange(DOWN, buff=0.12)


class Narrated(Scene):
    narration: Narration | None = None

    def setup(self):
        if self.narration is None:
            raise ValueError("Set Narrated.narration = Narration.beside(__file__) in scenes.py")
        self.camera.background_color = BG
        self._t0 = 0.0
        self._dur = 0.0
        self._events = []

    @property
    def now(self) -> float:
        return self.renderer.time

    def say(self, key: str) -> None:
        if self._events and self.now + 1 / config.frame_rate < self._t0 + self._dur:
            raise ValueError("Narration clips overlap; call done() before starting the next clip")
        self._t0 = self.now
        self._dur = self.narration.duration(key)
        self._events.append({
            "key": key, "start": self._t0, "seconds": self._dur,
            "estimated": self.narration.silent,
        })
        if self.narration.has_audio(key):
            self.add_sound(str(self.narration.clip(key)))

    def until(self, frac: float) -> None:
        if not 0 <= frac <= 1:
            raise ValueError("Narration fraction must be between zero and one")
        rest = self._t0 + self._dur * frac - self.now
        if rest > 1 / config.frame_rate:
            self.wait(rest)

    def done(self, pad: float = 0.35) -> None:
        if self.now > self._t0 + self._dur + 2.5:
            warnings.warn("Animation overruns narration by more than 2.5 seconds", stacklevel=2)
        rest = self._t0 + self._dur + pad - self.now
        if rest > 1 / config.frame_rate:
            self.wait(rest)

    def clear_all(self, run_time: float = 0.6) -> None:
        if self.mobjects:
            self.play(FadeOut(Group(*self.mobjects)), run_time=run_time)

    def heading(self, text: str, color=FG) -> Text:
        return T(text, 40, color=color, weight=BOLD).to_edge(UP, buff=0.45)

    def tear_down(self):
        if not self._events:
            raise ValueError("Each Narrated scene must call say() at least once")
        if self.now + 1 / config.frame_rate < self._t0 + self._dur:
            raise ValueError("Scene ends before its narration; call done() before finishing")
        folder = Path(config.media_dir) / "narration"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{type(self).__name__}.json").write_text(
            json.dumps(self._events, indent=2), encoding="utf-8",
        )
        super().tear_down()
