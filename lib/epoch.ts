// All Phase 6 evidence (market validation, activation gates, the public paper
// scoreboard) counts only rows created at or after this instant. Data written
// before it predates the trust fixes (canonical odds mapping, admin-locked
// writes, freeze windows) and is shown as "pre-epoch · not evidence".
// Finalize this to the deploy date of the trust-remediation release.
export const VALIDATION_EPOCH = "2026-08-12T00:00:00Z";

export const postEpoch = (iso: string | null | undefined) => Boolean(iso && iso >= VALIDATION_EPOCH);
