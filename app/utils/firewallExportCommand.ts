import { AZURE_FIREWALL_API_VERSION } from '#shared/utils/azureFirewallReader'

export interface FirewallExportCommandOptions {
  subscription: string
  resourceGroup: string
  firewallName: string
  policyName: string
  output: 'file' | 'text'
}

function nuLiteral(value: string): string {
  let delimiter = '#'
  while (value.includes(`'${delimiter}`)) {
    delimiter += '#'
  }
  return `r${delimiter}'${value}'${delimiter}`
}

export function createFirewallExportCommand(options: FirewallExportCommandOptions): string {
  const command = `do {
  let subscription = ${nuLiteral(options.subscription.trim())}
  let resource_group = ${nuLiteral(options.resourceGroup.trim())}
  let firewall_name = ${nuLiteral(options.firewallName.trim())}
  let policy_name = ${nuLiteral(options.policyName.trim())}

  def az-json [args: list<string>] {
    let result = (^az ...$args --only-show-errors --output json | complete)
    if $result.exit_code != 0 { error make {msg: $result.stderr} }
    $result.stdout | from json
  }
  def read-arm [url: string] {
    if not ($url | str starts-with 'https://management.azure.com/') {
      error make {msg: 'Refusing a URL outside Azure Resource Manager.'}
    }
    let target_subscription = ($url | url parse | get path | split row '/' | get 2)
    az-json [rest --subscription $target_subscription --method get --url $url]
  }
  def read-resource [id: string] {
    read-arm $'https://management.azure.com($id)?api-version=${AZURE_FIREWALL_API_VERSION}'
  }
  def read-pages [initial: string] {
    mut url = $initial
    mut values = []
    mut seen = []
    while $url != '' {
      if $url in $seen { error make {msg: 'Azure returned repeated pagination.'} }
      $seen = ($seen | append $url)
      let page = (read-arm $url)
      $values = ($values | append $page.value)
      $url = ($page.nextLink? | default '')
    }
    $values
  }
  def select-resources [items: list, name: string] {
    $items | where {|item|
      $name == '' or ($item.name | str lowercase) == ($name | str lowercase)
    }
  }

  let account_args = (if $subscription == '' { [account show] } else { [account show --subscription $subscription] })
  let account = (az-json $account_args)
  let group_path = (if $resource_group == '' { '' } else { $'/resourceGroups/($resource_group | url encode --all)' })
  let scope = $'/subscriptions/($account.id)($group_path)/providers/Microsoft.Network'
  mut pending = []
  if $policy_name != '' or $firewall_name == '' {
    let policies = (read-pages $'https://management.azure.com($scope)/firewallPolicies?api-version=${AZURE_FIREWALL_API_VERSION}')
    let matches = (select-resources $policies $policy_name)
    if $policy_name != '' and ($matches | is-empty) { error make {msg: 'No policy matched the supplied name and resource group.'} }
    $pending = ($matches | each {|policy| $policy.id })
  }
  if $firewall_name != '' {
    let firewalls = (read-pages $'https://management.azure.com($scope)/azureFirewalls?api-version=${AZURE_FIREWALL_API_VERSION}')
    let matches = (select-resources $firewalls $firewall_name)
    if ($matches | is-empty) { error make {msg: 'No firewall matched the supplied name and resource group.'} }
    for firewall in $matches {
      let policy_id = ($firewall.properties.firewallPolicy?.id? | default '')
      if $policy_id == '' { error make {msg: 'The selected firewall uses classic rules. Select a policy-backed firewall.'} }
      $pending = ($pending | append $policy_id)
    }
  }
  if ($pending | is-empty) { error make {msg: 'No firewall policies found in the selected subscription and resource group.'} }

  mut resources = []
  mut loaded = []
  mut ip_groups = []
  while not ($pending | is-empty) {
    let id = ($pending | first)
    $pending = ($pending | skip 1)
    let key = ($id | str lowercase)
    if $key in $loaded { continue }
    let policy = (read-resource $id)
    let groups = (read-pages $'https://management.azure.com($id)/ruleCollectionGroups?api-version=${AZURE_FIREWALL_API_VERSION}')
    let group_ids = ($groups | each {|group| $group.id | str lowercase })
    for reference in ($policy.properties.ruleCollectionGroups? | default []) {
      if ($reference.id | str lowercase) not-in $group_ids { error make {msg: 'A policy collection group is missing. Retry after policy updates finish.'} }
    }
    $resources = ($resources | append ($policy | upsert properties.ruleCollectionGroups ($groups | each {|group| {id: $group.id} })) | append $groups)
    $loaded = ($loaded | append $key)
    let parent = ($policy.properties.basePolicy?.id? | default '')
    if $parent != '' { $pending = ($pending | append $parent) }
    for group in $groups {
      for collection in $group.properties.ruleCollections {
        for rule in $collection.rules {
          $ip_groups = ($ip_groups | append ($rule.sourceIpGroups? | default []) | append ($rule.destinationIpGroups? | default []))
        }
      }
    }
  }
  for id in ($ip_groups | each {|id| $id | str lowercase } | uniq) {
    $resources = ($resources | append (read-resource $id))
  }
  {resources: $resources} | to json --indent 2
}`
  return options.output === 'file' ? `${command} | save 'firewall-configuration.json'` : command
}
