import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

import { createEvent, type H3Event } from "h3";

import {
  AzureResourceDiscoveryError,
  discoverAzureLogAnalyticsAccess,
} from "../../server/utils/azureResourceDiscovery";

vi.mock("../../server/utils/azureResourceDiscovery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/utils/azureResourceDiscovery")>()),
  discoverAzureLogAnalyticsAccess:
    vi.fn<
      typeof import("../../server/utils/azureResourceDiscovery").discoverAzureLogAnalyticsAccess
    >(),
}));

const delegatedConfig = {
  public: {
    logAnalyticsDelegated: {
      clientId: "11111111-1111-4111-8111-111111111111",
    },
  },
};
let runtimeConfig: Record<string, unknown>;
let handler: (event: H3Event) => Promise<unknown>;

function createTestEvent(authorization = "Bearer management-token") {
  const request = new IncomingMessage(new Socket());
  const response = new ServerResponse(request);
  request.method = "GET";
  request.headers.authorization = authorization;
  request.push(null);
  return createEvent(request, response);
}

beforeAll(async () => {
  vi.stubGlobal("defineEventHandler", <T>(eventHandler: T) => eventHandler);
  vi.stubGlobal("useRuntimeConfig", () => runtimeConfig);
  handler = (await import("../../server/api/log-analytics/delegated-access.get")).default;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  runtimeConfig = delegatedConfig;
  vi.mocked(discoverAzureLogAnalyticsAccess).mockReset().mockResolvedValue({
    tenants: [],
    workspaces: [],
  });
});

describe("delegated Azure access discovery route", () => {
  it("forwards only bearer token and request cancellation", async () => {
    await expect(handler(createTestEvent())).resolves.toEqual({ tenants: [], workspaces: [] });

    expect(discoverAzureLogAnalyticsAccess).toHaveBeenCalledWith(
      "management-token",
      expect.any(AbortSignal),
    );
  });

  it("rejects missing authorization and unavailable delegated mode", async () => {
    await expect(handler(createTestEvent(""))).rejects.toMatchObject({ statusCode: 401 });

    runtimeConfig = {};
    await expect(handler(createTestEvent())).rejects.toMatchObject({ statusCode: 403 });
    expect(discoverAzureLogAnalyticsAccess).not.toHaveBeenCalled();
  });

  it.each([
    [401, 403],
    [403, 403],
    [429, 429],
    [500, 502],
  ])("maps ARM status %i to safe status %i", async (upstreamStatus, statusCode) => {
    vi.mocked(discoverAzureLogAnalyticsAccess).mockRejectedValueOnce(
      new AzureResourceDiscoveryError(upstreamStatus),
    );

    await expect(handler(createTestEvent())).rejects.toMatchObject({ statusCode });
  });
});
