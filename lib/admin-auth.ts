const encode = (value: string) => new TextEncoder().encode(value);

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Guards write endpoints (manual odds capture, historical odds import) behind
 * the ADMIN_KEY environment secret. Comparison happens on SHA-256 digests so
 * the check is equal-length regardless of what the caller sends.
 */
export async function requireAdmin(request: Request): Promise<{ ok: true } | { ok: false; response: Response }> {
  const { env } = await import("cloudflare:workers");
  const expected = (env as unknown as Record<string, unknown>).ADMIN_KEY;
  if (typeof expected !== "string" || expected.length < 16) {
    return { ok: false, response: Response.json({ error: "Admin access is not configured on this deployment." }, { status: 503 }) };
  }
  const provided = request.headers.get("x-admin-key") ?? "";
  if (!provided || (await sha256Hex(provided)) !== (await sha256Hex(expected))) {
    return { ok: false, response: Response.json({ error: "A valid admin key is required for this action." }, { status: 401 }) };
  }
  return { ok: true };
}
