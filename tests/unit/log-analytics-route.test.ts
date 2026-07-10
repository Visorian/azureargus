import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

import { createEvent, type H3Event } from "h3";
import { requireUserSession } from "nuxt-oidc-auth/runtime/server/utils/session.js";

import { LOG_ANALYSIS_ROLE } from "../../shared/types/logAnalytics";

vi.mock("nuxt-oidc-auth/runtime/server/utils/session.js", () => ({
  requireUserSession: vi.fn(),
}));

const config = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  clientId: "22222222-2222-2222-2222-222222222222",
  clientSecret: "secret",
  workspaceId: "33333333-3333-3333-3333-333333333333",
};
let runtimeConfig: { logAnalytics: typeof config };
let handler: (event: H3Event) => Promise<unknown>;

function createTestEvent() {
  const request = new IncomingMessage(new Socket());
  const response = new ServerResponse(request);
  return createEvent(request, response);
}

beforeAll(async () => {
  runtimeConfig = { logAnalytics: config };
  vi.stubGlobal("defineEventHandler", <T>(eventHandler: T) => eventHandler);
  vi.stubGlobal("useRuntimeConfig", () => runtimeConfig);
  handler = (await import("../../server/api/log-analytics/query.post")).default;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  runtimeConfig = { logAnalytics: config };
  vi.mocked(requireUserSession).mockReset();
});

describe("Log Analytics query route authorization", () => {
  it.each([
    ["wrong tenant", { tid: "another-tenant", roles: [LOG_ANALYSIS_ROLE] }],
    ["missing role", { tid: config.tenantId, roles: ["Other.Role"] }],
  ])("returns 403 for %s before reading query body", async (_label, claims) => {
    vi.mocked(requireUserSession).mockResolvedValue({ provider: "entra", claims });

    await expect(handler(createTestEvent())).rejects.toMatchObject({ statusCode: 403 });
  });

  it("returns 403 before exposing unrelated configuration failure", async () => {
    runtimeConfig = { logAnalytics: { ...config, clientSecret: "" } };
    vi.mocked(requireUserSession).mockResolvedValue({
      provider: "entra",
      claims: { tid: config.tenantId, roles: ["Other.Role"] },
    });

    await expect(handler(createTestEvent())).rejects.toMatchObject({ statusCode: 403 });
  });

  it("returns 503 for authorized session when private configuration is incomplete", async () => {
    runtimeConfig = { logAnalytics: { ...config, clientSecret: "" } };
    vi.mocked(requireUserSession).mockResolvedValue({
      provider: "entra",
      claims: { tid: config.tenantId, roles: [LOG_ANALYSIS_ROLE] },
    });

    await expect(handler(createTestEvent())).rejects.toMatchObject({ statusCode: 503 });
  });
});
