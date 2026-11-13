import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

import LogAnalyticsQueryControls from '../../app/components/logs/LogAnalyticsQueryControls.vue'
import LogAnalyticsSettingsPanel from '../../app/components/logs/LogAnalyticsSettingsPanel.vue'
import type { LogAnalysisDateRange } from '../../app/utils/logAnalysis'

function createDraftRange(): LogAnalysisDateRange {
  return {
    from: '2026-07-12T08:00',
    to: '2026-07-12T09:00',
  }
}

function createProps() {
  return {
    adminConsentUrl: null,
    dnsReadiness: [],
    dnsReadinessStatus: 'idle' as const,
    lens: 'all-logs' as const,
    queryLimit: 1_000,
    queryStorage: 'resource-specific' as const,
    temporary: false,
    temporaryAccessError: null,
    temporaryAccessStatus: 'idle' as const,
    temporaryLogAnalyticsAuthorized: false,
    temporaryLogAnalyticsAuthorizing: false,
    temporaryAuthError: null,
    temporaryAuthStatus: 'idle' as const,
    temporaryAzureUsername: '',
    tenantId: '',
    tenantOptions: [],
    workspaceId: '',
    workspaceOptions: [],
    'onUpdate:tenantId': () => {},
    'onUpdate:queryLimit': () => {},
    'onUpdate:queryStorage': () => {},
    'onUpdate:workspaceId': () => {},
  }
}

describe('LogAnalyticsQueryControls', () => {
  it('edits an explicit UTC range and exposes field validation', async () => {
    const range = createDraftRange()
    const wrapper = await mountSuspended(LogAnalyticsQueryControls, {
      props: {
        draftRange: range,
        preset: 'custom',
        'onUpdate:draftRange': (value: LogAnalysisDateRange) => {
          Object.assign(range, value)
        },
      },
    })
    await wrapper.get('summary').trigger('click')
    const inputs = wrapper.findAll('input[type="datetime-local"]')
    await inputs[0]!.setValue('2026-07-12T07:30')
    await inputs[1]!.setValue('2026-07-12T09:30')
    await wrapper.setProps({ draftRange: { ...range } })
    expect(range).toEqual({ from: '2026-07-12T07:30', to: '2026-07-12T09:30' })
    expect(wrapper.get('summary').text()).toContain('07:30–09:30 UTC')
    await inputs[1]!.setValue('2026-07-12T06:30')
    await wrapper.setProps({ draftRange: { ...range } })
    expect(wrapper.get('[role="alert"]').text()).toBe('Start date must be before end date.')
    expect(inputs[0]!.attributes('aria-invalid')).toBe('true')
    expect(inputs[1]!.attributes('aria-invalid')).toBe('true')
  })
})

describe('LogAnalyticsSettingsPanel', () => {
  it('keeps sign-in feedback in the account step and emits connection intents', async () => {
    const wrapper = await mountSuspended(LogAnalyticsSettingsPanel, {
      props: {
        ...createProps(),
        temporary: true,
        temporaryAuthError: 'Azure authentication failed.',
      },
    })
    expect(wrapper.get('[role="alert"]').text()).toContain('Azure authentication failed.')
    expect(wrapper.text()).not.toContain('Grant tenant consent')
    const connect = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Connect to Azure')!
    const disconnect = wrapper.findAll('button').find((button) => button.text() === 'Disconnect')!
    expect(disconnect.attributes('aria-disabled')).toBe('true')
    await connect.trigger('click')
    expect(wrapper.emitted('connectAzure')).toHaveLength(1)
    await wrapper.setProps({ temporaryAuthStatus: 'connecting', temporaryAuthError: null })
    await connect.trigger('click')
    expect(wrapper.emitted('connectAzure')).toHaveLength(1)
    expect(connect.attributes('aria-disabled')).toBe('true')
    expect(connect.attributes()).not.toHaveProperty('disabled')
    await wrapper.setProps({
      temporaryAuthStatus: 'connected',
      temporaryAzureUsername: 'user@example.com',
    })
    expect(wrapper.text()).toContain('Connected as user@example.com.')
    expect(connect.attributes('aria-disabled')).toBe('true')
    expect(connect.attributes()).not.toHaveProperty('disabled')
    expect(disconnect.attributes('aria-disabled')).toBe('false')
    await disconnect.trigger('click')
    expect(wrapper.emitted('disconnectAzure')).toHaveLength(1)
  })

  it('keeps workspace access behind consent and exposes the correct discovery state', async () => {
    const wrapper = await mountSuspended(LogAnalyticsSettingsPanel, {
      props: {
        ...createProps(),
        temporary: true,
        temporaryAuthStatus: 'connected',
        temporaryAccessStatus: 'loading',
        tenantId: '22222222-2222-4222-8222-222222222222',
      },
    })
    const directory = wrapper.findAllComponents({ name: 'USelectMenu' })[0]!
    const workspace = wrapper.findAllComponents({ name: 'USelectMenu' })[1]!
    expect(directory.props('placeholder')).toBe('Loading Azure directories…')
    expect(directory.props('modelValue')).toBeUndefined()
    expect(workspace.props('placeholder')).toBe('Grant tenant consent first')
    expect(workspace.props('disabled')).toBe(true)
    await wrapper.setProps({
      temporaryAccessStatus: 'success',
      adminConsentUrl: 'https://login.microsoftonline.com/consent',
      tenantOptions: [
        {
          tenantId: '22222222-2222-4222-8222-222222222222',
          displayName: 'Target tenant',
          defaultDomain: 'target.example',
        },
      ],
      workspaceOptions: [
        {
          workspaceId: '33333333-3333-4333-8333-333333333333',
          name: 'firewall-logs',
          subscriptionName: 'Production',
          subscriptionId: '44444444-4444-4444-8444-444444444444',
          resourceGroup: 'firewall',
          location: 'westeurope',
        },
      ],
    })
    const refreshConsent = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Refresh consent')!
    await refreshConsent.trigger('click')
    expect(wrapper.emitted('authorizeLogAnalytics')).toHaveLength(1)
    expect(wrapper.text()).toContain('Grant tenant consent before selecting a workspace.')
    await wrapper.setProps({ temporaryLogAnalyticsAuthorized: true })
    expect(workspace.props('disabled')).toBe(false)
    expect(workspace.props('placeholder')).toBe('Select a workspace')
    expect(wrapper.text()).toContain('Log Analytics access available for selected directory.')
    await directory.setValue('55555555-5555-4555-8555-555555555555')
    await workspace.setValue('33333333-3333-4333-8333-333333333333')
    expect(wrapper.emitted('changeTenant')?.[0]).toEqual(['55555555-5555-4555-8555-555555555555'])
    expect(wrapper.emitted('changeWorkspace')?.[0]).toEqual([
      '33333333-3333-4333-8333-333333333333',
    ])
    await wrapper.setProps({
      temporaryAccessStatus: 'error',
      temporaryAccessError: 'ARM access failed.',
    })
    expect(workspace.props('placeholder')).toBe('Workspace discovery failed')
    expect(wrapper.get('[role="alert"]').text()).toContain('ARM access failed.')
    const refresh = wrapper.findAll('button').find((button) => button.text() === 'Refresh')!
    await refresh.trigger('click')
    expect(wrapper.emitted('refreshAzureAccess')).toHaveLength(1)
  })

  it('renders visible source states and lets a failed readiness check be retried', async () => {
    const wrapper = await mountSuspended(LogAnalyticsSettingsPanel, { props: createProps() })
    expect(wrapper.text()).toContain('Waiting for workspace check.')
    expect(wrapper.findAll('tbody').map((body) => body.text())).toEqual([
      expect.stringContaining('DNS sources'),
      expect.stringContaining('General firewall logs'),
    ])
    expect(wrapper.findAll('td').every((cell) => cell.text() === 'Not checked')).toBe(true)
    await wrapper.setProps({ dnsReadinessStatus: 'error' })
    expect(wrapper.get('[role="alert"]').text()).toContain('Source readiness check failed')
    const retry = wrapper.findAll('button').find((button) => button.text() === 'Check again')!
    await retry.trigger('click')
    expect(wrapper.emitted('refreshReadiness')).toHaveLength(1)
    await wrapper.setProps({
      dnsReadinessStatus: 'success',
      dnsReadiness: [
        {
          source: 'proxy-structured',
          storage: 'resource-specific',
          status: 'success',
          sampleCount: 2,
        },
        {
          source: 'proxy-structured',
          storage: 'azure-diagnostics',
          status: 'missing',
          sampleCount: null,
        },
        {
          source: 'dns-flow-trace',
          storage: 'resource-specific',
          status: 'forbidden',
          sampleCount: null,
        },
        {
          source: 'network-rule',
          storage: 'resource-specific',
          status: 'failed',
          sampleCount: null,
        },
        { source: 'network-rule', storage: 'azure-diagnostics', status: 'success', sampleCount: 0 },
      ],
    })
    const sourceRow = wrapper
      .findAll('tr')
      .find((row) => row.text().includes('Structured DNS proxy logs'))!
    expect(sourceRow.findAll('td').map((cell) => cell.text())).toEqual(['Available', 'Not found'])
    expect(wrapper.text()).toContain('Access denied')
    expect(wrapper.text()).toContain('Check failed')
    expect(wrapper.text()).toContain('No data')
    expect(wrapper.text()).toContain('Dedicated tables 1/7 available')
    const querySource = wrapper.getComponent({ name: 'USelect' })
    expect(querySource.props('disabled')).toBe(true)
    await wrapper.setProps({
      dnsReadiness: [
        { source: 'network-rule', storage: 'resource-specific', status: 'success', sampleCount: 2 },
        { source: 'network-rule', storage: 'azure-diagnostics', status: 'success', sampleCount: 1 },
      ],
    })
    expect(querySource.props('disabled')).toBe(false)
    await querySource.setValue('azure-diagnostics')
    expect(wrapper.emitted('update:queryStorage')?.[0]).toEqual(['azure-diagnostics'])
  })

  it('shows readiness after a temporary workspace is selected and keeps result limits bounded', async () => {
    const wrapper = await mountSuspended(LogAnalyticsSettingsPanel, {
      props: { ...createProps(), temporary: true },
    })
    expect(wrapper.text()).not.toContain('Source readiness')
    const limit = wrapper.getComponent({ name: 'UInputNumber' })
    expect(limit.props()).toMatchObject({ min: 100, max: 5_000, step: 100, modelValue: 1_000 })
    await limit.setValue(2_000)
    expect(wrapper.emitted('update:queryLimit')?.[0]).toEqual([2_000])
    await limit.setValue(undefined)
    await flushPromises()
    expect(wrapper.emitted('update:queryLimit')?.at(-1)).toEqual([1_000])
    expect(wrapper.emitted('update:queryLimit')?.flat()).not.toContain(undefined)
    await wrapper.setProps({ workspaceId: '33333333-3333-4333-8333-333333333333' })
    expect(wrapper.text()).toContain('Source readiness')
    expect(wrapper.text()).toContain('Applies to next query.')
  })
})
