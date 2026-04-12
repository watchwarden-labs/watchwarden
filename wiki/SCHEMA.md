# WatchWarden Wiki — Schema & Operating Instructions

This document defines how this wiki is structured, maintained, and queried. It is the LLM's operating manual for this knowledge base.

---

## Directory Layout

```
wiki/
├── SCHEMA.md          ← this file — LLM operating instructions
├── index.md           ← content catalog, updated on every ingest
├── log.md             ← append-only activity log
├── raw/               ← source documents (immutable — never modify)
│   └── assets/        ← images and binary attachments
└── pages/
    ├── overview.md        ← high-level synthesis of the project
    ├── roadmap.md         ← phase-by-phase roadmap and current status
    ├── architecture/      ← system design, data flow, component boundaries
    ├── features/          ← one page per feature area (13 features)
    ├── decisions/         ← ADRs — why things were built the way they were
    └── components/        ← deep-dives: Controller, Agent, UI
```

---

## Page Format

Every wiki page uses this frontmatter:

```markdown
---
title: <human-readable title>
type: overview | architecture | feature | decision | component | roadmap | query-result
sources: [list of raw/ files or external refs used to write this page]
updated: YYYY-MM-DD
---
```

- **Cross-links**: Use relative markdown links (`[Agent](../components/agent.md)`).
- **Code references**: Use `file:line` notation (e.g. `agent/updater.go:348`).
- **Status callouts**: Use blockquotes for current status notes:
  > **Status**: Fully implemented / Partially implemented / Not implemented

---

## Source Types

When adding to `raw/`, name files descriptively:

| Prefix | Source type | Example |
|--------|-------------|---------|
| `pr-NNN-` | Pull request | `pr-039-expandable-rows.md` |
| `issue-NNN-` | GitHub issue | `issue-042-semver-policy.md` |
| `design-` | Design note / ADR draft | `design-gitops-mode.md` |
| `meeting-YYYY-MM-DD-` | Meeting notes | `meeting-2026-04-12-roadmap.md` |
| `feedback-` | User/operator feedback | `feedback-registry-rate-limits.md` |

---

## Workflows

### Ingest

When asked to ingest a new source:

1. Read the source file in `raw/`.
2. Identify which wiki pages it affects (search `index.md` first).
3. Write or update affected pages in `pages/`:
   - Update the relevant feature page if the source adds implementation detail.
   - Update `roadmap.md` if the source changes phase status.
   - Create a new ADR in `decisions/` if an architecture decision was made.
   - Update `overview.md` if the high-level picture changed.
4. Update `index.md` — add the new source and any new/updated pages.
5. Append an entry to `log.md`:
   ```
   ## [YYYY-MM-DD] ingest | <source title>
   Pages touched: <list>
   Key changes: <1-2 sentences>
   ```

### Query

When asked a question about the project:

1. Read `index.md` to identify relevant pages.
2. Read those pages.
3. Synthesize an answer with citations (link to page sections).
4. If the answer is non-trivial and reusable, offer to file it as a new page in `pages/` (e.g. `pages/query-results/topic.md`).
5. Append to `log.md`:
   ```
   ## [YYYY-MM-DD] query | <question summary>
   Pages read: <list>
   Filed: <new page if any>
   ```

### Lint

When asked to lint the wiki:

1. Check for orphan pages (no inbound links from index or other pages).
2. Check for contradictions between pages.
3. Check for stale status claims (feature marked partial but code shows full).
4. Check for important concepts mentioned but lacking their own page.
5. Suggest new sources to ingest (PRs merged since last ingest, etc.).
6. Append to `log.md`:
   ```
   ## [YYYY-MM-DD] lint
   Issues found: <count>
   Actions taken: <list>
   ```

---

## Feature Page Conventions

Each feature page (`pages/features/feature-N-*.md`) follows this structure:

```markdown
## Status
> **Status**: Fully implemented / Partially implemented / Not implemented

## What's implemented
- Key files with line refs
- Key DB tables/columns

## What's missing
- Specific gaps

## Roadmap
- Link to roadmap phase
- Specific tasks remaining
```

---

## Decision (ADR) Conventions

Each ADR in `pages/decisions/` follows this structure:

```markdown
## Context
What problem was being solved.

## Decision
What was decided.

## Rationale
Why this option was chosen over alternatives.

## Consequences
Trade-offs, known limitations.
```

---

## Index Maintenance

`index.md` has three sections:

1. **Pages** — all wiki pages with one-line summaries, organized by type
2. **Raw Sources** — all files in `raw/` with date ingested
3. **Tags** — cross-cutting topics that link to multiple pages (e.g. `#update-pipeline`, `#security`, `#notifications`)

---

## Out of Scope

Do not write to this wiki:
- Things already in CLAUDE.md (project conventions, commands, env vars).
- Things derivable from the code directly (no paraphrasing function signatures).
- Ephemeral state (current PR in review, current test run status).

The wiki captures **why** and **what was decided** — not **how the code works line by line**.
