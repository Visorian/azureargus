import type {
  DelegatedLogAnalyticsQueryRequest,
  LogAnalyticsQueryRequest,
} from "../../shared/types/logAnalytics";
import {
  validateDelegatedLogAnalyticsQueryRequest,
  validateLogAnalyticsQueryRequest,
} from "../../server/utils/logAnalyticsQuery";

function createRequest(): LogAnalyticsQueryRequest {
  return {
    from: "2026-07-10T10:00:00.000Z",
    to: "2026-07-10T10:15:00.000Z",
    filters: {
      search: "",
      category: "",
      action: "",
      protocol: "",
      source: "",
      destination: "",
    },
    sort: { key: "timestamp", direction: "desc" },
  };
}

describe("Log Analytics request contract", () => {
  it("accepts the strict request shape", () => {
    expect(validateLogAnalyticsQueryRequest(createRequest())).toBe(true);
  });

  it("rejects unknown and missing fields", () => {
    expect(validateLogAnalyticsQueryRequest({ ...createRequest(), workspaceId: "workspace" })).toBe(
      false,
    );

    const request = createRequest();
    expect(
      validateLogAnalyticsQueryRequest({
        ...request,
        filters: { ...request.filters, query: "arbitrary KQL" },
      }),
    ).toBe(false);

    const { sort: _sort, ...withoutSort } = request;
    expect(validateLogAnalyticsQueryRequest(withoutSort)).toBe(false);
  });

  it("rejects invalid or oversized ranges", () => {
    expect(
      validateLogAnalyticsQueryRequest({
        ...createRequest(),
        from: "2026-07-10T10:15:00.000Z",
      }),
    ).toBe(false);
    expect(
      validateLogAnalyticsQueryRequest({
        ...createRequest(),
        to: "2026-07-11T10:00:00.001Z",
      }),
    ).toBe(false);
    expect(validateLogAnalyticsQueryRequest({ ...createRequest(), from: "not-a-timestamp" })).toBe(
      false,
    );
  });

  it("rejects oversized filters and non-allowlisted sorts", () => {
    const request = createRequest();
    expect(
      validateLogAnalyticsQueryRequest({
        ...request,
        filters: { ...request.filters, search: "x".repeat(257) },
      }),
    ).toBe(false);
    expect(
      validateLogAnalyticsQueryRequest({
        ...request,
        sort: { key: "workspaceId", direction: "desc" },
      }),
    ).toBe(false);
    expect(
      validateLogAnalyticsQueryRequest({
        ...request,
        sort: { key: "timestamp", direction: "sideways" },
      }),
    ).toBe(false);
  });
});

describe("delegated Log Analytics request contract", () => {
  function createDelegatedRequest(): DelegatedLogAnalyticsQueryRequest {
    return {
      ...createRequest(),
      workspaceId: "33333333-3333-3333-3333-333333333333",
    };
  }

  it("accepts a workspace ID plus the strict query shape", () => {
    expect(validateDelegatedLogAnalyticsQueryRequest(createDelegatedRequest())).toBe(true);
  });

  it.each(["", "workspace", "33333333-3333-3333-3333-33333333333z"])(
    "rejects invalid workspace ID %s",
    (workspaceId) => {
      expect(
        validateDelegatedLogAnalyticsQueryRequest({ ...createDelegatedRequest(), workspaceId }),
      ).toBe(false);
    },
  );

  it("rejects missing and unknown fields", () => {
    const { workspaceId: _workspaceId, ...withoutWorkspace } = createDelegatedRequest();
    expect(validateDelegatedLogAnalyticsQueryRequest(withoutWorkspace)).toBe(false);
    expect(
      validateDelegatedLogAnalyticsQueryRequest({ ...createDelegatedRequest(), token: "secret" }),
    ).toBe(false);
  });
});
