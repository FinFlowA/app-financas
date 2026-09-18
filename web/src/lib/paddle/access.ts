export function subscriptionGrantsPaidAccess(status: string | null | undefined) {
  return status === "active" || status === "trialing" || status === "grace_period";
}
