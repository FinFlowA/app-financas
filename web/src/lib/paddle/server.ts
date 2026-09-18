import "server-only";
import { Environment, LogLevel, Paddle } from "@paddle/paddle-node-sdk";

export function getPaddleInstance() {
  const apiKey = process.env.PADDLE_API_KEY?.trim();
  const environment = process.env.NEXT_PUBLIC_PADDLE_ENV?.trim();
  if (!apiKey) throw new Error("PADDLE_API_KEY_MISSING");
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error("PADDLE_ENV_INVALID");
  }
  return new Paddle(apiKey, {
    environment: environment === "sandbox" ? Environment.sandbox : Environment.production,
    logLevel: LogLevel.error,
  });
}
