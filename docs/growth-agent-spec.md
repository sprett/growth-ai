# Growth Agent — Autonomous A/B Testing Loop

**One-liner:** You describe a UI experiment in plain language. The agent writes the code, opens the PR, sets up the real A/B test in PostHog, monitors results, learns which elements actually won, and opens the *next* PR itself — synthesizing a new hypothesis instead of just declaring a winner.

**Theme fit:** perceive (monitor experiment results) → plan (synthesize next hypothesis) → act (generate diff, open PR) → observe (new results) → repeat. Each loop's output changes the next loop's behavior — that's the whole bar for "agentic looping," and it holds regardless of what orchestrates the steps. No agent framework required — see Section 3.

---

## 1. Goals for this build

- A working end-to-end loop, demoed live, that a judge can watch run at least twice (first cycle: naive test; second cycle: informed by cycle 1's learnings).
- At least one **real, verifiable artifact per cycle**: a real PostHog feature flag created via API, a real GitHub PR opened via API.
- A live-updating visual (graph or dashboard) showing what the agent has learned so far, growing across cycles.

## 2. Explicit non-goals (say no to these for the 8-hour version)

- No real user traffic. Traffic is simulated — say so plainly in the demo, don't hide it.
- No statistical significance testing (t-tests, confidence intervals). Simple metric comparison per element is enough.
- No support for arbitrary websites — the "target" is a small demo site you control, living in its own separate repo (see Section 4).
- No auto-merge. A human merges each PR (keeps the demo safe and gives a natural pause point to narrate).
- No general-purpose code generation — scope the tunable dimensions in advance (copy, color, placement of 1–2 specific elements) so diff generation is fast and reliable.
- Only one real tenant — but resolved through the actual `connections` table lookup (Section 5), seeded with a single row, not hardcoded as constants in the pipeline. Real self-serve onboarding (a UI for a *new* tenant to add their own row) is out of scope for the build — see Section 11.

## 3. Architecture overview

```
 YOU: "try the CTA in the header instead of the sidebar"
         │
         ▼
 ┌──────────────────┐
 │  PARSE REQUEST     │  LLM turns plain language into a structured
 │                    │  spec: {element, dimension, variant_value}
 └─────────┬──────────┘
           ▼
 ┌──────────────────┐
 │  GENERATE DIFF     │  LLM writes the code change for variant B
 └─────────┬──────────┘
           ▼
 ┌──────────────────┐
 │  OPEN PR           │  real GitHub API — you review & merge
 └─────────┬──────────┘
           ▼        (on merge webhook)
 ┌──────────────────┐
 │  CREATE FLAG       │  real PostHog API — multivariate feature flag
 └─────────┬──────────┘
           ▼
 ┌──────────────────┐
 │  SIMULATE TRAFFIC  │  synthetic events fired at high frequency,
 │                    │  standing in for "days" of real visits
 └─────────┬──────────┘
           ▼   (on your set interval)
 ┌──────────────────┐
 │  ANALYZE RESULTS   │  pull events per variant, per ELEMENT (not
 │                    │  just overall conversion)
 └─────────┬──────────┘
           ▼
 ┌──────────────────┐
 │  UPDATE PLAYBOOK   │  store: "this element/value combo won in this
 │                    │  context" → node/edge in the learnings graph
 └─────────┬──────────┘
           ▼
 ┌──────────────────┐
 │  SYNTHESIZE NEXT    │  combine winning sub-elements across past
 │  HYPOTHESIS         │  cycles into a new variant proposal
 └─────────┬──────────┘
           │
           └──── loops back to GENERATE DIFF
```

**No agent framework needed.** The pipeline above has no real branching — it's a straight sequence of steps, kicked off by one of two triggers: a GitHub merge webhook, or your monitoring-interval timer firing. A plain function per step, with a row in the `experiments` table tracking "which step are we on," gets you the exact same behavior as a graph framework would, with less to learn or debug under time pressure. What makes this agentic isn't the plumbing — it's that the "synthesize next hypothesis" step does real reasoning over accumulated state, and that reasoning changes what happens next. Keep that step doing genuine work and the rest can be as boring as you like.

There's still one real graph in this project, and it's the important one for the demo:
- **The playbook** is a simple knowledge graph (Postgres/Supabase rows) — nodes are "element + value that won," edges are "similar context to" or "combined into." This is what visibly grows on screen, and it's just data — no framework involved.

**Every step above resolves its GitHub and PostHog credentials by looking up the active tenant's row in `connections` (Section 5) — never a constant baked into the code.** For the demo there's exactly one row, pointing at a separate fake-customer repo (Section 4), but the pipeline itself can't tell the difference between that and a real signup. That's the whole point: nothing changes when a second real tenant shows up later.

## 4. Components & ownership

| Component | Owner | Notes |
|---|---|---|
| Fake-customer repo (2–3 tunable elements) | Frontend | **Separate repo from the pipeline itself** — its own GitHub App installation, its own PostHog project. Simple landing page: CTA button (copy/color/placement), maybe a headline variant. Stands in for a real external customer so nothing in the pipeline gets to assume "us" |
| Synthetic traffic simulator | Backend | A script firing `$feature_flag_called` + custom click events at a fast interval |
| PostHog integration | Backend | `POST /api/projects/{id}/feature_flags/` to create the flag; events API to pull results |
| GitHub integration | Backend (reuse relay's Octokit/GitHub App code) | Open PR with generated diff, webhook on merge |
| Orchestration pipeline | Backend | Plain functions per step, triggered by the merge webhook and the monitoring-interval timer; state (cycle count, current hypothesis) lives in the `experiments` row |
| Playbook storage | Backend | Supabase (Postgres + pgvector if you want similarity matching between contexts) |
| Live learnings graph UI | Frontend | vis-network or Cytoscape.js, fed via Supabase Realtime or a WebSocket |
| PR diff viewer | Frontend | Show the actual generated code diff live — this is a big "it's real" moment |
| Metrics/cycle dashboard | Frontend | Cycle number, per-element win rates, "synthesizing next hypothesis..." status |

## 5. Data model (Supabase / Postgres)

**Every table below gets an `org_id` column, with Supabase Row-Level Security policies enforcing that a tenant can only ever query its own rows.** Don't rely on application-level filtering alone for this.

**Data minimization rule: no personal or user-level data is ever persisted here.** `events` stores aggregate counts, never per-user rows; `playbook_nodes` stores abstracted lessons (element/value/win-rate), never anything identifying an end user. Raw responses from a customer's own PostHog project are used transiently during the analysis step and discarded — only the distilled conclusion gets written.

```sql
connections (
  id, org_id,
  github_installation_id, github_repo_full_name,
  posthog_api_key, posthog_project_id, posthog_host   -- e.g. us.posthog.com
)

experiments (
  id, org_id, prompt_text, created_at, status
)

variants (
  id, experiment_id, label,        -- 'control' | 'variant_b' | ...
  element, dimension, value,       -- e.g. 'cta_button', 'placement', 'header'
  posthog_flag_key, pr_url
)

events (
  id, variant_id, event_type,      -- 'view' | 'click_element_x' | 'convert'
  count, recorded_at               -- aggregate counts only, never per-user rows
)

playbook_nodes (
  id, org_id, element, dimension, value, context_tag, win_rate, created_at
)

playbook_edges (
  id, from_node_id, to_node_id, relation   -- 'combined_into' | 'similar_context'
)
```

For the hackathon, `connections` has exactly one row — pointing at the fake-customer repo and its own PostHog project. You insert it by hand once during setup; nothing in the pipeline code should ever reference a repo name or API key directly.

## 6. Integration notes

- **PostHog**: look up the API key, project ID, and host from the tenant's `connections` row (for the demo, the fake-customer repo's own PostHog project — not the team's). `POST /api/projects/{project_id}/feature_flags/` to create a multivariate flag with variant keys matching your `variants` table. Capture events via the standard event endpoint with `$feature_flag` / `$feature_flag_response` properties so you can slice by variant. Don't rely on PostHog's built-in "Experiment" object or its significance engine — do your own simple per-element comparison off the raw events; it's faster to build and you control the logic that feeds the playbook.
- **GitHub**: reuse the GitHub App + Octokit setup from relay, but install it on the fake-customer repo, not your own — resolve `github_installation_id` and `github_repo_full_name` from `connections`, never a constant. Scope the diff generation to the 2–3 known tunable elements so the LLM's code-gen is narrow and reliable, not open-ended.
- **Orchestration**: no framework needed. Each step is a plain function; the `experiments` row carries `cycle_number`, `active_hypothesis`, and `status` so any step can pick up where the last one left off. Pass relevant playbook nodes into the "synthesize next hypothesis" step explicitly so it reasons over real prior learnings, not just the current cycle's data.

## 7. Build order (8 hours, 2 engineers)

**Before the clock starts, if your hackathon's rules allow account/repo setup ahead of time:** create the fake-customer repo, install the GitHub App on it, spin up a separate PostHog project for it, and hand-insert the one `connections` row. If pre-work isn't allowed, this is the first 30 minutes of hour one instead.

| Time | Backend | Frontend |
|---|---|---|
| 0–1h | Scaffold pipeline steps (stub logic) reading from `connections`; Supabase schema | Scaffold fake-customer repo with 2–3 tunable elements |
| 1–3h | PostHog flag creation + event capture working end-to-end (against the fake-customer project) | GitHub PR diff viewer + basic dashboard shell |
| 3–5h | GitHub PR generation + merge webhook → flag creation trigger (against the fake-customer repo) | Synthetic traffic control panel; live metrics view |
| 5–6.5h | Analyze-results node + playbook write logic | Live learnings graph (vis-network/Cytoscape) wired to Supabase Realtime |
| 6.5–7.5h | Synthesize-next-hypothesis step; second full loop working | Polish: cycle counter, status labels, styling pass |
| 7.5–8h | Joint: dry-run the full demo twice, fix the obvious break | Joint: same |

## 8. Demo script (~3 minutes)

1. Type the prompt live: "try the CTA in the header instead of the sidebar."
2. Show the generated diff → open the real PR → merge it on screen.
3. Show the real PostHog flag getting created (switch to the PostHog dashboard for 2 seconds — this is your "it's not fake" beat).
4. Kick off the traffic simulator, sped up — narrate "compressing what would be a week into the next minute."
5. Results come in; the playbook graph gets its first nodes.
6. Trigger cycle 2: the agent proposes a *combined* hypothesis on its own, opens PR #2 without you typing anything.
7. Close on the growing graph + the "cycle 2 informed by cycle 1" framing — that's the whole pitch delivered visually.

## 9. Known risks & mitigations

- **LLM-generated diffs sometimes don't apply cleanly** → constrain the toy app's tunable elements to isolated, clearly-marked code regions (e.g. named constants/props) so the diff surface is small and predictable.
- **Live PostHog dependency during the demo** → have a cached/replay fallback of a previous successful run ready in case of network issues on stage.
- **Time overrun on the graph UI** → vis-network with default force layout is the fallback if Cytoscape configuration eats too much time.

## 10. Stretch goals (only if core loop is solid with time to spare)

- Similarity matching (pgvector) so a new experiment's context can pull relevant learnings from a *different* past experiment, not just its own history.
- A small static diagram of the pipeline itself (like the one in Section 3) shown alongside the playbook graph — "the steps it follows" vs. "what it's learned."

## 11. Beyond the hackathon: real self-serve onboarding

Not part of the 8-hour build — for reference if this continues past the demo.

The `connections` table and the tenant-lookup pattern are already built (Section 5) — that was the whole point of standing up a separate fake-customer repo instead of hardcoding your own. What's still missing for a real product is *self-serve onboarding*: a UI where a new customer creates their own row instead of you inserting it by hand.

- **GitHub**: already solved by the GitHub App model (reused from relay) — a customer installs the app on their own repo through GitHub's normal install flow, which gives you an installation ID to store. No new architecture needed, just a "Connect GitHub" button that kicks off that flow.
- **PostHog**: two options, increasing in effort —
  1. **Personal API key paste-in.** User creates a personal API key in their own PostHog account settings and enters it, their project ID, and their region/host (US cloud, EU cloud, or self-hosted) into an onboarding form. Simple, standard pattern, no approval process.
  2. **Real OAuth.** PostHog supports OAuth 2.0 via a Client ID Metadata Document — you host a small JSON file describing your app on a domain you control, and PostHog fetches it during the authorization flow. No pre-registration or approval needed from PostHog to get started, which makes a proper "Connect your PostHog account" button realistic without waiting on anyone.

Either path just writes a new row to `connections` — the pipeline itself doesn't change at all.

### Privacy and multi-tenant data handling

Two separate rules, not one:

- **Tenant isolation**: every table carries `org_id`, enforced with Supabase Row-Level Security policies — don't rely on application code alone to filter correctly.
- **Data minimization**: never copy a customer's raw, user-level analytics data (anything tied to a real visitor/distinct_id) into your own database. Query their PostHog live for aggregate counts per analysis cycle, compute the comparison, and persist only the distilled conclusion (element, value, win rate, context). The raw API response is used transiently and discarded — this keeps you out of the business of processing someone else's customers' personal data.
- **Cross-org learnings are a separate, deliberate feature, not a side effect.** A playbook that generalizes across customers ("this pattern wins broadly, not just for one org") is genuinely valuable, but it must be built as explicit, anonymized, opt-in aggregation — never as an accidental join across tenants "for convenience."
