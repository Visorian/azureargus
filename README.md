# Azure Argus

Browser workspace for receiving, inspecting, and querying Azure Firewall logs.

## Features

- Stream Azure Firewall logs directly from Event Hubs with pause/resume controls and wall-time lag.
- When `AZFWNetworkRule` and `AzureFirewallNetworkRule` records exactly match within correlation
  window, legacy `AzureFirewallNetworkRule` record is suppressed.
- Live Event Hub view defaults to 5,000 visible entries; filters can access a 10x in-memory rolling
  buffer capped at 50,000, where newest entries replace oldest entries after the cap is reached.
- Query historical network, application, and NAT rule logs through Azure Log Analytics.
- Search, filter, sort, and inspect raw records in a virtualized high-volume table.
- Add or remove filters directly from filterable table values.
- Optionally retain up to 100,000 normalized logs in browser IndexedDB.
- Resolve public destination IPs to country flags through a server-local MMDB database.
- Use managed application login or deployment-derived anonymous mode.

## Getting started

Requires [Bun](https://bun.sh/). Configuration keys and placeholders are in
[`.env.example`](./.env.example).

```bash
bun install
cp .env.example .env
bun run dev
```

Open `http://localhost:3000`.

### Deploy Azure Argus application

[![Deploy Azure Argus to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2FVisorian%2Fazureargus%2Fmain%2Finfrastructure%2Fapplication%2Fazuredeploy.json)

This deploys public anonymous-mode Azure Argus to Azure Container Apps using stable version image
`ghcr.io/visorian/azureargus:0.1.1`. Published release metadata records image digest as immutable
release identity.
The app uses HTTPS ingress, scales from zero to one replica, and stores no Event Hub credential or
Azure token server-side. Anyone with the generated URL can open the application. Leave **Delegated
Client ID** empty for Event Hub-only use, or enter a multitenant Entra application client ID to
enable temporary Log Analytics access. Event Hub and firewall diagnostic resources remain separate
deployments below. Review
[Azure Container Apps pricing](https://azure.microsoft.com/pricing/details/container-apps/) before
deployment.

For first-time custom-domain setup, deploy with **Custom Domain Name** empty, then use the
`applicationName` and `applicationUrl` outputs to configure the direct CNAME. Retrieve the TXT
verification value with:

```bash
AZUREARGUS_DELEGATED_CLIENT_ID=<application-client-id> az deployment group create \
  --resource-group <resource-group> \
  --parameters infrastructure/application/public-gwc.bicepparam customDomainName=''

az containerapp show --resource-group <resource-group> --name <applicationName> \
  --query properties.customDomainVerificationId --output tsv
```

After external CNAME/TXT and any required DigiCert CAA policy are ready, configure the managed
certificate in the Container Apps portal. Subsequent deployments can set the custom domain with
automatic binding. The template creates no Azure DNS or certificate resources.

### Choose setup mode

|                        | Temporary (`anonymous`)                                  | Permanent (`managed`)                         |
| ---------------------- | -------------------------------------------------------- | --------------------------------------------- |
| Azure Argus login      | None                                                     | Required OIDC login                           |
| Event Hub              | User enters Listen-only SAS in browser                   | Deployment supplies fixed server-side SAS     |
| Log Analytics          | Signed-in user's delegated access                        | Fixed service principal and workspace         |
| Credential lifetime    | Browser memory unless Event Hub credential is remembered | Server environment; never returned to browser |
| Available data sources | Event Hub plus optional delegated Log Analytics          | Only fully configured fixed sources           |

Setting any `NUXT_EVENT_HUB_*` or `NUXT_LOG_ANALYTICS_*` value selects permanent mode and requires
complete OIDC login configuration. Partial or malformed fixed-source groups make deployment invalid;
Azure Argus does not fall back to temporary mode. `NUXT_PUBLIC_LOG_ANALYTICS_DELEGATED_CLIENT_ID`
alone keeps temporary mode. Permanent deployment with only one fixed source does not retain temporary
access to other source.

### Temporary setup

No environment variables are required for Event Hub-only use. To enable temporary Log Analytics,
set one browser-visible identifier and restart Azure Argus:

```dotenv
NUXT_PUBLIC_LOG_ANALYTICS_DELEGATED_CLIENT_ID=<application-client-id>
```

#### Deploy temporary Event Hub resources

Choose whether to deploy only the Event Hub resources or also add diagnostic forwarding to an
existing Azure Firewall. Both deployments create a one-throughput-unit Standard Event Hubs namespace,
an Event Hub, and the event-hub-level `azureargus-listen` policy.

**Event Hub only**

[![Deploy Event Hub only to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2FVisorian%2Fazureargus%2Fmain%2Finfrastructure%2Fevent-hub%2Fazuredeploy-event-hub-only.json)

**Event Hub + firewall diagnostic settings**

[![Deploy Event Hub and firewall diagnostics to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2FVisorian%2Fazureargus%2Fmain%2Finfrastructure%2Fevent-hub%2Fazuredeploy.json)

Before deployment:

- For firewall diagnostics, select the subscription containing the firewall. The Event Hubs and
  firewall resource groups must be in the same subscription.
- For firewall diagnostics, verify Event Hubs Standard is available in the firewall region. The
  template creates the namespace in that region because regional diagnostic destinations must match.
- A firewall supports at most five diagnostic settings. The diagnostics deployment uses one.
- The Standard namespace uses one throughput unit and incurs charges until deleted. Check current
  [regional pricing](https://azure.microsoft.com/pricing/details/event-hubs/) before deployment.

The deploying identity needs these control-plane permissions, directly or through broader roles:

- On the selected Event Hubs resource group: `Microsoft.Resources/deployments/*`; resource management
  access for Event Hubs namespaces, event hubs, and authorization rules;
  `Microsoft.EventHub/namespaces/authorizationRules/listkeys/action`; and
  `Microsoft.EventHub/namespaces/eventhubs/authorizationRules/listkeys/action`.
- For firewall diagnostics, on the firewall resource group: `Microsoft.Resources/deployments/*`,
  `Microsoft.Network/azureFirewalls/read`, `Microsoft.Insights/diagnosticSettings/read`, and
  `Microsoft.Insights/diagnosticSettings/write`.

In the portal, choose the Event Hubs resource group as the deployment resource group. Both templates
accept **Event Hub name** (default `azureargus`) and **Event Hub retention hours** (default `1`, range
`1`–`168`). The diagnostics template also requires:

- **Firewall resource group name**.
- **Firewall name**.

Both deployments output the generated namespace and Event Hub identities. The diagnostics deployment
also outputs the exact diagnostic-setting name and resource ID. It uses namespace
`RootManageSharedAccessKey` only for Azure Monitor diagnostic delivery. Both deployments create a
separate event-hub-level `azureargus-listen` policy with only `Listen` permission for Azure Argus.

After deployment, open the generated namespace, select the Event Hub, then open **Shared access
policies** > **azureargus-listen**. Copy its **Primary Connection String**. The string must contain
`EntityPath=<event-hub-name>`. Never copy or paste a namespace-level or `RootManageSharedAccessKey`
connection string into Azure Argus.

In **Live Event Hub settings**, paste the entity-level connection string and connect. Leave the
consumer group as `$Default` unless you deliberately use another consumer group. Treat the connection
string as a secret: do not include it in screenshots, logs, issues, or chat. It remains in memory
unless **Remember connection string** stores it unencrypted in browser storage.

The Event Hub retention setting controls how long Azure retains unread broker events; default is one
hour. Event Hub lookback controls where Azure Argus starts reading within that retained stream and
remains 1–15 minutes. Local log retention separately stores records already received by the browser,
optionally up to 100,000 records for 24 hours. After diagnostic-setting creation, check once per
minute for incoming events; they usually start flowing within 20 minutes. See
[Azure Monitor diagnostic settings](https://learn.microsoft.com/azure/azure-monitor/platform/diagnostic-settings)
and [Event Hubs connection-string guidance](https://learn.microsoft.com/azure/event-hubs/event-hubs-get-connection-string).

To clean up:

1. Disconnect Azure Argus, uncheck **Remember connection string**, reload the page, and confirm the
   connection string remains cleared. Complete this before deleting `azureargus-listen` or Event Hubs
   resources.
2. If firewall diagnostics were deployed, record `diagnosticSettingName` and
   `diagnosticSettingResourceId` from deployment outputs. On the firewall, delete only that exact
   diagnostic setting. Do not remove unrelated firewall settings. Check once per minute and continue
   after the setting is absent twice in a row. Event Hub-only deployments skip this step.
3. Delete the generated namespace identified by `eventHubNamespaceName` to stop Standard namespace
   charges. Delete the selected resource group only when it was dedicated to this deployment and
   contains nothing else. To revoke browser access while retaining forwarding, delete only the
   event-hub-level `azureargus-listen` policy instead.

Cleanup requires delete permission for the exact diagnostic setting and listener policy or namespace
being removed.

#### Configure delegated Log Analytics access

1. In home tenant, create Microsoft Entra app registration with **Accounts in any organizational
   directory**. Under **Authentication**, add SPA redirect URI
   `https://YOUR_APP/log-analytics-redirect.html`; for local use add
   `http://localhost:3000/log-analytics-redirect.html`.
2. Add delegated API permissions `Log Analytics API / Data.Read` and
   `Azure Service Management / user_impersonation`. No client secret is used by temporary mode.
3. Set app's client ID as `NUXT_PUBLIC_LOG_ANALYTICS_DELEGATED_CLIENT_ID`.
4. In each target tenant, tenant admin uses Azure Argus **Grant tenant consent** action. Consent
   creates tenant-local enterprise application/service principal; it does not grant workspace data
   access. See [multitenant enterprise application setup](https://learn.microsoft.com/entra/identity/enterprise-apps/create-service-principal-cross-tenant).
5. Assign signed-in users or groups `Log Analytics Data Reader` at workspace scope.

In Azure Argus: connect Azure account, select directory, grant/refresh consent, select workspace, then
run query. Azure Resource Manager discovery and Log Analytics query authorization use separate tokens.
Tokens and selected IDs stay in browser memory and clear on disconnect or page exit. Do not set
`Cross-Origin-Opener-Policy` on redirect bridge page; MSAL popup communication requires opener context.

### Permanent setup

Permanent mode fixes data sources at deployment, requires Azure Argus login, and removes user-provided
source credentials. Configure at least one complete fixed-source group plus all login values.

#### Configure application login

Create separate Entra app registration for Azure Argus login. Add **Web** redirect URI matching
`https://YOUR_APP/auth/entra/callback`, create client secret, then set:

```dotenv
NUXT_OIDC_PROVIDERS_ENTRA_CLIENT_ID=<login-application-client-id>
NUXT_OIDC_PROVIDERS_ENTRA_CLIENT_SECRET=<login-client-secret>
NUXT_OIDC_PROVIDERS_ENTRA_REDIRECT_URI=https://YOUR_APP/auth/entra/callback
NUXT_OIDC_PROVIDERS_ENTRA_AUTHORIZATION_URL=https://login.microsoftonline.com/<login-tenant-id>/oauth2/v2.0/authorize
NUXT_OIDC_PROVIDERS_ENTRA_TOKEN_URL=https://login.microsoftonline.com/<login-tenant-id>/oauth2/v2.0/token
NUXT_OIDC_SESSION_SECRET=<random-string-at-least-48-characters>
NUXT_OIDC_AUTH_SESSION_SECRET=<random-string-at-least-32-characters>
NUXT_OIDC_TOKEN_KEY=<base64-encoded-32-byte-key>
```

Optional logout endpoint uses `NUXT_OIDC_PROVIDERS_ENTRA_LOGOUT_URL`. Login app only authenticates
Azure Argus users; it does not authorize Log Analytics or Event Hub access.

#### Configure fixed data sources

For Log Analytics, create independent Entra app registration/service principal and client secret.
Assign service principal `Log Analytics Data Reader` at target workspace, then set:

```dotenv
NUXT_LOG_ANALYTICS_TENANT_ID=<workspace-tenant-id>
NUXT_LOG_ANALYTICS_CLIENT_ID=<service-principal-client-id>
NUXT_LOG_ANALYTICS_CLIENT_SECRET=<service-principal-client-secret>
NUXT_LOG_ANALYTICS_WORKSPACE_ID=<workspace-id-guid>
```

Azure Argus uses OAuth client-credentials flow; no user consent is required. Login and Log Analytics
apps are independent and may belong to different tenants. See
[Log Analytics API app registration](https://learn.microsoft.com/azure/azure-monitor/logs/api/register-app-for-token)
and [`Log Analytics Data Reader` permissions](https://learn.microsoft.com/azure/role-based-access-control/built-in-roles/monitor#log-analytics-data-reader).

For fixed Event Hub, reuse Event Hub and diagnostics setup above, keep Listen-only SAS server-side,
and set:

```dotenv
NUXT_EVENT_HUB_CONNECTION_STRING=<listen-only-connection-string>
NUXT_EVENT_HUB_NAME=<required-only-when-EntityPath-is-absent>
```

Current implementation does not support Microsoft Entra service-principal or managed-identity Event
Hub authentication. Connection-string-free permanent Event Hub setup is therefore not available.

### Optional Log Analytics ingestion

1. Create or select Log Analytics workspace. Record workspace ID GUID, not ARM resource ID.
2. On Azure Firewall, add separate diagnostic setting, select **Send to Log Analytics workspace**,
   choose workspace, and use **Resource specific** destination tables.
3. Select structured Network Rule (`AZFWNetworkRule`), Application Rule (`AZFWApplicationRule`), and
   NAT Rule (`AZFWNatRule`) categories. For DNS troubleshooting, also enable available DNS Query,
   DNS Flow Trace, Internal FQDN Resolution Failure, and Flow Trace categories as needed. DNS Flow
   Trace supports Log Analytics or Storage, not Event Hub.

Resource-specific tables are recommended for new setups. Azure Argus can query existing
`AzureDiagnostics` network-rule data, but full core-category coverage requires structured tables.
Log delivery can take up to 30 minutes after diagnostic settings change.

### Important settings

| Setting                  | Behavior                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Event Hub consumer group | Defaults to `$Default`; shared group divides partitions among consumers               |
| Event Hub lookback       | 1, 3, 5, 10, or 15 minutes; default set by `NUXT_PUBLIC_DEFAULT_LOOKBACK_MINUTES`     |
| Visible live rows        | 5,000 by default; raw in-memory buffer is capped at 50,000                            |
| Local log retention      | Optional browser IndexedDB; up to 100,000 parsed records for 24 hours                 |
| Log Analytics query      | Absolute range up to 24 hours; result limit 100–5,000                                 |
| Analysis source switch   | Log Analytics pauses live stream; first query disconnects it; returning cancels query |

## IP Geolocation

`bun run geoip:update` downloads the [pinned DB-IP Country Lite](./scripts/dbip-country-lite.pin.json)
release, verifies its archive checksum and MMDB structure, then writes
`.data/dbip-country-lite.mmdb` atomically. This file is ignored by Git and read only by Nitro server
code; browser receives only two-letter country results.

Published image bundles pinned database at read-only default path. For deployments that do not use
published image:

1. Run `bun run geoip:update` in controlled build or update job.
2. Mount resulting database read-only into every application instance.
3. Set `NUXT_IP_COUNTRY_DATABASE_PATH` to mounted file and restart instances after replacement.
4. Rate-limit anonymous `/api/ip-country` requests at edge, reject bodies larger than 2 KiB, and do
   not capture request bodies in access logs, APM, or traces.

App remains usable without database, but destination flags stay disabled. Keep last valid database
when update fails. Refresh pin monthly by updating both `release` and `archiveSha256` from exact
DB-IP archive before rebuilding.

## Releases

Release Please maintains stable versions and `CHANGELOG.md` through a release pull request. Merge a
release pull request only after its checks pass. Merging it does not create a tag or GitHub Release;
the separate publication workflow validates the exact merged candidate before publishing release
artifacts.

Published containers use `ghcr.io/visorian/azureargus:X.Y.Z` and `latest`. Release evidence records
the immutable image digest; deployments use the stable version tag selected by their committed
parameter file and never use `latest` as release identity.

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
