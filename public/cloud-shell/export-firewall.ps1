[CmdletBinding()]
param(
    [string]$PolicyName,
    [string]$FirewallName,
    [string]$Subscription,
    [string]$ResourceGroup,
    [string]$OutputFile,
    [switch]$UseAzureCli
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
if ([string]::IsNullOrWhiteSpace($PolicyName) -and [string]::IsNullOrWhiteSpace($FirewallName)) {
    throw 'Supply -PolicyName or -FirewallName with an exact name.'
}
if ("$PolicyName$FirewallName" -match '[*?\[\]]') {
    throw 'Wildcards are not supported. Supply exact firewall and policy names.'
}
if ($OutputFile -and (Test-Path -LiteralPath $OutputFile)) {
    throw "Output file already exists: $OutputFile"
}

$cliScope = @()
if ($Subscription) {
    if ($UseAzureCli) {
        $cliScope += @('--subscription', $Subscription)
    } else {
        Set-AzContext -Subscription $Subscription -Scope Process | Out-Null
    }
}
if ($ResourceGroup) {
    $cliScope += @('--resource-group', $ResourceGroup)
}

function Get-ExportResource([string[]]$Ids) {
    $Ids = @($Ids | Where-Object { $_ } | Sort-Object -Unique)
    if (-not $Ids.Count) { return }
    if ($UseAzureCli) {
        az resource show --ids $Ids --api-version 2026-03-01 -o json | ConvertFrom-Json
    } else {
        foreach ($id in $Ids) {
            $resource = Get-AzResource -ResourceId $id -ApiVersion '2026-03-01' -ExpandProperties
            @{
                id = $resource.ResourceId
                name = $resource.Name
                type = $resource.ResourceType
                properties = $resource.Properties
            }
        }
    }
}

function Find-ExportResource([string]$Type, [string]$Name) {
    if ($UseAzureCli) {
        az resource list --resource-type $Type --name $Name @cliScope --query '[].id' -o tsv
    } else {
        $parameters = @{ ResourceType = $Type; Name = $Name }
        if ($ResourceGroup) { $parameters.ResourceGroupName = $ResourceGroup }
        (Get-AzResource @parameters).ResourceId
    }
}

$policies = @()
if ($PolicyName) {
    $policies = @(Get-ExportResource (Find-ExportResource 'Microsoft.Network/firewallPolicies' $PolicyName))
    if ($policies.Count -ne 1) {
        throw 'Expected one policy. Check the name and resource group.'
    }
    $policies = @(Get-ExportResource (@($policies.id) + @($policies.properties.childPolicies.id)))
}
if ($FirewallName) {
    $firewalls = @(Get-ExportResource (Find-ExportResource 'Microsoft.Network/azureFirewalls' $FirewallName))
    if ($firewalls.Count -ne 1 -or @($firewalls | Where-Object { -not $_.properties.firewallPolicy.id }).Count) {
        throw 'Expected one policy-backed firewall. Check the name and resource group.'
    }
    $policies += @(Get-ExportResource $firewalls.properties.firewallPolicy.id)
}

$policies = (@($policies) + @(Get-ExportResource $policies.properties.basePolicy.id)) |
    Sort-Object -Property id -Unique
$groups = @(Get-ExportResource $policies.properties.ruleCollectionGroups.id)
$ips = @(Get-ExportResource (@($groups.properties.ruleCollections.rules.sourceIpGroups) +
    @($groups.properties.ruleCollections.rules.destinationIpGroups)))
$result = @{ resources = @((@($policies) + @($groups) + @($ips)) |
    Sort-Object -Property id -Unique) } | ConvertTo-Json -Depth 100
if ($OutputFile) {
    $result | Out-File -LiteralPath $OutputFile -Encoding utf8 -NoClobber
} else {
    $result
}
