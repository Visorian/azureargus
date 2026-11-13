import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { onTestFinished } from 'vitest'
import { reactive } from 'vue'

import EventHubSettingsPanel from '../../app/components/logs/EventHubSettingsPanel.vue'
import type { EventHubConnectionForm } from '../../app/utils/eventHubConnection'

function createConnectionForm(): EventHubConnectionForm {
  return {
    connectionString: '',
    consumerGroup: '$Default',
    eventHubName: '',
    lookbackMinutes: 15,
    bufferSize: 5_000,
  }
}

function createProps(connectionForm = createConnectionForm()) {
  return {
    connectionForm,
    rememberConnectionString: false,
    clearingLogHistory: false,
    connectionActive: false,
    connecting: false,
    connectionStringPersistenceError: null,
    logHistoryEnabled: true,
    logHistoryError: null,
    managed: false,
    modeTransitioning: false,
    reconnecting: false,
    'onUpdate:connectionForm': (value: EventHubConnectionForm) => {
      Object.assign(connectionForm, value)
    },
  }
}

describe('EventHubSettingsPanel', () => {
  it('offers deployment handoff without retaining credentials', async () => {
    const wrapper = await mountSuspended(EventHubSettingsPanel, { props: createProps() })
    const deploymentLinks = wrapper.findAll(
      'a[href^="https://portal.azure.com/#create/Microsoft.Template/uri/"]',
    )
    expect(deploymentLinks.map((link) => link.text())).toStrictEqual([
      'Event Hub only',
      'Event Hub + firewall diagnostics',
    ])
    for (const link of deploymentLinks) {
      expect(link.attributes('target')).toBe('_blank')
      expect(link.attributes('rel')).toBe('noopener noreferrer')
      expect(link.attributes('aria-label')).toContain('(opens in new tab)')
    }
    expect(wrapper.text()).toContain('azureargus-listen')
    expect(wrapper.text()).toContain('EntityPath')
    await wrapper.get('[role="checkbox"]').trigger('click')
    expect(wrapper.emitted('update:rememberConnectionString')).toStrictEqual([[true]])
  })

  it('shows invalid connection fields and prevents connecting', async () => {
    const connectionForm = reactive(createConnectionForm())
    const wrapper = await mountSuspended(EventHubSettingsPanel, {
      props: createProps(connectionForm),
      attachTo: document.body,
      global: { stubs: { UTooltip: { inheritAttrs: false, template: '<slot />' } } },
    })
    onTestFinished(() => {
      wrapper.unmount()
    })
    const connect = wrapper.findAll('button').find((button) => button.text() === 'Connect')!
    await connect.trigger('click')
    await flushPromises()
    expect(wrapper.emitted('connect')).toBeUndefined()
    expect(wrapper.get('textarea').attributes('aria-invalid')).toBe('true')
    expect(wrapper.text()).toContain('Connection string is required.')
    expect(wrapper.text()).not.toContain(
      'Event Hub name is required when EntityPath is not present.',
    )
    expect(document.activeElement).toBe(wrapper.get('textarea').element)
    expect(wrapper.get('[role="alert"]').text()).toContain(
      'Review the highlighted connection settings.',
    )
    await wrapper.get('textarea').setValue('Endpoint=sb://example.servicebus.windows.net/;')
    await flushPromises()
    expect(wrapper.text()).toContain('Event Hub name is required when EntityPath is not present.')
    await wrapper
      .get('textarea')
      .setValue(
        'Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=Listen;SharedAccessKey=secret;EntityPath=firewall',
      )
    await flushPromises()
    expect(wrapper.find('[aria-invalid="true"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain(
      'Event Hub name is required when EntityPath is not present.',
    )
    expect(wrapper.find('.settings-validation-summary').exists()).toBe(false)
    const consumerGroup = wrapper.get('input[name="consumerGroup"]')
    await consumerGroup.setValue('')
    await flushPromises()
    expect(consumerGroup.attributes('aria-invalid')).toBe('true')
    await consumerGroup.setValue('$Default')
    await flushPromises()
    expect(consumerGroup.attributes('aria-invalid')).toBe('false')
  })

  it('connects a valid form and makes disconnect available only for an active connection', async () => {
    const form = createConnectionForm()
    form.connectionString =
      'Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=Listen;SharedAccessKey=secret;EntityPath=firewall'
    const wrapper = await mountSuspended(EventHubSettingsPanel, {
      props: createProps(form),
      attachTo: document.body,
    })
    onTestFinished(() => {
      wrapper.unmount()
    })
    const connect = wrapper.findAll('button').find((button) => button.text() === 'Connect')!
    const disconnect = wrapper.findAll('button').find((button) => button.text() === 'Disconnect')!
    expect(disconnect.attributes('aria-disabled')).toBe('true')
    await disconnect.trigger('click')
    expect(wrapper.emitted('disconnect')).toBeUndefined()
    connect.element.focus()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.emitted('connect')).toHaveLength(1)
    await wrapper.setProps({ connecting: true })
    expect(connect.attributes('aria-busy')).toBe('true')
    expect(document.activeElement).toBe(connect.element)
    await connect.trigger('click')
    expect(wrapper.emitted('connect')).toHaveLength(1)
    expect(disconnect.attributes('aria-disabled')).toBe('false')
    await disconnect.trigger('click')
    expect(wrapper.emitted('disconnect')).toHaveLength(1)
    await wrapper.setProps({ connecting: false, connectionActive: true })
    expect(connect.attributes('aria-disabled')).toBe('true')
    expect(connect.attributes()).not.toHaveProperty('disabled')
    expect(disconnect.attributes('aria-disabled')).toBe('false')
    expect(wrapper.text()).toContain('Connected to Event Hub.')
    expect(wrapper.get('textarea').attributes()).toHaveProperty('disabled')
    await disconnect.trigger('click')
    expect(wrapper.emitted('disconnect')).toHaveLength(2)
  })

  it('explains retention and confirms clearing saved records', async () => {
    const wrapper = await mountSuspended(EventHubSettingsPanel, {
      props: { ...createProps(), savedLogCount: 3 },
      attachTo: document.body,
    })
    expect(wrapper.text()).toContain(
      'Turning retention off or starting a new session clears saved records.',
    )
    await wrapper.get('[role="switch"]').trigger('click')
    expect(wrapper.emitted('updateLogRetention')).toBeUndefined()
    await flushPromises()
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('Saved Live Event Hub records will be cleared')
    const confirm = Array.from(dialog?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent === 'Turn off and clear saved logs',
    )
    expect(confirm).toBeDefined()
    confirm?.click()
    await flushPromises()
    expect(wrapper.emitted('updateLogRetention')).toStrictEqual([[false]])
    wrapper.unmount()
  })

  it('keeps persistence errors beside their settings and omits deployment-managed credentials', async () => {
    const wrapper = await mountSuspended(EventHubSettingsPanel, {
      props: {
        ...createProps(),
        connectionStringPersistenceError: 'Storage is unavailable.',
        logHistoryError: 'Browser records could not be cleared.',
      },
    })
    expect(
      wrapper
        .findAll('[role="alert"]')
        .map((alert) => alert.text())
        .join(' '),
    ).toContain('Storage is unavailable.')
    expect(wrapper.text()).toContain('Browser records could not be cleared.')
    await wrapper.setProps({ managed: true, reconnecting: true })
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.find('a[href^="https://portal.azure.com/#create/"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Connection is configured by deployment.')
    expect(wrapper.text()).toContain('Reconnecting to Event Hub')
    expect(wrapper.findAll('input').every((input) => 'disabled' in input.attributes())).toBe(true)
  })
})
