// ============================================================
// ProofLayer SDK — Utilities
// ============================================================

// ── Constants ───────────────────────────────────────────────

export const DEFAULTS = {
  API_URL: "https://api.prooflayer.net",
  FLUSH_INTERVAL_MS: 60_000,
  MAX_BUFFER_SIZE: 100,
  HEARTBEAT_INTERVAL_MS: 30_000,
  CHAIN_ID: 8453, // Base mainnet
  EAS_CONTRACT: "0x4200000000000000000000000000000000000021", // Base EAS
  EAS_SCHEMA_REGISTRY: "0x4200000000000000000000000000000000000020",
} as const;

export const SCORING_DEFAULTS = {
  financial: 0.30,
  social: 0.15,
  reliability: 0.30,
  trust: 0.25,
} as const;

export const TIER_THRESHOLDS = {
  Platinum: 90,
  Gold: 75,
  Silver: 55,
  Bronze: 30,
  Unverified: 0,
} as const;

// ProofLayer EAS schema — encodes all four score axes + metadata
export const PROOFLAYER_SCHEMA =
  "uint8 financial,uint8 social,uint8 reliability,uint8 trust,uint8 composite,uint64 dataPoints,uint64 computedAt,address agent";

// ── Logger ──────────────────────────────────────────────────

export class Logger {
  constructor(private enabled: boolean = false) {}

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  debug(msg: string, data?: unknown): void {
    if (!this.enabled) return;
    const ts = new Date().toISOString();
    console.error(`[ProofLayer][${ts}] DEBUG: ${msg}`, data ?? "");
  }

  info(msg: string, data?: unknown): void {
    if (!this.enabled) return;
    const ts = new Date().toISOString();
    console.error(`[ProofLayer][${ts}] INFO: ${msg}`, data ?? "");
  }

  warn(msg: string, data?: unknown): void {
    const ts = new Date().toISOString();
    console.error(`[ProofLayer][${ts}] WARN: ${msg}`, data ?? "");
  }

  error(msg: string, data?: unknown): void {
    const ts = new Date().toISOString();
    console.error(`[ProofLayer][${ts}] ERROR: ${msg}`, data ?? "");
  }
}

// ── Time Helpers ────────────────────────────────────────────

export function now(): string {
  return new Date().toISOString();
}

export function msAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

// ── Tier Calculation ────────────────────────────────────────

import type { ScoreTier } from "../types/index.js";

export function compositeToTier(composite: number): ScoreTier {
  if (composite >= TIER_THRESHOLDS.Platinum) return "Platinum";
  if (composite >= TIER_THRESHOLDS.Gold) return "Gold";
  if (composite >= TIER_THRESHOLDS.Silver) return "Silver";
  if (composite >= TIER_THRESHOLDS.Bronze) return "Bronze";
  return "Unverified";
}

// ── Safe JSON fetch wrapper ─────────────────────────────────

export async function apiFetch<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `ProofLayer API error ${res.status}: ${res.statusText}${body ? ` — ${body}` : ""}`
    );
  }

  return res.json() as Promise<T>;
}
