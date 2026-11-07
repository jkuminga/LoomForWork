---
name: mvp-to-prd
description: "Convert a user-specified MVP Markdown document into a source-traceable PRD while preserving the MVP release scope. Use when the user asks to turn an existing MVP plan into a PRD."
metadata:
  upstream_source: "https://github.com/nurettincoban/ai-prd-workflow/tree/b67f4d3e1161dcf10ac6d8d0e31ca22015474de0/skills/create-prd"
  upstream_version: "3.0.0"
---

Turn the user's existing MVP (minimum viable product) Markdown document into a PRD
(product requirements document) for the same initial release. Treat the MVP's stated
capabilities, exclusions, constraints, and decisions as the source of truth. Make
requirements clearer and traceable without adding product scope. This skill creates
one PRD; it does not create Features or WorkItems.

## CLASSIFY THE PRODUCT TYPE

Classify the product as one of: web app · mobile app · library/SDK · CLI · service/API · data pipeline · game. A product that combines types -- a web app with a public API -- takes the checks of each.

Then apply only the checks that fit. What each type needs probed, and what usually does not apply:

| Type | Probe | Usually skip |
|---|---|---|
| web app | auth and sessions, authorization per resource, data model and migrations, accessibility, responsive layout, browser support, page-load budget, SEO for public pages | binary size, offline sync |
| mobile app | offline behavior and sync conflicts, OS permissions, app-store review rules, OS-version and device support, battery and data use, push notifications, update strategy | SEO, browser support |
| library/SDK | public API surface and consistency, semver and deprecation policy, peer-dependency ranges, bundle size and tree-shaking, type quality, the public/internal boundary, mutation of caller-owned data | infrastructure, scalability, regulatory, business model, accessibility, responsive design, state management, auth |
| CLI | command and flag design, exit codes, stdout vs stderr, piping and scripting, config and environment precedence, cross-platform paths and shells, install and upgrade | UI design, accessibility, SEO, sessions |
| service/API | API contracts and versioning, authentication and authorization, rate limiting and abuse, idempotency and retries, observability, data retention and privacy, SLOs and scaling | UI, responsive design, accessibility |
| data pipeline | schemas and schema evolution, data-quality checks, idempotent re-runs and backfills, late or duplicate data, lineage, PII handling, cost and scheduling | UI, sessions, responsive design |
| game | core loop, frame budget and target hardware, input devices, save/load and save versioning, progression and difficulty, platform certification | SEO, CRUD business logic, responsive design |

Record the result in the PRD as a **Product Type** section: the type, and each
skipped check with a one-line reason. Use these checks to identify relevant gaps,
not to turn every checklist item into a new MVP requirement. Skipping must be
visible rather than silently claiming an irrelevant risk was verified.

## PRD Sections to Include

Use the following structure where the MVP provides support. Put consequential
missing details in **Open Questions/Assumptions** rather than filling them in:

- **Overview** - A concise summary of the product, its purpose, and its value proposition
- **Product Type** - The classification and the checks that do not apply, as described above
- **Goals and Objectives** - The MVP's stated goals; preserve qualitative goals if no metric is given
- **Scope** - What's included and explicitly what's excluded from the initial release
- **User Personas or Target Audience** - Detailed descriptions of the intended users
- **Functional Requirements** - MVP capabilities, each with a stable ID (`FR-1`, `FR-2`, ...) and an MVP source heading path
- **Non-Functional Requirements** - Stated quality attributes and constraints, each with a stable ID (`NFR-1`, `NFR-2`, ...) and an MVP source heading path. Add new IDs on revision; never renumber existing ones
- **User Journeys** - Key workflows supported by the MVP document
- **Success Metrics** - Stated measures of success; note missing measures as open questions
- **Timeline** - Include only when the MVP specifies milestones or dates
- **Decisions** - Choices already made in the MVP, with reasons when documented
- **Open Questions/Assumptions** - Areas that need further clarification or investigation

## MVP intake and transformation

1. Read the MVP Markdown file the user named. If no path was given, locate a
   clearly identified MVP document in the repository; ask for the path if there
   are several plausible sources or none. Read referenced material only when it
   is necessary to interpret the MVP. Keep the original file intact.
2. Map the document before drafting: included capabilities and user flows,
   explicit exclusions and future ideas, stated quality constraints, decisions,
   and unresolved questions. Classify the product type from this evidence.
3. Turn supported capabilities into `FR` entries and stated constraints into
   `NFR` entries. For each entry, write `Source: <MVP heading path>`; add a line
   reference only when headings repeat. Preserve exclusions under **Scope / Out
   of Scope**, including features explicitly deferred beyond the MVP.
4. If an ambiguity would change what ships in the initial release, ask one
   focused question before committing to either interpretation. Record other
   unknowns as open questions or clearly marked assumptions; do not turn them
   into asserted requirements, numbers, dates, or technical choices.
5. Check coverage in both directions: every MVP capability and constraint has
   a corresponding PRD entry or an explicit scope note; every PRD requirement
   points back to supporting MVP text. Revisions keep existing `FR`/`NFR` IDs
   attached to the same meaning.

## Final PRD Delivery

Save the PRD at `docs/prd/<base>.prd.md` unless the user specifies another
destination. For an MVP filename ending in `.mvp.md`, remove that entire
suffix to get `<base>`: `example2.mvp.md` becomes
`docs/prd/example2.prd.md`. For other Markdown filenames, remove only the
final `.md`. This path identifies the source without overwriting the MVP. If
a PRD already exists at that path, revise it while preserving stable
requirement IDs and reviewing the diff.

At the top, name the source MVP path and state that the PRD covers its initial
release. Report the PRD path, any release-scope questions, and the source
sections that could not yet be translated. Report the explicit PRD and source
MVP paths for the subsequent `verify-prd` step; that skill requires the user
to specify the MVP document.

Completion means the PRD exists, the source MVP is intact, the `FR`/`NFR`
entries are traceable, and the coverage check has no unexplained gaps.
