"""A complete educational banking explainer. All accounts and amounts are fictional."""

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE if (HERE / "explainer_kit.py").is_file() else HERE.parent.parent / "scripts"
sys.path.insert(0, str(KIT))

from explainer_kit import *  # noqa: E402,F403

Narrated.narration = Narration.beside(__file__)
ORDER = ["S1UncertainOutcome", "S2AtomicTransfer", "S3SafeRetry", "S4Boundaries"]


class S1UncertainOutcome(Narrated):
    chapter = "The problem"

    def construct(self):
        self.say("intro")
        title = self.heading("One transfer. Safe retries.")
        source = box(C1, w=3, h=1.2, label="Source: $500", size=26).shift(LEFT * 4)
        bank = box(C_STORE, w=2.3, h=1.2, label="Bank ledger", size=24)
        destination = box(C3, w=3, h=1.2, label="Destination: $200", size=24).shift(RIGHT * 4)
        left = edge(source, bank)
        right = edge(bank, destination)
        caption = T("Fictional USD transfer within one bank", 24, color=DIM).shift(DOWN * 2.3)
        self.play(self.type_in(title))
        self.play(FadeIn(source, bank, destination), Create(left), Create(right))
        self.play(FadeIn(caption))
        self.until(0.5)
        payment = chip("$100", C2).move_to(source).shift(UP * 1.2)
        self.play(FadeIn(payment))
        self.play(payment.animate.move_to(bank.get_center() + UP * 1.2), run_time=1.4)
        self.play(flow(right, C3), payment.animate.move_to(destination.get_center() + UP * 1.2), run_time=1.4)
        self.done()
        self.clear_all()

        self.say("lost_response")
        title = self.heading("Timeout does not mean failure")
        app = box(C1, w=3, h=1.2, label="Customer app", size=26).shift(LEFT * 3.8)
        bank = box(C_STORE, w=3, h=1.2, label="Bank: committed", size=24).shift(RIGHT * 3.8)
        wire = edge(app, bank)
        self.play(self.type_in(title))
        self.play(FadeIn(app, bank), Create(wire))
        self.until(0.35)
        reply = chip("Success", C3).move_to(bank).shift(UP * 1.1)
        self.play(FadeIn(reply))
        self.play(reply.animate.move_to(UP * 1.1), run_time=1.3)
        failure = Cross(Square(0.65).move_to(reply), stroke_color=C_BAD)
        self.play(Create(failure), FadeOut(reply))
        question = T("Failed transfer  OR  lost reply?", 30, color=C4).shift(DOWN * 1.7)
        self.play(Write(question))
        self.done()
        self.clear_all()


class S2AtomicTransfer(Narrated):
    chapter = "Atomic posting"

    def construct(self):
        self.say("same_key")
        title = self.heading("Same instruction, same key")
        request = box(C1, w=5.7, h=1.2, label="Source -> destination | USD 100", size=25)
        key = chip("transfer-demo-001", C2, size=26).shift(DOWN * 1.3)
        scope = T("Key scope: authenticated caller + operation", 25, color=DIM).shift(DOWN * 2.3)
        self.play(self.type_in(title))
        self.play(FadeIn(request))
        self.until(0.3)
        self.play(FadeIn(key))
        self.until(0.65)
        self.play(Write(scope))
        self.done()
        self.clear_all()

        self.say("atomic_posting")
        title = self.heading("One atomic database transaction")
        validation = T("Authorization + funds + concurrency control", 25, color=C4).shift(UP * 2)
        boundary = RoundedRectangle(width=11.8, height=2.9, corner_radius=0.15, color=C_STORE).shift(DOWN * 0.3)
        rows = VGroup(
            T("Debit source deposit liability: $100", 27, color=C1),
            T("Credit destination deposit liability: $100", 27, color=C3),
            T("Save key + matching request + completed result", 25, color=C2),
        ).arrange(DOWN, buff=0.4).move_to(boundary)
        commit = T("COMMIT ALL  /  ROLL BACK ALL", 28, color=C4).shift(DOWN * 2.5)
        self.play(self.type_in(title))
        self.play(Write(validation))
        self.play(Create(boundary))
        for row in rows:
            self.play(FadeIn(row), run_time=0.65)
        self.until(0.7)
        self.play(Write(commit))
        self.done()
        self.clear_all()

        self.say("balances")
        title = self.heading("Balanced entries, conserved total")
        source = stat("$500", "Source customer balance", C1).shift(LEFT * 3.2)
        destination = stat("$200", "Destination customer balance", C3).shift(RIGHT * 3.2)
        total = T("Combined balance: $700", 30, color=C4).shift(DOWN * 2)
        self.play(self.type_in(title))
        self.play(FadeIn(source, destination), Write(total))
        self.until(0.25)
        self.play(Transform(source[0], T("$400", 56, color=C1, weight=BOLD).move_to(source[0])))
        self.until(0.4)
        self.play(Transform(destination[0], T("$300", 56, color=C3, weight=BOLD).move_to(destination[0])))
        self.done()
        self.clear_all()


class S3SafeRetry(Narrated):
    chapter = "Safe retry"

    def construct(self):
        self.say("safe_retry")
        title = self.heading("Retry returns the saved result")
        request = box(C1, w=3.3, h=1.1, label="Same key + details", size=24).shift(LEFT * 4)
        saved = box(C_STORE, w=3.1, h=1.1, label="Recorded result", size=24)
        result = box(C3, w=3, h=1.1, label="Return success", size=24).shift(RIGHT * 4)
        first = edge(request, saved)
        second = edge(saved, result)
        self.play(self.type_in(title))
        self.play(FadeIn(request, saved, result), Create(first), Create(second))
        self.until(0.3)
        self.play(flow(first, C2), run_time=1.3)
        self.until(0.55)
        self.play(flow(second, C3), run_time=1.3)
        once = T("Ledger posting count: 1", 36, color=C4).shift(DOWN * 1.7)
        balances = T("Source $400   |   Destination $300", 28, color=DIM).shift(DOWN * 2.5)
        self.play(Write(once), Write(balances))
        self.done()
        self.clear_all()


class S4Boundaries(Narrated):
    chapter = "Guarantees"

    def construct(self):
        self.say("boundaries")
        title = self.heading("What makes the guarantee hold?")
        rules = VGroup(
            T("Coordinate concurrent duplicates", 30, color=C2),
            T("Reject the same key with changed details", 30, color=C_BAD),
            T("Retain the result for the allowed retry window", 28, color=C4),
        ).arrange(DOWN, buff=0.65)
        self.play(self.type_in(title))
        self.play(FadeIn(rules[0]))
        self.until(0.35)
        self.play(FadeIn(rules[1]))
        self.until(0.65)
        self.play(FadeIn(rules[2]))
        self.done()
        self.clear_all()

        self.say("takeaway")
        title = self.heading("Atomic effects. Safe retries.")
        scope = T("Internal transfer != interbank settlement", 29, color=C4).shift(UP * 0.7)
        controls = T("Fraud controls | Reconciliation | Audit | Recovery", 25, color=DIM).shift(DOWN * 0.6)
        footer = T("Educational model - fictional data", 23, color=DIM).shift(DOWN * 2.5)
        self.play(self.type_in(title))
        self.until(0.3)
        self.play(Write(scope))
        self.until(0.65)
        self.play(FadeIn(controls, footer))
        self.done()
        self.clear_all()
