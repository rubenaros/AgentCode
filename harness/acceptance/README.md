# Immutable acceptance suite

The arbiter for the Pi control run of the "modelos locales agénticos" arc.

## Why this exists

The v4 run produced a **green but off-spec** implementation. Reading
`ornith_agent_v4.py:522` explains how:

```
# FREEZE tests during VERIFY
```

The freeze only applied during the VERIFY phase. During IMPLEMENT the agent
authored its own test files — `tests/engine.stats.test.ts`,
`tests/engine.stats.edge.test.ts`, `tests/stats.e2e.test.ts` — and the harness
then told it *"the tests are FROZEN and CORRECT, fix the code"*.

So the agent froze **its own interpretation of the spec** and then defended it.
It never lied and never gamed a test; it graded its own exam. The concrete
result: `occupancyRate` divides by the working minutes of days *with*
appointments instead of days *in range*, which the implementation even
documents in `src/engine/stats.ts:34`:

```ts
// Occupancy: only count days that actually have appointments in the range
```

whereas the spec (task line 14 and `src/domain/types.ts:90`) says the
denominator is the working minutes **of the range**.

This suite closes that hole. It is authored by the operator before the run,
lives outside the work tree, and is injected only at judgment time. The agent
never sees it, cannot read it, and cannot edit it.

## Contents

| File | Role |
|---|---|
| `stats-engine.acceptance.test.ts` | Numeric semantics of `StatsEngine` — the contract that matters |
| `stats-api.acceptance.test.ts` | Shape of `GET /api/stats`; kept separate so an import failure here cannot void the engine verdict |
| `vitest.acceptance.config.ts` | Mirrors the project vitest config and adds the `@/* -> ./src/*` alias |

Run it with `harness/run-acceptance.sh [WORKDIR]`. The script injects, runs,
and removes every file, leaving no trace in the tree.

## Fairness decisions

The spec leaves several points open. Every fixture is built so that all
plausible readings yield the same expected value — a failure is therefore a
real deviation, never a coin flip:

1. **"days in range"** — all ranges are midnight-aligned UTC, so the day count
   is unambiguous however partial days are bucketed.
2. **weekends** — occupancy fixtures use Mon–Wed ranges only, since the spec
   never mentions excluding weekends.
3. **"durationMin"** — each appointment's `end - start` equals its service's
   `durationMin`, so both readings agree.
4. **"bookings" / "visits"** — each tops fixture uses a single status, so
   counting by strict status or by any-non-cancelled gives the same result.
5. **zero-count entities** — the spec caps each top list at 5 but never says
   whether inactive entities are padded in; assertions compare only scoring
   entries.

Two harness gaps were found and fixed while calibrating, and both would
otherwise have been misread as implementation defects:

- The baseline `vitest.config.ts` declares no path aliases, so `@/engine/stats`
  failed to resolve even though `next build` honours it. Hence
  `vitest.acceptance.config.ts`.
- The API handler reads `request.nextUrl.searchParams`, which a plain `Request`
  does not carry. The suite drives it with a `NextRequest`, which extends
  `Request` and therefore satisfies both the Next idiom and the plain-`Request`
  idiom.

## Calibration

Validated against the v4 output before resetting the work tree:

```
Tests  2 failed | 21 passed (23)
```

The 21 passes confirm the suite is not vacuous. The 2 failures are both the
occupancy deviation, at exactly the predicted values:

| Fixture | Spec | v4 implementation |
|---|---|---|
| 1×60 min over a 3-day range | `60/1620 = 0.0370` | `60/540 = 0.1111` |
| 540+60 min over a 3-day range | `600/1620 = 0.3704` | `600/1080 = 0.5556` |

A well-calibrated arbiter: it passes everything the agent got right and fails
precisely on the one thing it got wrong.

## Protocol for the control run

1. Reset the work tree to a pristine baseline.
2. Run the agent under Pi. It writes whatever tests it wants — they are its
   own scaffolding, not the verdict.
3. Run `harness/run-acceptance.sh`. That, and only that, is the verdict.

The question being tested: with acceptance the model cannot author, does it
converge on the **true** spec — or is spec comprehension a floor no harness
crosses?
