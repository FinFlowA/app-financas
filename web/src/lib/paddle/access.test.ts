import { describe, expect, it } from "vitest";
import { subscriptionGrantsPaidAccess } from "./access";

describe("subscriptionGrantsPaidAccess", () => {
  it.each(["active", "trialing", "grace_period"])("grants access for %s", (status) => {
    expect(subscriptionGrantsPaidAccess(status)).toBe(true);
  });

  it.each(["canceled", "cancelled", "paused", "past_due", null, undefined])(
    "does not grant access for %s",
    (status) => {
      expect(subscriptionGrantsPaidAccess(status)).toBe(false);
    },
  );
});
