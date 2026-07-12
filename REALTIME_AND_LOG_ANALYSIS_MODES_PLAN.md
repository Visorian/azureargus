# Real-time and Log Analysis Modes Plan

## Goal

Add two explicit modes to the existing logs experience:

- **Real-time analysis**: existing Event Hub streaming workflow for live troubleshooting.
- **Log analysis**: explicit initial Azure Firewall query plus user-driven filter/sort refinements against one configured Log Analytics workspace.

Switching to Log analysis must stop Event Hub connection attempts, event processing, batching, and persistence writes before Log analysis becomes active. Results from both modes must remain isolated while reusing the current virtualized table and detail modal.

## Current State

- `app/pages/logs.vue` owns Event Hub form state, common filters, receiver controls, table, detail modal, and local retention UI.
- `useEventHubReceiver()` owns module-level Event Hub client/subscription state plus composable-local batching and record indexes.
- `disconnect()` currently flushes batching and IndexedDB persistence before closing Event Hub resources, so callbacks can still arrive during teardown.
- A failed receiver remains in `error` after `disconnect()`, which does not satisfy mode-switch requirement that receiver reaches `idle`.
- Current Event Hub connection form already has numeric lookback input. Separate `from` and `to` fields filter rows already held in browser memory.
- `useLogQuery()` caches filtered matches across source updates. Switching one active source ref between Event Hub and Log Analytics would merge records unless dataset identity is added.
- Default timestamp-desc sorting assumes Event Hub buffer is already newest-first; Log Analytics results need explicit ordering before reaching sorter.
- IndexedDB retention is optional, Real-time-only capture. It does not provide Log analysis data and does not render into live list.
- Anonymous access is client-memory state and disappears on reload.
- Current OIDC scopes are `openid`, `profile`, `email`, and `offline_access`; no Log Analytics scope is requested.
- Installed `nuxt-oidc-auth` only returns decrypted provider access token from `getUserSession()` when `exposeAccessToken` is enabled. That also exposes token through client-visible session endpoint, conflicting with server-only token requirement.
- Repo has no app-owned `server/` directory and no Pinia Colada dependency.

## Decisions and Assumptions

### Authentication Baseline

- Use server-side client credentials for Log Analytics in this plan, not current user delegated access token.
- Configure dedicated private values:
  - `NUXT_LOG_ANALYTICS_TENANT_ID`;
  - `NUXT_LOG_ANALYTICS_CLIENT_ID`;
  - `NUXT_LOG_ANALYTICS_CLIENT_SECRET`;
  - `NUXT_LOG_ANALYTICS_WORKSPACE_ID`.
- Acquire app-only token on Nitro server with scope `https://api.loganalytics.io/.default` and cache it only server-side until shortly before expiry.
- Require valid OIDC user session on query route even though Azure call uses app identity. Anonymous sessions cannot use Log analysis.
- Require fixed Entra tenant plus app role `LogAnalysis.Read` on user session. Do not authorize every session accepted by current `organizations` tenant default.
- Add `roles` to extracted OIDC claims if installed module requires it. UI may mirror role check, but server route remains authority.
- Grant service principal least-privilege read access to configured workspace. Do not accept workspace ID from browser.
- Leave current OIDC login scopes unchanged because baseline does not use delegated Log Analytics token.
- If user-level Log Analytics RBAC is required, stop before implementation and revise authentication approach. Current module cannot provide server-only delegated token through supported API without also exposing it to browser.

### Query Baseline

- Do not add arbitrary KQL editor in first version. It is not required by original mode request and cannot guarantee current firewall table contract.
- Use server-owned KQL for Azure Firewall resource-specific tables:
  - `AZFWNetworkRule`;
  - `AZFWApplicationRule`;
  - `AZFWNatRule`.
- Baseline uses `/query` and therefore requires target tables to use Analytics table plan. Basic/Auxiliary table support through `/search` requires separate API contract and is not included here.
- Query must project one canonical firewall row shape before response mapping. Legacy `AzureDiagnostics`, threat-intelligence, and IDPS schemas remain out of scope.
- Use `union isfuzzy=true withsource=Category` so configured structured table subset can be queried and source table becomes record category.
- Require both absolute start and end values. Convert browser `datetime-local` values to UTC ISO strings before request.
- Default Log analysis range to last 15 minutes when mode is first opened.
- Use hybrid filtering after first explicit query:
  - browser filters/sorts current snapshot immediately for responsive feedback;
  - after 500 ms without another filter/sort change, server runs authoritative KQL using all active criteria;
  - pressing Enter or explicit Apply runs pending refinement immediately.
- Initial unfiltered query returns at most 1,000 newest records. Filtered or non-default-sorted queries return at most 5,000 records.
- Query one extra row (`1,001` or `5,001`) so response can indicate truncation without returning more than active cap.
- Keep previous snapshot visible while authoritative refinement runs; do not present local-preview empty/count state as final while request is pending.
- Sort normalized Log Analytics records by requested allowlisted sort before returning them to browser.

## Constraints

- Keep changes minimal and reviewable.
- Do not redesign app shell, table, detail modal, or login flow.
- Do not add, remove, or upgrade packages without approval.
- Use Bun for package commands.
- Use Tailwind v4 utility classes only.
- Keep reactive and lifecycle logic in composables; keep utilities free of Vue/Nuxt imports.
- Treat Log Analytics calls as user-driven query mutations and use `useRequestFetch()` with `AbortSignal`. Do not add Pinia Colada in this scope.
- Do not expose OIDC or Log Analytics tokens/credentials to new storage or browser-visible server responses.
- Do not persist mode, Log Analytics query results, date range, or retention preference. Persist Event Hub connection string only after explicit browser-storage opt-in. If removal fails, keep opt-in visibly enabled and surface the failure instead of claiming the credential was removed.
- Do not preserve legacy compatibility paths unless explicitly requested.

## Progress

- [x] Phase 1: Harden Real-time teardown
- [x] Phase 2: Mode state and transition orchestration
- [x] Phase 3: Real-time lookback and common filters
- [x] Phase 4: Log Analytics server boundary
- [x] Phase 5: Log Analysis client query flow
- [x] Phase 6: Shared results surface
- [x] Phase 7: Tests and verification

## Verification Addendum

Verified against final implementation on 2026-07-10. Review found and corrected:

- blocked Real-time form submission during mode teardown so Event Hub cannot reconnect after Log analysis activates;
- disabled both mode controls while transition is pending;
- prevented Enter from launching an authoritative query when no refinement is pending or failed;
- removed redundant per-row lowercasing from case-insensitive KQL `contains` filters;
- rejected Azure `PartialError` responses instead of presenting incomplete results as authoritative;
- enforced tenant/role denial before validating unrelated private Log Analytics configuration;
- bounded and keyed token acquisition and allowed disconnected callers to stop waiting;
- expanded route, cancellation, refinement failure, date-dirty, filter mapping, and partial-response tests.

No package changes, compatibility paths, arbitrary KQL, workspace picker, polling, or Log-result
persistence were introduced.

### Re-verification Addendum (2026-07-12)

Re-verified full plan after requested logs-page UI changes. Later approved scope moved the desktop
sidebar right, strengthened the neutral palette, added local-retention help, and added explicit
browser-local Event Hub connection-string persistence. These changes did not alter Log Analytics
authorization, query contract, result storage, mode isolation, or other non-goals.

Review found and corrected:

- persistence teardown now drains records queued while an IndexedDB write is already active before
  mode transition reports completion;
- failed connection-string removal keeps persistence visibly selected and reports the failure so an
  unchecked control never implies a stored SAS credential was removed;
- typed Log action/protocol values now remain in the page-scoped option cache until Clear;
- tests now cover queued-write teardown draining, criteria changes during initial query, applied
  range preservation, typed-option reset, and browser-storage removal failure;
- Playwright Test uses the configured Nix-wrapped browser when
  `PLAYWRIGHT_MCP_EXECUTABLE_PATH` is present.

Repository verification cannot prove deployment-side service-principal RBAC, workspace table plan,
app-role assignment, stable OIDC secrets, or an explicit production tenant. Those remain required
deployment checks under **Pre-implementation Checks**.

## Phase 1: Harden Real-time Teardown

### Changes

- Update existing `useEventHubReceiver()` rather than creating second receiver instance.
- Add connection generation/cancellation guard so a pending dynamic import or client creation cannot subscribe after mode switch or route leave.
- Make `disconnect()` idempotent and serialize overlapping disconnect calls.
- At teardown start:
  - invalidate active connection generation;
  - set receiver status to `idle` immediately;
  - make `processEvents` and `processError` ignore stale generation or non-connected status.
- Close subscription and client before final batch/history flush so no new records arrive while persistence drains.
- Flush pending 100 ms batch after Event Hub closure, then await existing retention queue flush.
- Ensure each resource close is attempted even if another close fails; report close error without leaving live references behind.
- If Event Hub resources cannot be closed, fail transition and do not activate Log analysis. Ignoring callbacks is not sufficient proof that network work stopped.
- Preserve current in-memory records, credentials, local retention enabled state, and retained IndexedDB history on mode switch. An explicitly remembered Event Hub connection string remains browser-local.
- Add awaited page-leave teardown through mode orchestration composable.

### Acceptance Checks

- Switching modes during `connect()` cannot create late subscription.
- No Event Hub records are parsed, buffered, or persisted after teardown starts.
- Pending batch/history writes finish before mode transition reports complete.
- Repeated `disconnect()` calls close each active resource once and end in `idle`.
- Failed teardown keeps Log analysis inactive and surfaces error.
- Leaving logs page disconnects Real-time receiver and aborts Log Analytics request.

## Phase 2: Mode State and Transition Orchestration

### Changes

- Add `app/composables/useAnalysisMode.ts` with strict union:
  - `real-time-analysis`;
  - `log-analysis`.
- Default to `real-time-analysis` on every page load.
- Pass existing receiver and Log Analytics query controller into mode composable. Never call `useEventHubReceiver()` again inside mode composable because receiver client is module-level while batcher/index state is composable-local.
- Mode transition behavior:
  - Real-time to Log: await hardened receiver teardown before activating Log mode;
  - Log to Real-time: abort current query before activating Real-time mode;
  - both directions: close detail modal and switch active filter/sort/result bindings without resetting either mode's state.
- Add transition loading state and disable mode control until teardown/abort completes.
- Place segmented mode control in main toolbar so it remains reachable when sidebar is collapsed.
- Show Log analysis option disabled for anonymous sessions with concise sign-in hint.
- Also disable Log analysis when current session lacks `LogAnalysis.Read`; treat missing/overage claims as denied rather than adding Graph fallback.

### Acceptance Checks

- Only one mode transition runs at a time.
- Real-time credentials and buffered logs remain available when visiting Log analysis. Credentials remain in memory unless connection-string persistence is explicitly enabled.
- Each mode preserves its own filter and sort state while inactive; changes in Real-time never schedule Log Analytics query.
- Log analysis results remain separate and are never appended to Real-time buffer or IndexedDB.
- Anonymous and signed-in unauthorized users can see mode choice but cannot activate Log analysis.

## Phase 3: Real-time Lookback and Common Filters

### Changes

- Define one typed lookback option constant in `useEventHubConnection.ts` for values `1`, `3`, `5`, `10`, and `15`.
- Give options exact labels `Last 1 minute`, `Last 3 minutes`, `Last 5 minutes`, `Last 10 minutes`, and `Last 15 minutes`.
- Replace numeric Event Hub lookback input with fixed `USelect`/`USelectMenu` bound to `connectionForm.lookbackMinutes`.
- Normalize unsupported `NUXT_PUBLIC_DEFAULT_LOOKBACK_MINUTES` values to `15` instead of using unsafe cast or rendering unmatched selection.
- Update Event Hub validation so only supported values are accepted.
- Remove browser-side absolute `from`/`to` filters from:
  - `FirewallLogFilters`;
  - default filter state;
  - active-filter and cache-key logic;
  - row filtering;
  - current unit tests.
- Keep common result filters:
  - search;
  - category;
  - action;
  - protocol;
  - source;
  - destination.
- Reset button affects common result filters only, never Event Hub credentials, lookback, Log Analytics date range, or results.

### Acceptance Checks

- Real-time UI contains one lookback control with only 1, 3, 5, 10, and 15 minutes.
- Connect start position uses selected value.
- No absolute date filters render in Real-time toolbar.
- Existing credentials retain current memory-only behavior unless connection-string persistence is explicitly enabled. Visible-row setting remains memory-only.

## Phase 4: Log Analytics Server Boundary

### Files

- `server/api/log-analytics/query.post.ts`: authenticated HTTP boundary only.
- `server/utils/logAnalyticsAuth.ts`: client-credential token acquisition and expiry-aware in-memory cache.
- `server/utils/logAnalyticsQuery.ts`: fixed KQL, request validation, Azure call, response mapping, and error normalization.
- Shared request/response types in a pure file importable by app and server without Vue/Nuxt runtime imports.

### Changes

- Add private Log Analytics runtime config and document variables in `.env.example` with empty placeholders.
- Add `.env.example` placeholders for `NUXT_OIDC_SESSION_SECRET`, `NUXT_OIDC_AUTH_SESSION_SECRET`, and `NUXT_OIDC_TOKEN_KEY`; random development fallbacks are not acceptable deployment configuration.
- Update lint script to include `server` because current script only checks `app`, `tests`, and config files.
- Route must require server-side OIDC session through installed module's exported runtime helper (`requireUserSession` from `nuxt-oidc-auth/runtime/server/utils/session.js`). Client route middleware is not API authorization.
- Reject anonymous/no-session requests with `401` before token acquisition or Azure call.
- Validate provider, tenant (`tid`), and `LogAnalysis.Read` role from server session claims; reject authenticated-but-unauthorized requests with `403` before token acquisition or Azure call.
- Accept structured body containing only:
  - `from` and `to` ISO timestamps;
  - common filters: search, category, action, protocol, source, destination;
  - sort key and direction.
- Use H3 `readValidatedBody()` with one strict, pure manual parser/type guard; installed H3 explicitly supports function validators, so do not add schema dependency for this bounded request contract.
- Validation must enforce:
  - body is object;
  - values are strings and parse as finite timestamps;
  - `from < to`;
  - range does not exceed 24 hours;
  - filter lengths are bounded;
  - sort key/direction belong to explicit allowlists;
  - unknown fields are rejected.
- Build fixed-workspace URL server-side:
  - `POST https://api.loganalytics.azure.com/v1/workspaces/{configuredWorkspaceId}/query`.
- Build KQL only from validated structured criteria:
  - start from fixed structured-table union and canonical projection;
  - add `where` clauses for search, category, action, protocol, source, and destination;
  - map sort key through server-owned KQL column allowlist;
  - append requested ordering and server-selected `take` cap.
- Keep one tested KQL string-literal encoder. Never concatenate raw browser text, KQL identifiers, operators, or fragments directly into query.
- Match existing browser filter semantics in KQL: trim values, compare case-insensitively, search canonical searchable text, and filter source/destination against combined address and port text.
- Send generated server-owned KQL and explicit `timespan` in Azure request body.
- Select cap server-side: 1,000 for no common filters with default timestamp-desc sort; 5,000 when any common filter or non-default sort is active. Browser cannot request larger cap.
- Bound Azure request with timeout and abort it when incoming request is aborted where Nitro runtime exposes signal.
- Do not log authorization header, client secret, KQL response body, or returned firewall records.
- Normalize upstream failures:
  - missing server config -> `503`;
  - invalid range -> `400`;
  - missing OIDC session -> `401`;
  - wrong tenant/missing app role -> `403`;
  - Azure authorization -> `403`;
  - Azure throttling -> `429` with safe retry metadata;
  - timeout/upstream failure -> `502`/`504` with generic message.
- Never forward raw Azure error body to browser.

### Canonical Mapping

- Convert `tables[].columns` plus `rows` to typed row objects using column index map; do not use `any` or unchecked whole-object casts.
- Require valid `TimeGenerated`; reject unsupported result schema instead of converting missing timestamps to Unix epoch.
- Project/map canonical fields:
  - timestamp;
  - category/table source;
  - action;
  - protocol;
  - source IP/port;
  - destination IP/FQDN/port;
  - rule collection;
  - rule;
  - message.
- Generate unique ID per query execution plus table/row index for virtual scroller stability.
- Return only projected canonical row as `raw`; do not return token, workspace config, or unprojected columns.
- Sort records according to validated requested sort before response and return `{ records, truncated, limit }`.

### Acceptance Checks

- Browser cannot select or override workspace, KQL, row limit, token scope, or Azure endpoint.
- Direct anonymous POST receives `401` and performs no Azure request.
- Authenticated user without required tenant/role receives `403` and performs no Azure request.
- API never exposes access token or client secret.
- Malformed/upstream response cannot crash mapper or create epoch timestamps.
- Initial broad query returns at most 1,000 records; any query returns at most 5,000 normalized records.
- Filtered response is authoritative for active structured criteria; browser preview is not treated as complete dataset.

## Phase 5: Log Analysis Client Query Flow

### Changes

- Add page-scoped `app/composables/useLogAnalyticsQuery.ts` with:
  - `shallowRef<FirewallLogRecord[]>` results;
  - `idle | loading | success | refreshing | error` status;
  - error text;
  - truncation flag;
  - active result limit;
  - whether initial query has run;
  - draft and last-applied date range plus whether draft has unapplied changes;
  - monotonically increasing dataset/query version;
  - `run()`, `scheduleRefinement()`, `abort()`, and `clear()` methods.
- Use `useRequestFetch()` for explicit POST and pass owned `AbortController.signal`.
- Starting new query aborts previous query first.
- `abort()` cancels both pending debounce timer and active request.
- `clear()` returns Log mode to no-query state:
  - cancel pending debounce and active request;
  - clear records and close selected detail;
  - set status to `idle` and `hasRun` to false;
  - clear error, truncation, active limit, Apply-pending state, and dynamic option cache;
  - increment dataset version;
  - preserve date range, Log filters, and Log sort so next explicit Run can reuse them.
- Guard result/error assignment with request generation so stale response can never overwrite newer query or active mode.
- Treat `AbortError` as expected cancellation: no error state and no toast.
- Surface non-abort query errors through existing toast pattern without exposing upstream error body.
- First query runs only from Run query button and includes current date range, filters, and sort.
- After first successful query, common filter or sort changes:
  - update browser-filtered/sorted preview immediately using existing composables;
  - schedule authoritative query after 500 ms inactivity;
  - Enter or Apply filters bypasses remaining debounce;
  - cancel prior authoritative request before replacement.
- Abort active refinement immediately when criteria change, then debounce replacement query so obsolete request does not continue through debounce window.
- If criteria change during initial load, apply them to returned snapshot immediately and schedule refinement as soon as initial request succeeds.
- Date-range edits abort any active query (including initial load), mark range dirty, and require Run query; suppress filter/sort refinements until new range is explicitly applied.
- While range is dirty, keep prior snapshot identified with last-applied range and show `Run query to apply date range`; do not label it as result for draft range.
- Refinement keeps prior records visible with `refreshing` state. Initial load may show loading state because no prior snapshot exists.
- Refinement failure keeps prior snapshot and shows non-blocking error; it does not replace records with empty list.
- Add Log analysis sidebar controls only for:
  - absolute start;
  - absolute end;
  - Run query button.
- Add compact `Apply filters` command beside existing Reset control in Log mode. Enable it only when authoritative refinement is pending or previous refinement failed.
- Initialize date range to current time minus 15 minutes/current time on first Log mode activation.
- Convert local input values to UTC ISO before request and show validation before network call.
- No polling, auto-refresh, retry loop, workspace input, KQL editor, or visible-row input.
- Query controller observes only Log analysis filter/sort state and schedules nothing while mode is inactive.

### Acceptance Checks

- Initial query runs only from explicit user action.
- Filter/sort refinements run only after initial query and only from user changes, with 500 ms debounce or immediate Apply/Enter.
- Starting second query cancels first and latest query wins.
- Switching mode or leaving page aborts active browser request.
- Query results are never queued into local retention.
- Truncated result state is visible without changing table layout.
- UI distinguishes local preview/updating state from authoritative filtered result.

## Phase 6: Shared Results Surface

### Changes

- Create active records and presentation state from current mode:
  - Real-time records/status/count/clear use receiver;
  - Log records/status/count/clear use query controller.
- Keep existing search, category, action, protocol, source, destination, Reset, table, sort headers, and detail interaction in same locations for both modes. Do not create separate Log analysis filter form.
- Execution differs by mode only: Real-time filters/sorts in-memory buffer; Log analysis gives same immediate local interaction and then authoritative KQL refinement.
- Pass mode-aware visible limit into `useLogQuery()`: receiver limit for Real-time and current server-returned limit (1,000 or 5,000) for Log analysis.
- Keep separate page-scoped filter and sort state for each mode while rendering one shared toolbar/table. Bind controls to active mode state.
- Extend Log analysis `useLogQuery()` with dataset/version key. When authoritative query version changes, rebuild matches from current records and discard cached matches from prior Log query.
- Build Real-time category/action/protocol options from current receiver records.
- In Log analysis:
  - use fixed supported table categories;
  - seed action/protocol with common firewall values;
  - allow typed action/protocol values through installed `USelectMenu` `create-item` support so valid values absent from capped snapshot remain queryable;
  - accumulate newly observed values for page session so options do not disappear when authoritative filters or date changes narrow result set;
  - reset dynamic option cache on Clear/page recreation;
  - do not add background facet queries.
- Increment Log dataset key on every authoritative result replacement or clear.
- Keep existing virtualized table and sorting controls.
- Make sorting source-aware: preserve current timestamp-desc pass-through optimization for newest-first Real-time buffer, but always perform requested local sort for Log snapshot. This ensures switching from server-returned non-default order back to timestamp-desc previews correctly before refinement completes.
- Apply Log sort locally to current snapshot for immediate feedback, then replace with server-authoritative globally sorted capped result.
- Make toolbar mode-aware:
  - Real-time shows receiver badge, received count, Pause/Resume, and mode-aware Clear;
  - Log shows query badge, result count, Run state, and Clear results;
  - Connect/Disconnect and local retention controls appear only in Real-time sidebar.
- Show preview count with updating state while refinement is pending; after response, show authoritative capped count and truncation message using returned `limit`.
- Always close detail on mode switch and before replacing Log Analytics result set.
- Omit Partition, Sequence, and Enqueued detail fields entirely in Log mode.
- Preserve raw detail using projected canonical row only.
- Add distinct empty states:
  - no Real-time records: connect to Event Hub;
  - no Log query yet: choose range and run query;
  - completed query with no rows: no records in selected range;
  - authoritative filtered query with zero rows: no records match filters;
  - local preview has zero rows while refinement is pending: keep updating state instead of final no-match message.

### Acceptance Checks

- Separate mode state prevents filter/sort/cache leakage across modes.
- Active Log filters never retain rows from earlier authoritative Log query.
- Filter and sort controls respond immediately while server refinement remains authoritative.
- Real-time filter/sort changes never call Log Analytics route.
- Switching modes never mixes Event Hub and Log Analytics records.
- Clear only affects active result source.
- Log mode never displays Event Hub status, counters, controls, or metadata.
- Existing table and detail interaction remain recognizable.

## Phase 7: Tests and Verification

### Unit Tests

- Event Hub receiver:
  - connect invalidated during mode switch cannot subscribe;
  - stale event/error callbacks are ignored;
  - subscription/client close before final batch/history flush;
  - repeated disconnect is idempotent and ends `idle`.
- Event Hub lookback:
  - only 1, 3, 5, 10, 15 accepted;
  - unsupported runtime default falls back to 15.
- Filtering/sorting:
  - absolute date filters removed;
  - each mode preserves independent filter/sort state;
  - Real-time filter changes never schedule Log query;
  - Log dataset-key change cannot merge cached rows;
  - repeated Log queries cannot retain previous matches;
  - unordered Log Analytics response follows requested server sort;
  - local preview updates before authoritative response;
  - Log snapshot returned in non-default server order sorts timestamp-desc immediately when user switches back to Date desc;
  - fixed/typed filter options can query values absent from initial capped snapshot;
  - option lists do not collapse after narrowed/date-range response and reset at Clear/page boundary.
- Log Analytics server utilities:
  - request range validation;
  - fixed workspace/endpoint and structured KQL generation;
  - each filter maps to expected `where` clause;
  - KQL literal escaping prevents injected operators/fragments;
  - sort key/direction allowlists reject arbitrary identifiers;
  - initial 1,000 and filtered 5,000 caps plus truncation metadata;
  - token cache expiry behavior with injected/mock fetch;
  - column/row mapping, optional fields, unique IDs, unsupported schema, row cap, and truncation;
  - safe Azure error normalization.
- Query controller:
  - local `datetime-local` to UTC conversion and invalid-range handling;
  - latest request wins;
  - abort is not surfaced as error;
  - mode switch/route leave cancel both pending debounce and active request;
  - no automatic query before first Run;
  - filter changes debounce exactly once and Enter/Apply flushes debounce;
  - criteria change aborts active refinement before replacement debounce;
  - criteria changed during initial load trigger refinement after first response;
  - date changes require explicit Run;
  - date changes during initial load abort old-range request;
  - dirty date range keeps prior applied-range result clearly identified;
  - refinement failure preserves prior records;
  - clear resets no-query state, closes detail, preserves criteria, and cannot trigger refinement.
- Presentation helpers where extracted:
  - mode-aware status/count/clear/detail fields/empty state;
  - Log Analytics results never enter retention queue.

### E2E Tests

- Existing anonymous flow still reaches logs page in Real-time mode.
- Mode control renders; Log analysis is disabled for anonymous session.
- Direct anonymous Log Analytics API POST returns `401`.
- Server authorization helper tests cover wrong tenant, missing role, and valid role; no client-only check is accepted as authorization proof.
- Real-time lookback lists exactly 1, 3, 5, 10, 15.
- Real-time mode keeps current local retention switch behavior.
- Authenticated Azure query is not exercised against live service in e2e.

### Commands

- `bun run fmt`
- `bun run lint`
- `bun run typecheck`
- `bun run test:unit`
- `bun run test:e2e`
- `bun run build`
- `git diff --check`

Because UI structure changes, verify anonymous Real-time state with `playwright-cli -s` and store screenshots under `.playwright-cli/`. Authenticated Log analysis state requires valid local OIDC session; do not add production bypass or expose mode solely to satisfy visual test.

## Non-goals

- No multi-workspace support or browser-provided workspace ID.
- No delegated user token flow in this implementation baseline.
- No arbitrary KQL editor.
- No browser-only filtering presented as authoritative Log Analytics result.
- No legacy `AzureDiagnostics` parsing.
- No Basic/Auxiliary table `/search` support in `/query` baseline.
- No threat-intelligence or IDPS table support.
- No scheduled polling, auto-refresh, background retry, or dashboard widgets.
- No Log Analytics results in IndexedDB.
- No IndexedDB history browser or use as Log analysis source.
- No durable Event Hub credentials without explicit browser-storage opt-in. Mode state, query range, query results, and retention preference remain memory-only.
- No app shell, login layout, table, or detail-modal redesign.
- No package changes unless separately approved.

## Implementation Order

1. Confirm app-only service principal, fixed workspace, RBAC, and structured firewall tables.
2. Harden Event Hub teardown and add race/idempotency tests.
3. Add typed mode orchestration and route-leave cleanup.
4. Replace Real-time lookback input and remove client date filters.
5. Add private runtime config, `.env.example` entries, shared contracts, and server utility tests.
6. Add server token/query utilities, structured criteria-to-KQL builder, and authenticated API route.
7. Add page-scoped Log Analytics query controller with initial Run, debounce, cancellation, and latest-result guard.
8. Add Log analysis range UI and mode-aware sidebar/toolbar/detail/empty/updating states.
9. Add separate mode filter/sort state, Log dataset-key invalidation, immediate local preview, stable option cache, and active result wiring.
10. Update unit/e2e coverage and run full verification.

## Pre-implementation Checks

- Confirm app-only service principal is acceptable; otherwise delegated auth requires separate plan.
- Replace `organizations` login tenant with explicit tenant and define/assign `LogAnalysis.Read` app role to authorized users/groups.
- Configure stable OIDC session/token secrets in every non-development deployment.
- Confirm configured workspace uses resource-specific `AZFWNetworkRule`, `AZFWApplicationRule`, and/or `AZFWNatRule` tables. Current plan intentionally excludes legacy `AzureDiagnostics`.
- Confirm target tables use Analytics plan; Basic/Auxiliary tables require `/search` design before implementation.
- Confirm 24-hour range, 1,000-row initial cap, 5,000-row filtered cap, and 500 ms refinement debounce fit intended troubleshooting workflow.
- Confirm Log analysis remains unavailable to anonymous and signed-in users without `LogAnalysis.Read`.

## Documentation Checked

- Azure Monitor Logs API access/authentication: `https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/access-api`
- Log Analytics request format: `https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/request-format`
- Azure Firewall monitoring and structured logs: `https://learn.microsoft.com/en-us/azure/firewall/monitor-firewall`
- Basic/Auxiliary table query API: `https://learn.microsoft.com/en-us/azure/azure-monitor/logs/basic-logs-query`
- `AZFWNetworkRule` schema: `https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/azfwnetworkrule`
- `AZFWApplicationRule` schema: `https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/azfwapplicationrule`
- `AZFWNatRule` schema: `https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/azfwnatrule`
- Installed `nuxt-oidc-auth` server session behavior: `node_modules/nuxt-oidc-auth/dist/runtime/server/utils/session.js`
