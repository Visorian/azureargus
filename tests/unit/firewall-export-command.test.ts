import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createFirewallExportCommand } from '../../app/utils/firewallExportCommand'
import type { FirewallExportCommandOptions } from '../../app/utils/firewallExportCommand'
import { parseFirewallSnapshot } from '../../shared/utils/firewallSimulator'

const environments = ['bash-cli', 'azure-powershell', 'powershell-cli'] as const
const revision = '1111111111111111111111111111111111111111'
const options: FirewallExportCommandOptions = {
  environment: 'bash-cli',
  subscription: 'demo',
  resourceGroup: '',
  firewallName: '',
  policyName: 'base',
  output: 'text',
}
const fixturePath = new URL(
  '../fixtures/firewall/azure-policy-hierarchy.sanitized.json',
  import.meta.url,
).pathname
const scope =
  '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/firewall-fixture/providers/Microsoft.Network'
const helperPath = new URL('../../public/cloud-shell/export-firewall.sh', import.meta.url).pathname
const scratchPaths: string[] = []

function buildCommand(settings: FirewallExportCommandOptions): string {
  return createFirewallExportCommand(settings, revision)
}

function cliBoundary() {
  const directory = execFileSync('mktemp', ['-d', '-p', '/tmp', 'azureargus-export-test.XXXXXX'], {
    encoding: 'utf8',
  }).trim()
  scratchPaths.push(directory)
  const executable = join(directory, 'az')
  writeFileSync(
    executable,
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
const resources = JSON.parse(fs.readFileSync(process.env.EXPORT_FIXTURE, 'utf8')).resources;
resources.push({ id: '${scope}/azureFirewalls/workload-fw', name: 'workload-fw', type: 'Microsoft.Network/azureFirewalls', properties: { firewallPolicy: { id: '${scope}/firewallPolicies/workload' } } });
resources.push({ id: '${scope}/firewallPolicies/empty', name: 'empty', type: 'Microsoft.Network/firewallPolicies', properties: { ruleCollectionGroups: [], childPolicies: [] } });
if (process.env.EXPORT_AMBIGUOUS) { const base=resources.find(resource => resource.name === 'base'); resources.push({ ...base, id: base.id.replace('/resourceGroups/firewall-fixture/', '/resourceGroups/other-group/') }); }
if (process.env.EXPORT_LARGE_GROUP) { const group=resources.find(resource => resource.type.toLowerCase().endsWith('/rulecollectiongroups')); const collection=group.properties.ruleCollections[0]; const rule=collection.rules[0]; collection.rules=Array.from({length:1000},(_,index)=>({...rule,name:'large-export-rule-'+index})); }
fs.appendFileSync(process.env.EXPORT_REQUESTS, JSON.stringify(args) + '\\n');
if (args[0] !== 'resource') process.exit(2);
if (args[1] === 'list') {
  const name = option('--name');
  const type = option('--resource-type').toLowerCase();
  const matches = resources.filter(resource => resource.type.toLowerCase() === type && (resource.name === 'base' && process.env.EXPORT_ALIAS ? process.env.EXPORT_ALIAS : resource.name).toLowerCase() === name.toLowerCase());
  process.stdout.write(matches.map(resource => resource.id).join('\\n'));
} else if (args[1] === 'show') {
  const start = args.indexOf('--ids') + 1;
  const ids = args.slice(start, args.indexOf('--api-version')).map(id => id.toLowerCase());
  if (process.env.EXPORT_DENY_GROUPS && ids.some(id => id.includes('/rulecollectiongroups/'))) { process.stderr.write('Access denied'); process.exit(1); }
  const matches = ids.map(id => resources.find(resource => resource.id.toLowerCase() === id));
  if (matches.some(resource => !resource)) process.exit(3);
  process.stdout.write(JSON.stringify(matches.length === 1 ? matches[0] : matches));
} else process.exit(2);
`,
  )
  chmodSync(executable, 0o700)
  const curl = join(directory, 'curl')
  writeFileSync(
    curl,
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (process.env.EXPORT_DOWNLOAD_FAIL) { process.stderr.write('Download failed'); process.exit(22); }
if (args[1] !== 'https://raw.githubusercontent.com/Visorian/azureargus/${revision}/public/cloud-shell/export-firewall.sh') process.exit(2);
fs.copyFileSync(process.env.EXPORT_HELPER, args[args.indexOf('-o') + 1]);
`,
  )
  chmodSync(curl, 0o700)
  return {
    directory,
    env: {
      ...process.env,
      PATH: `${directory}:${process.env['PATH'] ?? ''}`,
      EXPORT_FIXTURE: fixturePath,
      EXPORT_HELPER: helperPath,
      EXPORT_POWERSHELL_HELPER: new URL(
        '../../public/cloud-shell/export-firewall.ps1',
        import.meta.url,
      ).pathname,
      EXPORT_REQUESTS: join(directory, 'requests.jsonl'),
    },
  }
}

afterEach(() => {
  for (const path of scratchPaths.splice(0)) {
    rmSync(path, { recursive: true })
  }
})

const powershellSetup = `
$ErrorActionPreference = 'Stop'
function Invoke-WebRequest {
  param($Uri, $OutFile, $ErrorAction)
  if ($Uri -ne 'https://raw.githubusercontent.com/Visorian/azureargus/${revision}/public/cloud-shell/export-firewall.ps1') { throw 'Unexpected download URL' }
  Copy-Item -LiteralPath $env:EXPORT_POWERSHELL_HELPER -Destination $OutFile
}
$global:azureArgusTestSubscription = 'original'
$global:azureArgusTestContextName = 'original-context'
function Get-AzContext { [pscustomobject]@{Subscription=$global:azureArgusTestSubscription; Name=$global:azureArgusTestContextName} }
function Set-AzContext {
  param($Subscription, $Scope)
  $global:azureArgusTestSubscription = $Subscription
  $global:azureArgusTestContextName = 'default-context'
}
function Select-AzContext {
  param($Name, $Scope)
  if ($Name -ne 'original-context') { throw 'Unknown context' }
  $global:azureArgusTestSubscription = 'original'
  $global:azureArgusTestContextName = $Name
}
function Get-AzResource {
  param($ResourceType, $Name, $ResourceId, $ApiVersion, [switch]$ExpandProperties)
  $resources = (Get-Content -Raw -LiteralPath $env:EXPORT_FIXTURE | ConvertFrom-Json).resources
  if ($env:EXPORT_DENY_GROUPS -and $ResourceId -like '*/ruleCollectionGroups/*') { throw 'Access denied' }
  $selected = if ($ResourceId) {
    if ($ApiVersion -ne '2026-03-01' -or -not $ExpandProperties) { throw 'Expected full resource properties' }
    $resources | Where-Object { $_.id -eq $ResourceId }
  } else {
    $resources | Where-Object { $_.type -eq $ResourceType -and $_.name -eq $Name }
  }
  foreach ($resource in $selected) {
    [pscustomobject]@{ ResourceId=$resource.id; Name=$resource.name; ResourceType=$resource.type; Properties=$resource.properties }
  }
}
`

function runPowerShell(
  boundary: ReturnType<typeof cliBoundary>,
  body: string,
  env: NodeJS.ProcessEnv = {},
) {
  return spawnSync(
    'pwsh',
    ['-NoProfile', '-NonInteractive', '-Command', `${powershellSetup}\n${body}`],
    {
      cwd: boundary.directory,
      env: { ...boundary.env, ...env },
      encoding: 'utf8',
    },
  )
}

it('requires an exact target and a published source revision', () => {
  expect(buildCommand({ ...options, policyName: ' ' })).toBe('')
  expect(buildCommand({ ...options, policyName: '*' })).toBe('')
  expect(buildCommand({ ...options, firewallName: '*' })).toBe('')
  expect(createFirewallExportCommand(options, undefined)).toBe('')
  expect(createFirewallExportCommand(options, 'main')).toBe('')
})

it.each(environments)(
  'provides a readable %s snippet only for an exact selection and published revision',
  (environment) => {
    const settings = { ...options, environment }
    for (const output of ['text', 'file'] as const) {
      const snippet = buildCommand({ ...settings, output })
      const lines = snippet.split('\n')
      expect(lines.length).toBeGreaterThanOrEqual(3)
      expect(lines.length).toBeLessThanOrEqual(5)
      expect(lines.every((line) => line.length < 200)).toBe(true)
      expect(snippet).toContain(`/azureargus/${revision}/public/cloud-shell`)
      expect(snippet.includes('firewall-configuration.json')).toBe(output === 'file')
      expect(snippet.includes('-UseAzureCli')).toBe(environment === 'powershell-cli')
    }
    expect(buildCommand({ ...settings, policyName: '', firewallName: 'workload-fw' })).not.toBe('')
  },
)

it.each([
  {
    name: 'a base policy and all children',
    policyName: 'base',
    firewallName: '',
    policies: ['base', 'regional', 'sibling', 'workload'],
    ipGroups: ['clients', 'empty-clients', 'regional-clients', 'services'],
  },
  {
    name: 'a child and its base without siblings',
    policyName: 'workload',
    firewallName: '',
    policies: ['base', 'workload'],
    ipGroups: ['clients', 'empty-clients', 'services'],
  },
  {
    name: 'a firewall policy chain',
    policyName: '',
    firewallName: 'workload-fw',
    policies: ['base', 'workload'],
    ipGroups: ['clients', 'empty-clients', 'services'],
  },
  {
    name: 'combined firewall and policy selections',
    policyName: 'regional',
    firewallName: 'workload-fw',
    policies: ['base', 'regional', 'workload'],
    ipGroups: ['clients', 'empty-clients', 'regional-clients', 'services'],
  },
  {
    name: 'a policy with no rule collections or IP groups',
    policyName: 'empty',
    firewallName: '',
    policies: ['empty'],
    ipGroups: [],
  },
])('exports $name through the real Bash command', (scenario) => {
  const boundary = cliBoundary()
  const command = buildCommand({
    ...options,
    policyName: scenario.policyName,
    firewallName: scenario.firewallName,
  })
  const exported = spawnSync('bash', ['-c', command], {
    cwd: boundary.directory,
    env: boundary.env,
    encoding: 'utf8',
  })
  expect(exported.stderr).toBe('')
  expect(exported.status).toBe(0)
  const snapshot = parseFirewallSnapshot(exported.stdout)
  expect(snapshot.policies.map((policy) => policy.name).toSorted()).toStrictEqual(scenario.policies)
  expect(snapshot.policies.every((policy) => policy.groupsComplete)).toBe(true)
  expect(snapshot.ipGroups.map((group) => group.name).toSorted()).toStrictEqual(scenario.ipGroups)
})

it('passes quoted names as data without evaluating shell expressions', () => {
  const boundary = cliBoundary()
  const name = "base'$(touch injected)'\nline"
  const command = buildCommand({ ...options, policyName: name })
  const exported = spawnSync('bash', ['-c', command], {
    cwd: boundary.directory,
    env: { ...boundary.env, EXPORT_ALIAS: name },
    encoding: 'utf8',
  })
  expect(existsSync(join(boundary.directory, 'injected'))).toBe(false)
  expect(exported.status).toBe(0)
  const requests = readFileSync(boundary.env.EXPORT_REQUESTS, 'utf8')
  expect(requests).toContain(JSON.stringify(name))
})

it('exports collection groups larger than the operating system argument limit', () => {
  const boundary = cliBoundary()
  const exported = spawnSync('bash', ['-c', buildCommand(options)], {
    cwd: boundary.directory,
    env: { ...boundary.env, EXPORT_LARGE_GROUP: '1' },
    encoding: 'utf8',
  })
  expect(exported.status).toBe(0)
  expect(exported.stderr).toBe('')
  expect(Buffer.byteLength(exported.stdout)).toBeGreaterThan(128 * 1024)
  const snapshot = parseFirewallSnapshot(exported.stdout)
  expect(
    snapshot.policies
      .flatMap((policy) => policy.groups)
      .flatMap((group) => group.collections)
      .flatMap((collection) => collection.rules)
      .filter((rule) => rule.name.startsWith('large-export-rule-')),
  ).toHaveLength(1000)
})

it('rejects ambiguous names before exporting multiple policy roots', () => {
  const boundary = cliBoundary()
  const exported = spawnSync('bash', ['-c', buildCommand(options)], {
    cwd: boundary.directory,
    env: { ...boundary.env, EXPORT_AMBIGUOUS: '1' },
    encoding: 'utf8',
  })
  expect(exported.status).not.toBe(0)
  expect(exported.stdout).toBe('')
  expect(exported.stderr).toContain('Expected one policy')
})

it('buffers file output until success and preserves existing files', () => {
  const boundary = cliBoundary()
  const command = buildCommand({ ...options, output: 'file' })
  const file = join(boundary.directory, 'firewall-configuration.json')
  const failed = spawnSync('bash', ['-c', command], {
    cwd: boundary.directory,
    env: { ...boundary.env, EXPORT_DENY_GROUPS: '1' },
    encoding: 'utf8',
  })
  expect(failed.status).not.toBe(0)
  expect(failed.stderr).toContain('Access denied')
  expect(existsSync(file)).toBe(false)
  const success = spawnSync('bash', ['-c', command], {
    cwd: boundary.directory,
    env: boundary.env,
    encoding: 'utf8',
  })
  expect(success.status).toBe(0)
  expect(parseFirewallSnapshot(readFileSync(file, 'utf8')).policies).toHaveLength(4)
  writeFileSync(file, 'keep this file')
  const repeated = spawnSync('bash', ['-c', command], {
    cwd: boundary.directory,
    env: boundary.env,
    encoding: 'utf8',
  })
  expect(repeated.status).not.toBe(0)
  expect(readFileSync(file, 'utf8')).toBe('keep this file')
})

it.each(['azure-powershell', 'powershell-cli'] as const)(
  'downloads and runs the %s helper against its resource boundary',
  (environment) => {
    const boundary = cliBoundary()

    const exported = runPowerShell(
      boundary,
      `${buildCommand({ ...options, environment })}
if ((Get-AzContext).Subscription -ne 'original' -or (Get-AzContext).Name -ne 'original-context') { throw 'Original context was not restored' }`,
    )
    expect(exported.status).toBe(0)
    expect(existsSync(boundary.env.EXPORT_REQUESTS)).toBe(environment === 'powershell-cli')
    const snapshot = parseFirewallSnapshot(exported.stdout)
    expect(snapshot.policies.map((policy) => policy.name).toSorted()).toStrictEqual([
      'base',
      'regional',
      'sibling',
      'workload',
    ])
    expect(snapshot.policies.every((policy) => policy.groupsComplete)).toBe(true)
    expect(snapshot.ipGroups.map((group) => group.name).toSorted()).toStrictEqual([
      'clients',
      'empty-clients',
      'regional-clients',
      'services',
    ])
  },
)

it('passes PowerShell quote delimiters and expressions as literal argument data', () => {
  const boundary = cliBoundary()
  const name = "base'’; $(New-Item injected); ‘suffix\nline"
  const exported = runPowerShell(
    boundary,
    buildCommand({ ...options, environment: 'powershell-cli', policyName: name }),
    { EXPORT_ALIAS: name },
  )
  expect(existsSync(join(boundary.directory, 'injected'))).toBe(false)
  expect(exported.status).toBe(0)
  expect(readFileSync(boundary.env.EXPORT_REQUESTS, 'utf8')).toContain(JSON.stringify(name))
})

it('restores the original PowerShell context after an Azure read fails', () => {
  const boundary = cliBoundary()
  const exported = runPowerShell(
    boundary,
    `
try {
  ${buildCommand({ ...options, environment: 'azure-powershell' })}
  throw 'Expected the Azure read to fail'
} catch {
  if ($_.Exception.Message -notmatch 'Access denied') { throw }
}
if ((Get-AzContext).Subscription -ne 'original' -or (Get-AzContext).Name -ne 'original-context') { throw 'Original context was not restored' }
`,
    { EXPORT_DENY_GROUPS: '1' },
  )
  expect(exported.status).toBe(0)
  expect(exported.stdout).toBe('')
})

it('does not run a stale helper when the download fails', () => {
  const boundary = cliBoundary()
  writeFileSync(join(boundary.directory, 'azureargus-export.sh'), 'touch stale-helper-ran')
  const failed = spawnSync('bash', ['-c', buildCommand(options)], {
    cwd: boundary.directory,
    env: { ...boundary.env, EXPORT_DOWNLOAD_FAIL: '1' },
    encoding: 'utf8',
  })
  expect(failed.status).not.toBe(0)
  expect(failed.stderr).toContain('Download failed')
  expect(existsSync(join(boundary.directory, 'stale-helper-ran'))).toBe(false)
  expect(existsSync(boundary.env.EXPORT_REQUESTS)).toBe(false)
})
