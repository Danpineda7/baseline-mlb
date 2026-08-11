export type SystemEventSeverity = "critical" | "warning" | "info";

/**
 * Durable record of operational failures that used to be silently swallowed
 * (forecast persistence, odds archival). Critical events feed the Phase 6
 * data-quality activation gate: evidence windows containing unresolved
 * critical events cannot activate.
 */
export async function logSystemEvent(kind: string, severity: SystemEventSeverity, detail: Record<string, unknown>) {
  try {
    const { env } = await import("cloudflare:workers");
    await env.DB.prepare("INSERT INTO system_events (id,kind,severity,detail_json,created_at) VALUES (?,?,?,?,?)")
      .bind(crypto.randomUUID(), kind, severity, JSON.stringify(detail), new Date().toISOString())
      .run();
  } catch {
    // The event log must never take down the request that reports into it.
  }
}
