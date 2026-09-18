import "server-only";

const PADDLE_IPS_URL = "https://api.paddle.com/ips";

type PaddleIpsResponse = { data?: { ipv4_cidrs?: unknown } };

function requestIp(request: Request): string | null {
  const value = request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-forwarded-for")
    ?? request.headers.get("x-real-ip");
  return value?.split(",")[0]?.trim() || null;
}

export async function verifyLivePaddleSource(request: Request): Promise<boolean> {
  if (process.env.NEXT_PUBLIC_PADDLE_ENV?.trim() !== "production") return true;
  const sourceIp = requestIp(request);
  const octets = sourceIp?.split(".") ?? [];
  if (octets.length !== 4 || octets.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;

  const response = await fetch(PADDLE_IPS_URL, { next: { revalidate: 3600 } });
  if (!response.ok) throw new Error("PADDLE_IP_LIST_UNAVAILABLE");
  const payload = await response.json() as PaddleIpsResponse;
  const cidrs = Array.isArray(payload.data?.ipv4_cidrs) ? payload.data.ipv4_cidrs : [];
  return cidrs.some((cidr) => typeof cidr === "string" && cidr === `${sourceIp}/32`);
}
