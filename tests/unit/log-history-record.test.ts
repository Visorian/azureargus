import { toPersistedFirewallLogRecord } from '../../app/utils/logHistoryRecord'
import type { FirewallLogRecord } from '../../shared/types/firewall'

function createLog(overrides: Partial<FirewallLogRecord> = {}): FirewallLogRecord {
  return {
    id: 'id',
    timestamp: '2026-07-09T12:00:00.000Z',
    category: 'AZFWNetworkRule',
    action: 'Allow',
    protocol: 'TCP',
    message: 'Allow TCP',
    raw: { secret: 'raw payload' },
    searchableText: 'allow tcp',
    ...overrides,
  }
}

describe('log history record mapping', () => {
  it('persists only the log history contract', () => {
    const logWithExtraFields: FirewallLogRecord & {
      accessToken: string
      connectionString: string
      consumerGroup: string
      sharedAccessKey: string
    } = {
      ...createLog(),
      accessToken: 'token',
      connectionString: 'Endpoint=sb://example/;SharedAccessKey=secret',
      consumerGroup: '$Default',
      policy: 'hub-policy',
      ruleCollectionGroup: 'hub-collection-group',
      sharedAccessKey: 'secret',
    }

    const persisted = toPersistedFirewallLogRecord(logWithExtraFields)

    expect(persisted).toStrictEqual({
      action: 'Allow',
      category: 'AZFWNetworkRule',
      destinationIp: undefined,
      destinationPort: undefined,
      id: 'id',
      message: 'Allow TCP',
      policy: 'hub-policy',
      protocol: 'TCP',
      rule: undefined,
      ruleCollection: undefined,
      ruleCollectionGroup: 'hub-collection-group',
      searchableText: 'allow tcp',
      sourceIp: undefined,
      sourcePort: undefined,
      timestamp: '2026-07-09T12:00:00.000Z',
    })
  })

  it('does not persist raw payloads by default', () => {
    const persisted = toPersistedFirewallLogRecord(createLog())

    expect(Object.hasOwn(persisted, 'raw')).toBe(false)
  })
})
