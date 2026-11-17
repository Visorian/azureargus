import {
  createDefaultLogSort,
  getNextSortDirection,
  sortFirewallLogs,
} from '../../app/composables/useLogSorting'
import type { FirewallLogRecord } from '../../shared/types/firewall'

function createLog(overrides: Partial<FirewallLogRecord>): FirewallLogRecord {
  return {
    id: 'id',
    timestamp: '2026-07-09T12:00:00.000Z',
    category: 'AZFWNetworkRule',
    action: 'Allow',
    protocol: 'TCP',
    message: 'Allow TCP',
    raw: {},
    searchableText: 'azfwnetworkrule allow tcp',
    ...overrides,
  }
}

describe('log sorting', () => {
  it('sorts out-of-order realtime logs by timestamp', () => {
    const logs = [
      createLog({ id: 'middle', timestamp: '2026-08-13T13:05:07.659Z' }),
      createLog({ id: 'oldest', timestamp: '2026-08-13T11:55:11.945Z' }),
      createLog({ id: 'newest', timestamp: '2026-08-13T13:06:47.932Z' }),
    ]

    expect(sortFirewallLogs(logs, createDefaultLogSort()).map((log) => log.id)).toStrictEqual([
      'newest',
      'middle',
      'oldest',
    ])
  })

  it('sorts requested columns without mutating input', () => {
    const logs = [
      createLog({ id: 'deny', action: 'Deny' }),
      createLog({ id: 'allow', action: 'Allow' }),
    ]

    const result = sortFirewallLogs(logs, { key: 'action', direction: 'asc' })

    expect(result.map((log) => log.id)).toStrictEqual(['allow', 'deny'])
    expect(logs.map((log) => log.id)).toStrictEqual(['deny', 'allow'])
  })

  it('sorts Log snapshots by date even when input has another server order', () => {
    const logs = [
      createLog({ id: 'oldest', timestamp: '2026-07-09T12:00:00.000Z' }),
      createLog({ id: 'newest', timestamp: '2026-07-09T12:00:01.000Z' }),
    ]

    const result = sortFirewallLogs(logs, createDefaultLogSort())

    expect(result.map((log) => log.id)).toStrictEqual(['newest', 'oldest'])
  })

  it('sorts source ports numerically in ascending order', () => {
    const logs = [
      createLog({ id: '10015', sourcePort: '10015' }),
      createLog({ id: 'missing' }),
      createLog({ id: '1024', sourcePort: '1024' }),
      createLog({ id: '443', sourcePort: '443' }),
    ]

    const result = sortFirewallLogs(logs, { key: 'sourcePort', direction: 'asc' })

    expect(result.map((log) => log.id)).toStrictEqual(['missing', '443', '1024', '10015'])
  })

  it('sorts destination ports numerically in descending order', () => {
    const logs = [
      createLog({ id: '8080', destinationPort: '8080' }),
      createLog({ id: '65535', destinationPort: '65535' }),
      createLog({ id: 'missing', destinationPort: '' }),
      createLog({ id: '80', destinationPort: '80' }),
    ]

    const result = sortFirewallLogs(logs, { key: 'destinationPort', direction: 'desc' })

    expect(result.map((log) => log.id)).toStrictEqual(['65535', '8080', '80', 'missing'])
  })

  it('toggles active columns and defaults date to descending', () => {
    expect(getNextSortDirection({ key: 'action', direction: 'asc' }, 'action')).toBe('desc')
    expect(getNextSortDirection({ key: 'action', direction: 'asc' }, 'timestamp')).toBe('desc')
  })
})
