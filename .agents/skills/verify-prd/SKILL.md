---
name: verify-prd
description: "Verify an MVP-derived PRD against a user-specified source MVP document, correct grounded gaps and contradictions, and record unresolved findings. Use when the user asks to review the PRD before extracting Features."
metadata:
  upstream_source: "https://github.com/nurettincoban/ai-prd-workflow/tree/b67f4d3e1161dcf10ac6d8d0e31ca22015474de0/skills/verify-prd"
  upstream_version: "3.0.0"
---

Review a PRD (product requirements document) created from an MVP (minimum viable
product) Markdown document. The source MVP defines the initial release scope.
Improve the PRD's accuracy, clarity, and traceability without silently adding
capabilities or treating missing optional details as decided requirements.

Use the PRD path supplied by the user or `mvp-to-prd` (for example,
`docs/prd/sample.prd.md` for `sample.mvp.md`). If no path is supplied,
use the sole clearly matching PRD in the repository; ask for a path when
several qualify.
Require the user to specify the source MVP document. If the user has not
provided its path, ask for that path and wait before reviewing the PRD or
searching local files for an MVP. Do not treat a path in the PRD's `Source` or
`원본` field as the user's selection. Once supplied, read that MVP, compare its
path with the PRD's source field, and correct a mismatch in the PRD. Preserve
the MVP file.

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

Check the PRD's **Product Type** section against the MVP. Apply only relevant
checks, noting why others do not apply. A checklist item is a prompt to inspect
the source or flag a gap, not a reason to invent a new MVP requirement.

## STEP 0: GROUND THE PRD IN ITS SOURCE

Before the gap analysis:

- Map every `FR` (functional requirement) and `NFR` (non-functional requirement)
  to its `Source: <MVP heading path>` and check that the cited section supports
  the claim. Compare the PRD's included, excluded, and deferred scope with the
  MVP. Note source content that the PRD omits and PRD claims the MVP does not
  support.
- If the MVP or PRD names an existing implementation or prototype, inspect it
  when needed to assess a factual claim. Check specific technical claims
  against reliable evidence; mark claims you cannot verify as unverified.

## STEP 1: GAP ANALYSIS

Classify findings as confirmed errors, unresolved questions, or proposals
outside the MVP scope. Assess their impact on the initial release in these
areas; an absent optional detail is a question, not permission to fill it in:

1. PRODUCT FUNDAMENTALS
   - Product vision and problem statement
   - Target users and their needs
   - Stated success metrics and scope boundaries

2. TECHNICAL REQUIREMENTS
   - Technology constraints and integrations stated in the MVP
   - Relevant security, performance, and scalability gaps

3. BUSINESS CONSIDERATIONS
   - Timeline, budget, or regulatory constraints when material to the MVP

4. IMPLEMENTATION FACTORS
   - Dependencies and third-party requirements
   - Testing and deployment assumptions that affect stated capabilities

## STEP 2: IMPROVEMENT RECOMMENDATIONS

Provide specific recommendations in these areas:

1. STRUCTURE & CLARITY
   - Clarify ambiguous requirements while preserving their source and ID
   - Keep user journeys and scope statements consistent with the MVP

2. COMPLETENESS & FEASIBILITY
   - Restore MVP requirements omitted from the PRD
   - Identify technical claims that need evidence or decisions
   - Put unsupported alternatives in the review record as proposals

3. PRIORITIZATION & IMPLEMENTATION
   - Preserve stated MVP priorities and deferred scope
   - Record suggested priority or sequencing changes separately for the user

## DELIVERABLES

1. **Revised PRD:** Correct confirmed errors in the input PRD at its existing
   path. Preserve stable `FR`/`NFR` IDs and each requirement's MVP `Source`.
   Assign a new ID only to a source-supported requirement that was omitted.
   Preserve documented decisions; leave undecided choices in **Open
   Questions/Assumptions**. Inspect the diff after editing.
2. **Review record:** Save beside the PRD as `<prd-filename-without-.md>.review.md`
   (for example, `docs/prd/poker-mvp.prd.review.md`). For each significant
   finding, record impact, the PRD ID or section, the MVP source, what changed
   or remains unresolved, and why. Keep suggestions that would change MVP
   scope here until the user decides on them.
3. **Handoff:** Report both paths and any unresolved release-scope questions.
   The next Feature extraction step reads the revised PRD and this review
   record; this skill does not create Features or start that step.

## SELF-CHECK BEFORE FINISHING

- Confirm `FR`/`NFR` IDs are unique and unchanged for existing meanings.
- Confirm every included MVP capability and stated constraint is represented
  in the PRD or explicitly identified as an unresolved gap. Check that each
  PRD requirement's cited MVP section supports its meaning.
- Confirm the PRD and review record agree about fixes and open questions, and
  that no proposal was silently promoted into the initial release.
