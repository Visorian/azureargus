#!/usr/bin/env bash
set -euo pipefail

policy=''
firewall=''
subscription=''
resource_group=''
output=''
while (( $# )); do
  if (( $# < 2 )); then
    printf 'Missing value for %s\n' "$1" >&2
    exit 1
  fi
  case "$1" in
    --policy) policy=$2 ;;
    --firewall) firewall=$2 ;;
    --subscription) subscription=$2 ;;
    --resource-group) resource_group=$2 ;;
    --output) output=$2 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 1 ;;
  esac
  shift 2
done

if [[ -z "${policy//[[:space:]]/}${firewall//[[:space:]]/}" ]]; then
  printf 'Supply --policy or --firewall with an exact name.\n' >&2
  exit 1
fi
if [[ "$policy$firewall" == *['*?[]']* ]]; then
  printf 'Wildcards are not supported. Supply exact firewall and policy names.\n' >&2
  exit 1
fi
if [[ -n "$output" && -e "$output" ]]; then
  printf 'Output file already exists: %s\n' "$output" >&2
  exit 1
fi

scope=()
[[ -z "$subscription" ]] || scope+=(--subscription "$subscription")
[[ -z "$resource_group" ]] || scope+=(--resource-group "$resource_group")

get_resources() {
  local id
  local ids=()
  while IFS= read -r id; do
    [[ -z "$id" ]] || ids+=("$id")
  done <<< "$1"
  if (( ${#ids[@]} )); then
    az resource show --ids "${ids[@]}" --api-version 2026-03-01 -o json |
      jq -c '[.] | flatten'
  else
    printf '[]'
  fi
}

policies='[]'
if [[ -n "$policy" ]]; then
  ids=$(az resource list --resource-type Microsoft.Network/firewallPolicies \
    --name "$policy" "${scope[@]}" --query '[].id' -o tsv)
  policies=$(get_resources "$ids")
  if [[ $(jq length <<< "$policies") -ne 1 ]]; then
    printf 'Expected one policy. Check the name and resource group.\n' >&2
    exit 1
  fi
  policies=$(get_resources "$(jq -r '.[] | .id, .properties.childPolicies[]?.id' <<< "$policies")")
fi

if [[ -n "$firewall" ]]; then
  ids=$(az resource list --resource-type Microsoft.Network/azureFirewalls \
    --name "$firewall" "${scope[@]}" --query '[].id' -o tsv)
  firewalls=$(get_resources "$ids")
  if ! jq -e 'length == 1 and all(.[]; .properties.firewallPolicy.id != null)' <<< "$firewalls" >/dev/null; then
    printf 'Expected one policy-backed firewall. Check the name and resource group.\n' >&2
    exit 1
  fi
  attached=$(get_resources "$(jq -r '.[].properties.firewallPolicy.id' <<< "$firewalls")")
  policies=$(jq -cs 'add' <<< "$policies"$'\n'"$attached")
fi

parents=$(get_resources "$(jq -r '.[].properties.basePolicy.id // empty' <<< "$policies")")
policies=$(jq -cs 'add | unique_by(.id | ascii_downcase)' <<< "$policies"$'\n'"$parents")
groups=$(get_resources "$(jq -r '.[].properties.ruleCollectionGroups[]?.id' <<< "$policies")")
ips=$(get_resources "$(jq -r '.[].properties.ruleCollections[]?.rules[]? | .sourceIpGroups[]?, .destinationIpGroups[]?' <<< "$groups" | sort -fu)")
result=$(printf '%s\n' "$policies" "$groups" "$ips" |
  jq -cs '{resources: (add | unique_by(.id | ascii_downcase))}')
if [[ -n "$output" ]]; then
  set -C
  printf '%s\n' "$result" > "$output"
else
  printf '%s\n' "$result"
fi
