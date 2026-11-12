import {
  AZURE_FIREWALL_API_VERSION,
  readAzureFirewallExport,
} from '../../shared/utils/azureFirewallReader'

const subscriptionId = '11111111-1111-4111-8111-111111111111'
const otherSubscriptionId = '22222222-2222-4222-8222-222222222222'
const scope = `/subscriptions/${subscriptionId}/resourceGroups/firewall-test/providers/Microsoft.Network`
const rootId = `${scope}/firewallPolicies/root`
const childId = `${scope}/firewallPolicies/child`
const siblingId = `${scope}/firewallPolicies/sibling`
const firewallId = `${scope}/azureFirewalls/firewall`
const ipGroupId = `/subscriptions/${otherSubscriptionId}/resourceGroups/shared/providers/Microsoft.Network/ipGroups/sources`
const managementOrigin = 'https://management.azure.com'

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input
  }
  return input instanceof URL ? input.href : input.url
}

function armResponse(id: string, properties: Record<string, unknown> = {}): Response {
  return Response.json({ id, properties })
}

function mockAzureFetch(respond: (input: RequestInfo | URL) => Response) {
  return vi.fn<typeof fetch>(async (input) => await Promise.resolve(respond(input)))
}

function signal(): AbortSignal {
  return new AbortController().signal
}

describe('Azure Firewall policy export reader', () => {
  it('loads firewall, siblings, shared ancestors and cross-subscription IP groups once, including group pagination', async () => {
    const secondPage = `${managementOrigin}${childId}/ruleCollectionGroups?api-version=${AZURE_FIREWALL_API_VERSION}&skiptoken=next`
    const childGroupId = `${childId}/ruleCollectionGroups/child-rules`
    const rootGroupId = `${rootId}/ruleCollectionGroups/base-rules`
    const fetchImplementation = mockAzureFetch((input) => {
      const url = requestUrl(input)
      const path = new URL(url).pathname.toLowerCase()
      if (url === secondPage) {
        return Response.json({ value: [{ id: childGroupId, properties: { ruleCollections: [] } }] })
      }
      if (path === `${rootId}/ruleCollectionGroups`.toLowerCase()) {
        return Response.json({
          value: [
            {
              id: rootGroupId,
              properties: {
                ruleCollections: [
                  {
                    rules: [
                      {
                        sourceIpGroups: [ipGroupId],
                        destinationIpGroups: [ipGroupId.toUpperCase()],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        })
      }
      if (path === `${childId}/ruleCollectionGroups`.toLowerCase()) {
        return Response.json({ nextLink: secondPage, value: [] })
      }
      if (path.endsWith('/rulecollectiongroups')) {
        return Response.json({ value: [] })
      }
      if (path === firewallId.toLowerCase()) {
        return armResponse(firewallId, { firewallPolicy: { id: childId } })
      }
      if (path === childId.toLowerCase()) {
        return armResponse(childId, {
          basePolicy: { id: rootId },
          ruleCollectionGroups: [{ id: childGroupId }],
        })
      }
      if (path === siblingId.toLowerCase()) {
        return armResponse(siblingId, { basePolicy: { id: rootId.toUpperCase() } })
      }
      if (path === rootId.toLowerCase()) {
        return armResponse(rootId, { ruleCollectionGroups: [{ id: rootGroupId }] })
      }
      if (path === ipGroupId.toLowerCase()) {
        return armResponse(ipGroupId, { ipAddresses: ['10.1.0.0/24'] })
      }
      throw new Error(`Unexpected request ${url}`)
    })

    const result = await readAzureFirewallExport(
      [firewallId, siblingId, childId.toUpperCase()],
      'azure-token',
      signal(),
      fetchImplementation,
    )

    expect(result.resources.map((resource) => resource['id'])).toStrictEqual(
      expect.arrayContaining([
        firewallId,
        childId,
        rootId,
        siblingId,
        childGroupId,
        rootGroupId,
        ipGroupId,
      ]),
    )
    expect(result.resources).toHaveLength(7)
    expect(fetchImplementation).toHaveBeenCalledTimes(9)
    expect(result.resources.find((resource) => resource['id'] === siblingId)).toMatchObject({
      properties: { basePolicy: { id: rootId.toUpperCase() }, ruleCollectionGroups: [] },
    })
    for (const [, request] of fetchImplementation.mock.calls) {
      expect(request).toMatchObject({
        headers: { authorization: 'Bearer azure-token' },
        redirect: 'error',
      })
    }
  })

  it('rejects invalid IDs before requesting an access-controlled resource', async () => {
    const fetchImplementation = vi.fn<typeof fetch>()
    await expect(
      readAzureFirewallExport(
        [`${rootId}?redirect=https://example.test`],
        'token',
        signal(),
        fetchImplementation,
      ),
    ).rejects.toMatchObject({ status: 400 })
    expect(fetchImplementation).not.toHaveBeenCalled()
  })

  it('reports authorization failure with the affected resource and HTTP status', async () => {
    const fetchImplementation = mockAzureFetch(() => Response.json({}, { status: 403 }))
    const result = readAzureFirewallExport([rootId], 'token', signal(), fetchImplementation)
    await expect(result).rejects.toMatchObject({ status: 403 })
    await expect(result).rejects.toThrow(rootId)
  })

  it('rejects cyclic policy inheritance instead of exporting a partial hierarchy', async () => {
    const fetchImplementation = mockAzureFetch((input) => {
      const path = new URL(requestUrl(input)).pathname
      return path === childId
        ? armResponse(childId, { basePolicy: { id: rootId } })
        : armResponse(rootId, { basePolicy: { id: childId.toUpperCase() } })
    })
    await expect(
      readAzureFirewallExport([childId], 'token', signal(), fetchImplementation),
    ).rejects.toThrow('inheritance contains a cycle')
    expect(fetchImplementation).toHaveBeenCalledTimes(2)
  })

  it('rejects an incomplete group list even when the API returns HTTP success', async () => {
    const fetchImplementation = mockAzureFetch((input) => {
      return new URL(requestUrl(input)).pathname.endsWith('/ruleCollectionGroups')
        ? Response.json({ value: [] })
        : armResponse(rootId, {
            ruleCollectionGroups: [{ id: `${rootId}/ruleCollectionGroups/missing` }],
          })
    })
    await expect(
      readAzureFirewallExport([rootId], 'token', signal(), fetchImplementation),
    ).rejects.toThrow('missing from its group list')
  })

  it('does not send its bearer token to an off-origin pagination URL', async () => {
    const fetchImplementation = mockAzureFetch((input) => {
      return new URL(requestUrl(input)).pathname.endsWith('/ruleCollectionGroups')
        ? Response.json({ value: [], nextLink: 'https://attacker.example/collections' })
        : armResponse(rootId)
    })
    await expect(
      readAzureFirewallExport([rootId], 'token', signal(), fetchImplementation),
    ).rejects.toThrow('outside management.azure.com')
    expect(fetchImplementation).toHaveBeenCalledTimes(2)
  })

  it('stops repeated pagination links', async () => {
    const fetchImplementation = mockAzureFetch((input) => {
      const url = requestUrl(input)
      return new URL(url).pathname.endsWith('/ruleCollectionGroups')
        ? Response.json({ value: [], nextLink: url })
        : armResponse(rootId)
    })
    await expect(
      readAzureFirewallExport([rootId], 'token', signal(), fetchImplementation),
    ).rejects.toThrow('repeated pagination')
    expect(fetchImplementation).toHaveBeenCalledTimes(2)
  })

  it('reports a classic firewall as unsupported', async () => {
    const fetchImplementation = mockAzureFetch(() => armResponse(firewallId))
    await expect(
      readAzureFirewallExport([firewallId], 'token', signal(), fetchImplementation),
    ).rejects.toThrow('uses classic rules')
  })
})
