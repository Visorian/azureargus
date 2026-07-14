# Azure Argus

Browser workspace for receiving, inspecting, and querying Azure Firewall logs.

## Features

- Stream Azure Firewall logs directly from Event Hubs with pause/resume controls and wall-time lag.
- Query historical network, application, and NAT rule logs through Azure Log Analytics.
- Search, filter, sort, and inspect raw records in a virtualized high-volume table.
- Add or remove filters directly from filterable table values.
- Optionally retain up to 100,000 normalized logs in browser IndexedDB.
- Resolve public destination IPs to country flags through a server-local MMDB database.
- Use managed application login or deployment-derived anonymous mode.

## Quick Start

Requires [Bun](https://bun.sh/).

```bash
bun install
cp .env.example .env
bun run geoip:update
bun run dev
```

Open `http://127.0.0.1:3000` and connect with an Event Hub Listen-only SAS connection string.
Without predefined data-source credentials, app starts directly in anonymous mode: Event Hub accepts
temporary browser-provided SAS credential and Log Analytics can use temporary delegated Azure
authentication when public SPA identifiers are configured.

Configuration is documented in [`.env.example`](./.env.example). Set the
`NUXT_EVENT_HUB_*` and/or `NUXT_LOG_ANALYTICS_*` variables to select managed mode. Managed mode requires
`NUXT_OIDC_PROVIDERS_ENTRA_*` login/session configuration, disables anonymous access, and exposes only
fully predefined sources. Event Hub SAS and Log Analytics client secret stay server-side.

### Deployment modes

| Predefined environment group | Resulting mode         | Available data sources                                    |
| ---------------------------- | ---------------------- | --------------------------------------------------------- |
| None                         | Anonymous              | Temporary Event Hub SAS; optional delegated Log Analytics |
| Event Hub                    | Managed/login required | Predefined server-side Event Hub                          |
| Log Analytics                | Managed/login required | Predefined server-side Log Analytics                      |
| Both                         | Managed/login required | Both predefined sources                                   |
| Partial or malformed group   | Invalid deployment     | No login or anonymous fallback                            |

- Event Hub: `NUXT_EVENT_HUB_CONNECTION_STRING` and, when connection string has no `EntityPath`,
  `NUXT_EVENT_HUB_NAME`.
- Log Analytics: `NUXT_LOG_ANALYTICS_TENANT_ID`, `NUXT_LOG_ANALYTICS_CLIENT_ID`,
  `NUXT_LOG_ANALYTICS_CLIENT_SECRET`, and `NUXT_LOG_ANALYTICS_WORKSPACE_ID`.

Anonymous deployments can optionally enable temporary Log Analytics authentication with central
multitenant SPA identifier `NUXT_PUBLIC_LOG_ANALYTICS_DELEGATED_CLIENT_ID`. Public client ID does not
enable application login or select managed mode. Guided connection flow derives available Azure
directories and Log Analytics workspaces from signed-in account access.

Managed deployments also require complete application-login configuration:
`NUXT_OIDC_PROVIDERS_ENTRA_CLIENT_ID`, `NUXT_OIDC_PROVIDERS_ENTRA_CLIENT_SECRET`,
`NUXT_OIDC_PROVIDERS_ENTRA_REDIRECT_URI`, `NUXT_OIDC_PROVIDERS_ENTRA_AUTHORIZATION_URL`,
`NUXT_OIDC_PROVIDERS_ENTRA_TOKEN_URL`, `NUXT_OIDC_SESSION_SECRET`,
`NUXT_OIDC_AUTH_SESSION_SECRET`, and `NUXT_OIDC_TOKEN_KEY`.

For anonymous Log Analytics, create multitenant Microsoft Entra app registration, register SPA
redirect URI at `https://YOUR_APP/log-analytics-redirect.html`, add delegated Log Analytics API
`Data.Read` plus Azure Service Management `user_impersonation`, and set
`NUXT_PUBLIC_LOG_ANALYTICS_DELEGATED_CLIENT_ID`. Guided connection flow signs into an organization,
lists available Azure directories and workspaces, and opens target-tenant admin consent and Azure
portal workspace access. Query authorization is completed explicitly before Run, so Run never opens
an interactive authentication window. Assign `Log Analytics Data Reader` at workspace scope to
signed-in user or group. Access tokens and selected tenant/workspace IDs remain browser-memory-only
and are cleared on disconnect/page exit.
Do not add a `Cross-Origin-Opener-Policy` response header to the redirect bridge page; MSAL popup
communication requires that page to remain in the opener's browsing context group.

## IP Geolocation

`bun run geoip:update` downloads and validates current monthly
[DB-IP Country Lite](https://db-ip.com/db/download/ip-to-country-lite) release into
`.data/dbip-country-lite.mmdb`. This file is ignored by Git and read only by Nitro server code;
browser receives only two-letter country results.

For container or serverless deployment:

1. Run `bun run geoip:update` in controlled build or update job.
2. Mount resulting database read-only into every application instance.
3. Set `NUXT_IP_COUNTRY_DATABASE_PATH` to mounted file and restart instances after replacement.
4. Rate-limit anonymous `/api/ip-country` requests at edge, reject bodies larger than 2 KiB, and do
   not capture request bodies in access logs, APM, or traces.

App remains usable without database, but destination flags stay disabled. Keep last valid database
when update fails and refresh it monthly.

## Development

```bash
bun run lint
bun run typecheck
bun run test:unit
bun run test:e2e
bun run build
```

## License

Published under [AGPL-3.0-only](./LICENSE).

IP geolocation data is provided by [DB-IP](https://db-ip.com) under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
