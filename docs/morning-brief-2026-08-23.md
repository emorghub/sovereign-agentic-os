# Morning brief — 2026-08-23

Overnight autonomous session. Everything below is **tsc-clean, full-suite green (5493 tests), deployed, and public-synced** unless marked otherwise. The cohort was kept stable throughout.

## TL;DR — what to check first (5 min)
Open the Software tab and **create a fresh app → grant a dataset → open Build**: it should now offer a **"Build from my design"** button and generate tabs (no more empty dead-end). Then spot-check: promote a dataset, build an agent system, upload a CSV (auto-advance), "Suggest quality rules" (cards not prose). All were fixed earlier and should hold.

## Shipped tonight

### 0.6.157 — the overnight hardening bundle
1. **Software Build P0 (your blocker) — FIXED.** Root cause: a real dead-end state (stories + data + a stale default `draftSpec`) fell through all three Build affordances → empty, no button. Now a `build-affordance` helper always resolves to one actionable outcome + a **"Build from my design"** button in both Simple & Developer; the assistant reads work-in-progress apps (`draft → draftSpec → spec`); Define/Design show **green on open** when already satisfied. *(Durability was ruled out — grants/design/spec do survive a pod roll; the dead-end was pure UI gating.)*
2. **Durable platform settings — FIXED.** `settings / security(egress) / tenant / plugins` now persist via the os-mirror + hydrate on boot. **`promoteAsView`, `autonomousAgentsEnabled`, `codedAppsEnabled`, model roles & branding no longer revert on redeploy** — and the audit row is no longer a lie. This is the fragility behind the "flag flipped off after deploy" surprises earlier.
3. **Security H0 (High)** — SQL-injection in the metrics builder closed (metric `column`/`filter.column` now identifier-validated before SQL).
4. **Security H1 (High)** — grant-injection at promotion approval closed (approver's authority over every grant target is now checked; the identical **Files** promotion twin closed too).

### 0.6.156 — Software Design cleanup
Removed the vestigial **Push-to-Jira / Push-code-to-Git / Import-Claude-design** panel (code-app-era; doesn't fit declarative apps).

### Earlier today (context) — 0.6.152 → 0.6.155
Agent-build reach-END fix; autonomous-agents platform gate (OFF by default); agent run-context scoped to grants; DQ rule-cards + auto-advance-on-upload; Software "Reconnect git" heal; the **Agents-tab redesign** (Define·Grant·Design·Build·Run·Evaluate + per-stage assistant + auto-suggest team + View/Edit); query-tool 0.6.2 pinned so promote-as-view stops breaking on helm upgrades.

## Reviews produced (read these)
- **`docs/REVIEW-2026.md`** — consolidated security + maintainability + readability + architecture + design review, with ONE prioritized backlog and a "fixed tonight vs needs-your-decision" split.
- **`docs/design-review-2026-magic-simplicity.md`** — the "more magic & simplicity" vision: control-budget, proactive assistant, "What do you want to build today?" start screen, agentic context librarian, end-to-end flow/hiccup review, and your **assistant-first + Expert-Mode** concept. Verdict: *the OS is architecturally ahead of its surface — the gap is coherence, not capability.*
- The **OS Guide** (`docs/Sovereign-Agentic-OS-Guide.md` + PDF) was **regenerated** from the stale 0.6.31 to 0.6.156.

## ⚠️ Needs YOUR decision (deliberately NOT shipped unattended)
1. **Security H2 (High) — live-deploy infra auth posture.** The public deploy runs `profile:local`, so the runtime bearer is a static well-known token, the service bearer is off, and there's no Ingress NetworkPolicy on query-tool → any in-namespace pod could send `role:admin` to `/execute`. Fixing means a **chart/config change** (self-generate the runtime bearer, enable the service bearer, add the netpol). I did **not** change live auth posture while you slept. Recommend doing this together, carefully, before the next cohort. Details in `docs/code-review-security.md` (H2).
2. **Security H3** — embedded first-party tools run same-origin (`allow-same-origin allow-scripts`); an XSS in an embedded tool acts as the user. Sandbox change needed.
3. **The persistence architecture (MAIN-F2 / ARCH-B1).** F1 fixed the *settings* revert (quick win). The deeper issue — every tab store is an authoritative in-memory Map with a best-effort mirror, which forces `replicas: 1` and a write-loss window — needs a **durable-registry (Postgres-authoritative) migration** to scale out. That's an architectural bet, not an overnight fix.
4. **The big UX bets** (design doc): assistant-first + Expert-Mode toggle, the start screen, the control-budget pass, unifying the 3 promote code-paths. High impact, but they reshape live tabs — worth piloting on one tab with your sign-off.
5. **`promoteAsView`** is now durable — decide whether to turn it **ON** for the next cohort (it deletes the whole zombie/collision class; verified live earlier).
6. **Finish the Cube drop** and gate Dagster (architecture review) — sequencing calls.

## Deploy + publish state
- Live: **os-ui 0.6.157**, query-tool **0.6.2** (chart-pinned).
- Public repo `Data-Masterclass/sovereign-agentic-os` synced through this wave (tree-identical, no secrets).
- The **55 one-off `deploy-06XX.sh` scripts** are real tech-debt (maintainability review F5) — worth collapsing to one parameterized `deploy.sh` with a deterministic rollout-restart. Left as-is tonight (didn't want to change the deploy path unattended).

## Nothing is on fire
No crashlooping new pods; the pre-existing broken workloads (mail, opensearch-snapshot, sample-sklearn, wireguard, forgejo-disk-alert) are unchanged and unrelated.
