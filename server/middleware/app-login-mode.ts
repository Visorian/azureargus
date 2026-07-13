import { createError, getRequestURL } from "h3";

import { parseDeploymentCapabilities } from "../utils/deploymentCapabilities";

const APP_LOGIN_PATH = /^\/auth\/entra\/(?:login|callback)\/?$/;

export default defineEventHandler((event) => {
  const pathname = getRequestURL(event).pathname;
  if (!APP_LOGIN_PATH.test(pathname)) {
    return;
  }

  const capabilities = parseDeploymentCapabilities(useRuntimeConfig(event), process.env);
  if (capabilities.mode === "managed") {
    return;
  }

  throw createError({
    statusCode: capabilities.mode === "invalid" ? 503 : 403,
    message:
      capabilities.mode === "invalid"
        ? "Deployment configuration is invalid"
        : "Application login is unavailable",
  });
});
