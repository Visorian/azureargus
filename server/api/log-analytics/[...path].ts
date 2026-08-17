import { createError } from "h3";

export default defineEventHandler(() => {
  throw createError({ statusCode: 404, message: "Log Analytics route not found" });
});
