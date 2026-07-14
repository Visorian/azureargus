import type {
  AzureAccessibleTenant,
  AzureAccessibleWorkspace,
  AzureLogAnalyticsAccess,
} from "../../shared/types/azureAccess";

const MANAGEMENT_ORIGIN = "https://management.azure.com";
const SUBSCRIPTIONS_API_VERSION = "2022-12-01";
const RESOURCE_GRAPH_API_VERSION = "2024-04-01";
const WORKSPACE_QUERY =
  "Resources | where type =~ 'microsoft.operationalinsights/workspaces' | project name, location, subscriptionId, resourceGroup, workspaceId=tostring(properties.customerId)";
const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

interface AzurePage {
  value: unknown[];
  nextLink?: string;
}

interface AzureSubscription {
  subscriptionId: string;
  displayName: string;
}

export class AzureResourceDiscoveryError extends Error {
  constructor(readonly status: number) {
    super("Azure resource discovery failed");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function validateManagementUrl(value: string) {
  const url = new URL(value);
  if (url.origin !== MANAGEMENT_ORIGIN || url.protocol !== "https:") {
    throw new AzureResourceDiscoveryError(502);
  }
  return url.toString();
}

async function readPage(
  url: string,
  accessToken: string,
  signal: AbortSignal,
  fetchImplementation: typeof fetch,
) {
  const response = await fetchImplementation(validateManagementUrl(url), {
    headers: { authorization: `Bearer ${accessToken}` },
    signal,
  });
  if (!response.ok) {
    throw new AzureResourceDiscoveryError(response.status);
  }

  const value: unknown = await response.json();
  if (!isRecord(value) || !Array.isArray(value.value)) {
    throw new AzureResourceDiscoveryError(502);
  }
  const nextLink = readString(value.nextLink) ?? undefined;
  return { nextLink, value: value.value } satisfies AzurePage;
}

async function readAllPages(
  initialUrl: string,
  accessToken: string,
  signal: AbortSignal,
  fetchImplementation: typeof fetch,
) {
  const values: unknown[] = [];
  const seenUrls = new Set<string>();
  let url: string | undefined = initialUrl;
  while (url !== undefined) {
    if (seenUrls.has(url)) {
      throw new AzureResourceDiscoveryError(502);
    }
    seenUrls.add(url);
    const page = await readPage(url, accessToken, signal, fetchImplementation);
    values.push(...page.value);
    url = page.nextLink;
  }
  return values;
}

function parseTenants(values: unknown[]) {
  const tenants = new Map<string, AzureAccessibleTenant>();
  for (const value of values) {
    if (!isRecord(value)) {
      continue;
    }
    const tenantId = readString(value.tenantId);
    if (!tenantId || !UUID_PATTERN.test(tenantId)) {
      continue;
    }
    const displayName = readString(value.displayName)?.trim() || tenantId;
    tenants.set(tenantId, {
      defaultDomain: readString(value.defaultDomain),
      displayName,
      tenantId,
    });
  }
  return [...tenants.values()].toSorted((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

function parseSubscriptions(values: unknown[]) {
  const subscriptions = new Map<string, AzureSubscription>();
  for (const value of values) {
    if (!isRecord(value)) {
      continue;
    }
    const subscriptionId = readString(value.subscriptionId);
    if (!subscriptionId || !UUID_PATTERN.test(subscriptionId)) {
      continue;
    }
    subscriptions.set(subscriptionId, {
      displayName: readString(value.displayName)?.trim() || subscriptionId,
      subscriptionId,
    });
  }
  return [...subscriptions.values()];
}

function parseWorkspaces(values: unknown[], subscriptions: ReadonlyMap<string, AzureSubscription>) {
  const workspaces: AzureAccessibleWorkspace[] = [];
  for (const value of values) {
    if (!isRecord(value)) {
      continue;
    }
    const workspaceId = readString(value.workspaceId);
    const name = readString(value.name);
    const subscriptionId = readString(value.subscriptionId);
    if (
      !workspaceId ||
      !UUID_PATTERN.test(workspaceId) ||
      !name ||
      !subscriptionId ||
      !UUID_PATTERN.test(subscriptionId)
    ) {
      continue;
    }
    const subscription = subscriptions.get(subscriptionId);
    workspaces.push({
      location: readString(value.location) ?? "",
      name,
      resourceGroup: readString(value.resourceGroup) ?? "",
      subscriptionId,
      subscriptionName: subscription?.displayName ?? subscriptionId,
      workspaceId,
    });
  }
  return workspaces;
}

async function readWorkspaceGraph(
  subscriptions: AzureSubscription[],
  accessToken: string,
  signal: AbortSignal,
  fetchImplementation: typeof fetch,
) {
  if (subscriptions.length === 0) {
    return [];
  }
  const subscriptionIds = subscriptions.map((subscription) => subscription.subscriptionId);
  const subscriptionMap = new Map(
    subscriptions.map((subscription) => [subscription.subscriptionId, subscription]),
  );
  const values: unknown[] = [];
  const seenSkipTokens = new Set<string>();
  let skipToken: string | undefined;
  do {
    const response = await fetchImplementation(
      `${MANAGEMENT_ORIGIN}/providers/Microsoft.ResourceGraph/resources?api-version=${RESOURCE_GRAPH_API_VERSION}`,
      {
        body: JSON.stringify({
          options: skipToken ? { $skipToken: skipToken } : undefined,
          query: WORKSPACE_QUERY,
          subscriptions: subscriptionIds,
        }),
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        method: "POST",
        signal,
      },
    );
    if (!response.ok) {
      throw new AzureResourceDiscoveryError(response.status);
    }
    const value: unknown = await response.json();
    if (!isRecord(value) || !Array.isArray(value.data)) {
      throw new AzureResourceDiscoveryError(502);
    }
    values.push(...value.data);
    skipToken = readString(value.$skipToken) ?? undefined;
    if (skipToken && seenSkipTokens.has(skipToken)) {
      throw new AzureResourceDiscoveryError(502);
    }
    if (skipToken) {
      seenSkipTokens.add(skipToken);
    }
  } while (skipToken !== undefined);

  return parseWorkspaces(values, subscriptionMap);
}

export async function discoverAzureLogAnalyticsAccess(
  accessToken: string,
  signal: AbortSignal,
  fetchImplementation: typeof fetch = fetch,
): Promise<AzureLogAnalyticsAccess> {
  const [tenantValues, subscriptionValues] = await Promise.all([
    readAllPages(
      `${MANAGEMENT_ORIGIN}/tenants?api-version=${SUBSCRIPTIONS_API_VERSION}`,
      accessToken,
      signal,
      fetchImplementation,
    ),
    readAllPages(
      `${MANAGEMENT_ORIGIN}/subscriptions?api-version=${SUBSCRIPTIONS_API_VERSION}`,
      accessToken,
      signal,
      fetchImplementation,
    ),
  ]);
  const subscriptions = parseSubscriptions(subscriptionValues);
  const discoveredWorkspaces = await readWorkspaceGraph(
    subscriptions,
    accessToken,
    signal,
    fetchImplementation,
  );
  const workspaces = new Map<string, AzureAccessibleWorkspace>();
  for (const workspace of discoveredWorkspaces) {
    workspaces.set(workspace.workspaceId, workspace);
  }

  return {
    tenants: parseTenants(tenantValues),
    workspaces: [...workspaces.values()].toSorted((left, right) =>
      left.name.localeCompare(right.name),
    ),
  };
}
