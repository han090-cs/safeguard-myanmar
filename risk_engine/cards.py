"""Informational cards (I02–I10). Calendar/location/event based education — never risk signals, never on the
'What Matters Today' list, never raise severity. I01 and I11 are attachments handled by R01."""
from __future__ import annotations

from datetime import timedelta

from .rules import RuleContext
from .schemas import Card, RuleEvaluation


def evaluate_cards(ctx: RuleContext) -> tuple[list[Card], list[RuleEvaluation]]:
    kb, cards, evals = ctx.kb, [], []
    month = ctx.today.month
    horizon = {ctx.today + timedelta(days=i) for i in range(ctx.horizon_days)}

    def add(cid: str, ok: bool, reason: str = "") -> None:
        cfg = kb.card_config(cid)
        if not cfg.get("enabled"):
            evals.append(RuleEvaluation(rule_id=cid, status="disabled"))
        elif ctx.require_approved and cfg.get("review_status") != "approved":
            evals.append(RuleEvaluation(rule_id=cid, status="not_approved", reason="production mode requires review_status=approved"))
        elif ok:
            cards.append(kb.card(cid))
            evals.append(RuleEvaluation(rule_id=cid, status="triggered", reason=reason))
        else:
            evals.append(RuleEvaluation(rule_id=cid, status="not_triggered" if reason == "" else "not_applicable", reason=reason))

    def region_gate(cid: str) -> tuple[bool, str]:
        cfg = kb.card_config(cid)
        if ctx.region is None:
            return False, "region not supplied"
        return kb.region_in_set(ctx.region, cfg["region_set"]), ""

    # calendar cards
    add("I02", month in kb.card_config("I02")["months"])
    ok, why = region_gate("I03")
    add("I03", ok and month in kb.card_config("I03")["months"], why)
    ok, why = region_gate("I04")
    add("I04", ok and month in kb.card_config("I04")["months"], why)
    add("I05", month in kb.card_config("I05")["months"])

    # event / hazard cards
    ok, why = region_gate("I06")
    if kb.threshold("cold_spell_tmin_c").get("value") is None:
        evals.append(RuleEvaluation(rule_id="I06", status="insufficient_data", reason="cold-spell threshold not configured"))
    else:
        add("I06", ok and bool(ctx.hz.cold_days & horizon), why)

    lb7 = kb.card_config("I07")["lookback_days"]
    add("I07", bool(ctx.hz.flood_within(ctx.today - timedelta(days=lb7), ctx.today)) or bool(ctx.hz.official_flood))
    add("I08", ctx.hz.low_visibility_next24h)
    ok, why = region_gate("I09")
    add("I09", ok and bool((ctx.hz.heavy_rain_days | ctx.hz.flood_days) & horizon), why)
    lb10 = kb.card_config("I10")["lookback_days"]
    add("I10", bool(ctx.hz.flood_within(ctx.today - timedelta(days=lb10), ctx.today)) or bool(ctx.hz.official_flood or ctx.hz.official_storm))
    return cards, evals
