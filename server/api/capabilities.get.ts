import { setResponseHeader } from "h3";

import { parseDeploymentCapabilities } from "../utils/deploymentCapabilities";

export default defineEventHandler((event) => {
  setResponseHeader(event, "cache-control", "no-store");
  return parseDeploymentCapabilities(useRuntimeConfig(event), process.env);
});
