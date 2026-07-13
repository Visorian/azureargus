import type { DeploymentCapabilities } from "#shared/types/deploymentCapabilities";

type CapabilityStatus = "idle" | "loading" | "ready" | "error";

let pendingLoad: Promise<DeploymentCapabilities> | null = null;

export function useDeploymentCapabilities() {
  const capabilities = useState<DeploymentCapabilities | null>(
    "deployment-capabilities",
    () => null,
  );
  const status = useState<CapabilityStatus>("deployment-capabilities-status", () => "idle");
  const lastError = useState<string | null>("deployment-capabilities-error", () => null);
  const requestFetch = useRequestFetch();

  async function load(force = false) {
    if (!force && capabilities.value !== null) {
      return capabilities.value;
    }
    if (!force && pendingLoad !== null) {
      return pendingLoad;
    }

    status.value = "loading";
    lastError.value = null;
    const current = requestFetch<DeploymentCapabilities>("/api/capabilities", {
      headers: { accept: "application/json" },
    })
      .then((value) => {
        capabilities.value = value;
        status.value = "ready";
        return value;
      })
      .catch((error: unknown) => {
        capabilities.value = null;
        status.value = "error";
        lastError.value =
          error instanceof Error ? error.message : "Deployment configuration is unavailable";
        throw error;
      })
      .finally(() => {
        if (pendingLoad === current) {
          pendingLoad = null;
        }
      });
    pendingLoad = current;
    return current;
  }

  return {
    capabilities,
    lastError,
    load,
    status,
  };
}
