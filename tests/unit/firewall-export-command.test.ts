import { createFirewallExportCommand } from '../../app/utils/firewallExportCommand'

it('quotes embedded Nushell raw-string delimiters and saves only in file mode without overwriting', () => {
  const options = {
    subscription: 'demo',
    resourceGroup: '',
    firewallName: '',
    policyName: "p'#q",
    output: 'text' as const,
  }
  const text = createFirewallExportCommand(options)
  expect(text).toContain("let policy_name = r##'p'#q'##")
  const file = createFirewallExportCommand({ ...options, output: 'file' })
  expect(file).toBe(`${text} | save 'firewall-configuration.json'`)
})
