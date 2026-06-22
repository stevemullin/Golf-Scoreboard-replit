# Backlog

Ideas captured for later — not yet scheduled. Each needs a design pass before building.

## Golfer Tiers (needs design)

Picks are made from **5 tiers** built on pre-tournament odds to win.

**Selection rules**
- Pick **one golfer from each tier T1–T5** (5 picks), plus **1 additional golfer from either T4 or T5** (6th pick). Total 6.

**Tier construction**
- Tiers come from pre-tournament **odds to win**, sorted best → worst (T1 = best odds, T5 = worst).
- Split into 5 groups at "clean breaks" — large jumps in the odds. **Fuzzy**, not fixed sizes. Rough guide: T1 ~4–8, T2 ~6–8, T3 ~6–10, T4 ~8–12, T5 = the rest.

**Two parts to build**
1. **Source odds** for the selected tournament from a free API; list players ordered by odds. Admin chooses where each "line" falls between groups (e.g. the T1/T2 line sits between the 5th and 6th player) → builds the five tier lists.
2. **Tiered selection** — the pick UI enforces the rules above (1 per tier + 1 extra from T4/T5).

**Open questions to ideate**
- Which free odds API (coverage for majors + regular events; rate limits).
- When odds are snapshotted (pre-tournament; frozen at pick-lock).
- Admin UI for dragging/setting the split lines.
- Storing tiers per tournament; how this interacts with the existing free-form picks (migration / mode toggle).

_(Reference: the US Open tiers + a sample 6-pick selection were shared as an image on 2026-06-22.)_

## Other parked items
- **Self-service pick entry** + lock deadline — shareable link; participants choose their own 6 instead of the admin entering them.
- **Standings-over-rounds chart** — `recharts` is already a dependency.
