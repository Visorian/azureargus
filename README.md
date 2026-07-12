# Azure Argus

Browser workspace for receiving, inspecting, and querying Azure Firewall logs.

## Features

- Stream Azure Firewall logs directly from Event Hubs with pause/resume controls and wall-time lag.
- Query historical network, application, and NAT rule logs through Azure Log Analytics.
- Search, filter, sort, and inspect raw records in a virtualized high-volume table.
- Add or remove filters directly from filterable table values.
- Optionally retain up to 100,000 normalized logs in browser IndexedDB.
- Resolve public destination IPs to country flags through a server-local MMDB database.
- Use Microsoft Entra authentication or explicitly enabled anonymous mode.

## Quick Start

Requires [Bun](https://bun.sh/).

```bash
bun install
cp .env.example .env
bun run geoip:update
bun run dev
```

Open `http://127.0.0.1:3000` and connect with an Event Hub Listen-only SAS connection string.
Anonymous mode is enabled by default for real-time analysis. Log Analytics requires Entra sign-in and
server credentials.

Configuration is documented in [`.env.example`](./.env.example). Set the `NUXT_OIDC_*` variables
for Entra authentication and `NUXT_LOG_ANALYTICS_*` variables for historical queries.

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
