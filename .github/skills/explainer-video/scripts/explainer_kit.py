"""Manim visual helpers and narration-paced scenes, adapted from the personal kit."""

from __future__ import annotations

import json
import sys
import warnings
from pathlib import Path

from manim import *  # noqa: F403

from azure_narration import Narration

BG = "#0e1116"
FG = "#e8e6e3"
DIM = "#7d8590"
FONT = "Inter"
DISPLAY = "Inter"
MONO = "DejaVu Sans Mono"
C1, C2, C3, C4, C5 = BLUE_C, TEAL_C, GREEN_C, YELLOW_C, GOLD_E
C_STORE = PURPLE_B
C_BAD = RED_C
C_FEED = WHITE
ACCENT = TEAL_C

# Vivid palette, available as constants and via use_theme("vivid").
VIVID_PURPLE = "#8661C5"
VIVID_LIGHT_PURPLE = "#C5B4E3"
VIVID_MAGENTA = "#C03BC4"
VIVID_LIGHT_MAGENTA = "#D59ED7"
VIVID_ORANGE = "#FF5C39"
VIVID_GREEN = "#8DE971"
VIVID_YELLOW = "#FFB900"
VIVID_TEAL = "#38B9B6"
VIVID_DEEP_TEAL = "#28647C"
VIVID_LIGHT_BLUE = "#8DC8E8"
VIVID_GREY = "#A19F9D"

THEMES = {
    "default": dict(
        FG=FG, DIM=DIM, FONT=FONT, DISPLAY=DISPLAY, MONO=MONO,
        C1=C1, C2=C2, C3=C3, C4=C4, C5=C5, C_STORE=C_STORE, C_BAD=C_BAD, ACCENT=ACCENT,
    ),
    # Windows 11 system fonts (Segoe UI Variable, Cascadia Mono); elsewhere Pango substitutes a fallback font.
    "vivid": dict(
        FG="#F4F3F5", DIM="#8A8886",
        FONT="Segoe UI Variable Text", DISPLAY="Segoe UI Variable Display", MONO="Cascadia Mono",
        C1=VIVID_LIGHT_BLUE, C2=VIVID_TEAL, C3=VIVID_GREEN, C4=VIVID_YELLOW, C5=VIVID_ORANGE,
        C_STORE=VIVID_PURPLE, C_BAD=VIVID_ORANGE, ACCENT=VIVID_TEAL,
    ),
}


def use_theme(name: str, namespace: dict | None = None) -> None:
    """Switch colors and fonts. Call right after `from explainer_kit import *`, before building mobjects.

    Updates this module and the caller's globals, so names imported with `*` see the new values.
    """
    if name not in THEMES:
        raise ValueError(f"Unknown theme {name!r}; choose from {', '.join(THEMES)}")
    values = THEMES[name]
    globals().update(values)
    target = namespace if namespace is not None else sys._getframe(1).f_globals
    if target is not globals():
        target.update(values)


def T(text: str, size: float = 30, color=None, weight=NORMAL, font: str | None = None, **kw) -> Text:
    return Text(text, font=font or FONT, font_size=size, color=color or FG, weight=weight, **kw)


def M(text: str, size: float = 24, color=None, **kw) -> Text:
    return Text(text, font=MONO, font_size=size, color=color or FG, **kw)


_STRUT = "Hdgjy"


def L(text: str, size: float = 20, color=None, weight=NORMAL, font: str | None = None) -> VGroup:
    """Single-line label with a fixed line box (ascender to descender), so labels with and without
    descenders get the same height and share a baseline when centered in a shape."""
    full = Text(text + _STRUT, font=font or FONT, font_size=size, color=color or FG, weight=weight, disable_ligatures=True)
    n = len(full.submobjects) - len(_STRUT)
    glyphs = VGroup(*full.submobjects[:n])
    ref = VGroup(*full.submobjects[n:])
    x = glyphs.get_center()[0]
    strut = Line([x, ref.get_top()[1], 0], [x, ref.get_bottom()[1], 0], stroke_width=0, stroke_opacity=0)
    return VGroup(glyphs, strut)


def box(color, w: float = 1.2, h: float = 0.5, label: str | None = None, size: float = 20, fill: float = 0.18) -> VGroup:
    rect = RoundedRectangle(corner_radius=0.1, width=w, height=h, stroke_color=color, stroke_width=2.5)
    rect.set_fill(color, opacity=fill)
    group = VGroup(rect)
    if label:
        group.add(L(label, size, color=FG).move_to(rect))
    return group


def lit(node: VGroup, on: bool = True, fill: float = 0.18) -> Animation:
    """Restore stroke and label opacity without turning the fill solid."""
    target = node.copy().set_opacity(1 if on else 0.25)
    target[0].set_fill(opacity=fill if on else fill * 0.3)
    return Transform(node, target)


def chip(text: str, color, size: float = 20) -> VGroup:
    label = L(text, size, color=BG, weight=BOLD)
    background = RoundedRectangle(
        corner_radius=0.08, width=max(label.width + 0.22, 0.42),
        height=label.height + 0.1, stroke_width=0,
    ).set_fill(color, 1)
    return VGroup(background, label.move_to(background))


def database(color=None, w: float = 0.9, h: float = 1.0) -> VGroup:
    color = color or C_STORE
    top = Ellipse(width=w, height=w * 0.32, stroke_color=color, stroke_width=2.5).set_fill(color, 0.35)
    body = Rectangle(width=w, height=h, stroke_width=0).set_fill(color, 0.18)
    body.next_to(top.get_center(), DOWN, buff=0)
    left = Line(top.get_left(), top.get_left() + DOWN * h, color=color, stroke_width=2.5)
    right = Line(top.get_right(), top.get_right() + DOWN * h, color=color, stroke_width=2.5)
    bottom = Arc(radius=1, start_angle=PI, angle=PI, color=color, stroke_width=2.5)
    bottom.stretch_to_fit_width(w).stretch_to_fit_height(w * 0.16)
    bottom.move_to(top.get_center() + DOWN * h, aligned_edge=UP)
    return VGroup(body, top, left, right, bottom)


def device(w: float = 0.8, h: float = 1.3, color=GREY_B, screen=None) -> VGroup:
    screen = screen or C1
    shell = RoundedRectangle(corner_radius=0.14, width=w, height=h, stroke_color=color, stroke_width=2.5)
    shell.set_fill(GREY_E, 0.6)
    display = RoundedRectangle(corner_radius=0.06, width=w * 0.78, height=h * 0.55, stroke_width=0)
    display.set_fill(screen, 0.35).move_to(shell).shift(UP * h * 0.1)
    button = Circle(radius=w * 0.13, stroke_color=color, stroke_width=2)
    button.move_to(shell).shift(DOWN * h * 0.33)
    return VGroup(shell, display, button)


def edge(a: Mobject, b: Mobject, color=GREY_B, opacity: float = 0.55, width: float = 2.0) -> Line:
    return Line(a.get_right(), b.get_left(), color=color, stroke_width=width, stroke_opacity=opacity)


def flow(line: Line, color=None, run_time: float = 0.8, width: float = 6) -> Animation:
    return ShowPassingFlash(
        line.copy().set_stroke(color or C_FEED, width=width, opacity=1),
        time_width=0.45, run_time=run_time,
    )


def stat(big: str, small: str, color=None, size: float = 56) -> VGroup:
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

    chapter: str | None = None

    def heading(self, text: str, color=None, chapter: str | None = None) -> VGroup:
        """Chapter tag above a left-aligned title; animate it with type_in()."""
        title = T(text, 40, color=color, weight=SEMIBOLD, font=DISPLAY)
        label = chapter or self.chapter
        if not label:
            return VGroup(title).to_corner(UL, buff=0.5)
        tag_text = T(label.upper(), 17, color=ACCENT, weight=SEMIBOLD, font=DISPLAY)
        bar = Rectangle(width=0.07, height=tag_text.height * 1.4, stroke_width=0).set_fill(ACCENT, 1)
        tag = VGroup(bar, tag_text).arrange(RIGHT, buff=0.15)
        return VGroup(tag, title).arrange(DOWN, aligned_edge=LEFT, buff=0.16).to_corner(UL, buff=0.45)

    def type_in(self, heading: VGroup, per_char: float = 0.035) -> Animation:
        """Typewriter title with a block cursor; the chapter tag slides in first."""
        title = heading[-1]
        cursor = Rectangle(width=0.05, height=title.height * 1.15, stroke_width=0).set_fill(ACCENT, 1)
        cursor.move_to(title[0]).set_y(title.get_y())
        typing = TypeWithCursor(title, cursor, leave_cursor_on=False, time_per_char=per_char, buff=0.05)
        if len(heading) == 1:
            return typing
        return Succession(FadeIn(heading[0], shift=RIGHT * 0.25, run_time=0.35), typing)

    @staticmethod
    def reveal(mob: Mobject, **kw) -> Animation:
        """Callout entrance: a short fade-up instead of stroke drawing."""
        return FadeIn(mob, shift=UP * 0.18, **kw)

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
