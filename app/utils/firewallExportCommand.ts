const LINE_BREAKS = /[\r\n]/u
const WILDCARDS = /[*?[\]]/u
const SOURCE_REVISION = /^[a-f0-9]{40}$/iu
const POWERSHELL_QUOTES = /['‘’‚‛]/gu

export type FirewallExportEnvironment = 'bash-cli' | 'azure-powershell' | 'powershell-cli'

export interface FirewallExportCommandOptions {
  environment: FirewallExportEnvironment
  subscription: string
  resourceGroup: string
  firewallName: string
  policyName: string
  output: 'file' | 'text'
}

export function firewallExportSelectionError(
  options: FirewallExportCommandOptions,
): string | undefined {
  if (options.firewallName.trim() === '' && options.policyName.trim() === '') {
    return 'Enter a firewall or policy name to generate the command.'
  }
  if (WILDCARDS.test(options.firewallName) || WILDCARDS.test(options.policyName)) {
    return 'Enter exact firewall and policy names. Wildcards are not supported.'
  }
  return undefined
}

export function firewallExportSourceError(sourceRevision: string | undefined): string | undefined {
  if (sourceRevision === undefined || !SOURCE_REVISION.test(sourceRevision)) {
    return 'This build has no valid source revision. Deploy a build from a published Git commit to enable export commands.'
  }
  return undefined
}

function bashLiteral(value: string): string {
  if (LINE_BREAKS.test(value)) {
    const escaped = value
      .replaceAll('\\', String.raw`\\`)
      .replaceAll("'", String.raw`\'`)
      .replaceAll('\r', String.raw`\r`)
      .replaceAll('\n', String.raw`\n`)
    return `$'${escaped}'`
  }
  return `'${value.replaceAll("'", String.raw`'\''`)}'`
}

function powershellLiteral(value: string): string {
  const quoted = `'${value.replaceAll(POWERSHELL_QUOTES, '$&$&').replaceAll('\r', "'+[char]13+'").replaceAll('\n', "'+[char]10+'")}'`
  return LINE_BREAKS.test(value) ? `(${quoted})` : quoted
}

function parameter(flag: string, value: string, quote: (value: string) => string): string {
  const trimmed = value.trim()
  return trimmed === '' ? '' : `${flag} ${quote(trimmed)}`
}

export function createFirewallExportCommand(
  options: FirewallExportCommandOptions,
  sourceRevision: string | undefined,
): string {
  if (
    sourceRevision === undefined ||
    firewallExportSourceError(sourceRevision) !== undefined ||
    firewallExportSelectionError(options) !== undefined
  ) {
    return ''
  }
  const bash = options.environment === 'bash-cli'
  const quote = bash ? bashLiteral : powershellLiteral
  const flags = bash
    ? {
        firewall: '--firewall',
        policy: '--policy',
        subscription: '--subscription',
        resourceGroup: '--resource-group',
        output: '--output',
      }
    : {
        firewall: '-FirewallName',
        policy: '-PolicyName',
        subscription: '-Subscription',
        resourceGroup: '-ResourceGroup',
        output: '-OutputFile',
      }
  const target = [
    parameter(flags.firewall, options.firewallName, quote),
    parameter(flags.policy, options.policyName, quote),
  ]
    .filter((value) => value !== '')
    .join(' ')
  const scope = [
    parameter(flags.subscription, options.subscription, quote),
    parameter(flags.resourceGroup, options.resourceGroup, quote),
  ]
    .filter((value) => value !== '')
    .join(' ')
  const output =
    options.output === 'file' ? parameter(flags.output, 'firewall-configuration.json', quote) : ''
  const groups = [target, scope, output].filter((value) => value !== '')
  const runner = bash
    ? 'bash azureargus-export.sh'
    : `./azureargus-export.ps1${options.environment === 'powershell-cli' ? ' -UseAzureCli' : ''}`
  const continuation = bash ? ' \\' : ' `'
  const invocation = groups
    .map((group, index) => `${index === 0 ? `${runner} ` : '  '}${group}`)
    .join(`${continuation}\n`)
  const source = `https://raw.githubusercontent.com/Visorian/azureargus/${sourceRevision.toLowerCase()}/public/cloud-shell`
  const assignment = bash ? `src=${quote(source)}` : `$src = ${quote(source)}`
  const download = bash
    ? 'curl -fsSL "$src/export-firewall.sh" -o azureargus-export.sh &&'
    : 'Invoke-WebRequest "$src/export-firewall.ps1" -OutFile azureargus-export.ps1 -ErrorAction Stop &&'
  return [assignment, download, invocation].join('\n')
}
