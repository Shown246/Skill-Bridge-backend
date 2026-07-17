# Frontend API Documentation Design

## Goal

Create `docs/API_DOCUMENTATION.md` as the complete, implementation-backed API handbook for SkillBridge frontend developers. It documents every exposed endpoint, including Better Auth, unversioned health checks, and all versioned business routes, without changing backend behavior.

## Audience and Source of Truth

The primary reader is a frontend developer integrating a browser or TypeScript client. Route definitions establish the endpoint inventory; authentication configuration, middleware, Zod schemas, controllers, services, repositories, Prisma models, environment configuration, and automated tests establish the contracts and edge cases. When sources disagree, the running implementation takes priority and the documentation calls out the discrepancy rather than inventing behavior.

## Document Structure

The guide is a single Markdown file organized as a frontend integration handbook:

1. Quick-start information: local base URL, API prefixes, content type, CORS, and credential handling.
2. Shared conventions: authentication mechanisms, response envelopes, request IDs, errors, rate limits, timestamps, UTC rules, pagination, filtering, sorting, money, and shared enums.
3. A complete endpoint inventory grouped into system, authentication, account, categories, tutor discovery and profile, availability and slots, bookings, reviews, and administration.
4. Detailed endpoint contracts containing method and path, purpose, access rules, headers, parameters, validation, successful status and payload, expected error cases, and representative requests and responses.
5. Reusable TypeScript types and browser `fetch` examples where they materially reduce integration ambiguity.
6. End-to-end workflow notes for registration/session handling, tutor onboarding and approval, discovery and slot selection, booking lifecycle, review submission, and administrator moderation.
7. Implementation caveats and unsupported capabilities relevant to frontend behavior.

Better Auth endpoints receive the same contract treatment as custom routes. The guide distinguishes cookie-session use from Bearer-token use and explains when browser requests require `credentials: "include"`.

## Accuracy and Safety

Examples use fictional IDs, emails, names, and tokens. Secrets, local credentials, and raw environment values are never copied into the guide. Optional and nullable fields are distinguished, enumerated values are listed exactly, date formats and time-zone assumptions are explicit, and status-dependent operations describe their preconditions.

The guide documents current behavior only. It does not promise payments, messaging, video calls, recurring bookings, calendar synchronization, or deployment behavior. Any surprising inconsistency that affects consumers is labeled as an implementation note.

## Verification

Verification includes:

- Compare the documented inventory with `src/app.ts`, the Better Auth configuration, and every route module.
- Trace request fields through Zod schemas and response fields through controllers, services, repositories, and Prisma selections.
- Use automated tests to confirm authorization, validation, conflicts, pagination, status transitions, and error behavior.
- Scan for undocumented routes, placeholder language, accidental secrets, broken internal links, and inconsistent field/type names.
- Run `git diff --check` and documentation-specific source comparisons before completion.

No application code or generated files are modified for this task.
