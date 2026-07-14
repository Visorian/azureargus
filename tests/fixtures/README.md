# GeoIP test fixture

`GeoLite2-Country-Test.mmdb` comes from the
[MaxMind-DB test data](https://github.com/maxmind/MaxMind-DB/tree/main/test-data) at commit
`000a8df991543651637fd9c16b7a7f8480370514`. The source repository distributes it under
Apache-2.0. It contains synthetic test records and is not a production GeoLite database.

## DNS Log Analytics fixtures

`dns/log-analytics-azfwdnsquery.sanitized.json` and
`dns/log-analytics-azfwnetworkrule.sanitized.json` are reduced, sanitized Azure Monitor query
responses derived from Azure portal CSV exports captured on 2026-07-07. Tenant, subscription,
resource, IP, DNS name, policy, collection, rule, query ID, and timestamp values were replaced while
field types, empty values, repeated relationships, ordering, protocols, ports, actions, response
codes, flags, sizes, and durations were preserved.

The source exports contained 100 rows per table. Representative captured rows cover structured DNS
success, `NXDOMAIN`, `SERVFAIL`, DNSSEC, a malformed/error-shaped record, and network-rule allow and
deny outcomes. Captured network-rule samples contain UDP destination-port-53 traffic only. Three
clearly synthetic rows derived from that schema cover TCP source-port-53, UDP destination-port-53,
and ambiguous both-port-53 direction without claiming additional captured Azure evidence.

These fixtures validate `AZFWDnsQuery` and `AZFWNetworkRule` Log Analytics schema mapping. They do
not provide real Event Hub envelope, source-port-53, TCP transport, legacy `AzureDiagnostics`, or
`AZFWDnsFlowTrace` evidence. They also do not validate retry metadata, multiple Azure Firewall
resources, multiple Event Hub partitions, or multi-row correlation.
