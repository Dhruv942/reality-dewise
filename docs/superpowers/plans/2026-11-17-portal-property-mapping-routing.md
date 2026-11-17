# Portal Property Mapping & Undefined-Property Routing Plan

**Goal:** Match portal listings to existing properties by authoritative external IDs or verified names, preserve current assignment behavior, and make unresolved property leads reviewable and safely routable.

**Architecture:** Add portal mappings and lead match metadata in PostgreSQL. A central matcher returns `MATCHED`, `UNMATCHED`, or `AMBIGUOUS` with method/confidence/candidates. `createLead()` uses a matched property or the existing stub mechanism, then invokes the existing property round-robin only for reliable matches. Fallback routing is an Admin setting; no teams are introduced.

**Scope:** 99acres and Magicbricks payloads, Admin mapping/review/settings APIs, existing Admin lead APIs, current manager scope, assignment history and activity timeline.

## Tasks

1. Add migration for `portal_property_mappings`, lead portal/match metadata, resolution fields, indexes and the unmatched-routing setting default.
2. Add shared property-name normalization, mapping repository/service/API and property mapping detail endpoint.
3. Add matcher policy/tests and extend webhook mappers with external property ID/name/URL fields.
4. Integrate matching, stub reuse, fallback manager metadata and existing round-robin in `createLead()`.
5. Add unmatched lead listing/candidates/manual resolution/mapping-registration APIs and a property-resolution activity type.
6. Add regression/integration tests for exact, alias, fuzzy, ambiguous, conflict, idempotency, concurrency, routing and resolution.
7. Update README/architecture documentation and run migrations, typecheck, build and full tests.

## Decisions

- Exact external ID conflicts are surfaced as `CONFLICT`/review, never silently remapped.
- Active mapping uniqueness is enforced per portal + external ID and per portal + normalized alias.
- Fuzzy matching is conservative: a single candidate must meet the central threshold and beat the next candidate by the required margin; otherwise the lead is ambiguous.
- Unresolved leads remain `PENDING_ASSIGNMENT`; `propertyMatchStatus` distinguishes property review from ordinary no-executive pending assignment.
- `ADMIN_QUEUE` is the default; designated manager routing is limited to an active MANAGER.
- Manual resolution updates only the lead's property and match metadata, preserves the old stub/property and history, then runs the existing assignment service once.
