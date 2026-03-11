// ============================================================
// ProofLayer SDK — API Client
// Queries the ProofLayer backend for scores, report cards,
// and manages agent registration.
// ============================================================

import type {
  ReportCard,
  TrustScore,
  ApiResponse,
  AttestationResult,
} from "../types/index.js";
import { Logger, apiFetch } from "../utils/index.js";

export interface ApiClientOptions {
  apiUrl: string;
  apiKey?: string;
  walletAddress: string;
  logger: Logger;
}

export class ApiClient {
  constructor(private opts: ApiClientOptions) {}

  private get headers(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.opts.apiKey) {
      h["Authorization"] = `Bearer ${this.opts.apiKey}`;
    }
    h["X-Agent-Wallet"] = this.opts.walletAddress;
    return h;
  }

  // ── Registration ────────────────────────────────────────

  /**
   * Register the agent with ProofLayer.
   * Idempotent — calling multiple times is safe.
   */
  async register(meta?: Record<string, unknown>): Promise<boolean> {
    try {
      const result = await apiFetch<ApiResponse<{ registered: boolean }>>(
        `${this.opts.apiUrl}/v1/agents/register`,
        {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify({
            walletAddress: this.opts.walletAddress,
            sdkVersion: "0.1.0",
            ...meta,
          }),
        }
      );
      this.opts.logger.info("Agent registered", result.data);
      return result.success;
    } catch (err) {
      this.opts.logger.error("Registration failed", err);
      return false;
    }
  }

  // ── Score Queries ───────────────────────────────────────

  /** Get the trust score for any wallet address */
  async getScore(walletAddress?: string): Promise<TrustScore | null> {
    const addr = walletAddress ?? this.opts.walletAddress;
    try {
      const result = await apiFetch<ApiResponse<TrustScore>>(
        `${this.opts.apiUrl}/v1/score/${addr}`,
        { headers: this.headers }
      );
      return result.data ?? null;
    } catch (err) {
      this.opts.logger.error(`Failed to fetch score for ${addr}`, err);
      return null;
    }
  }

  /** Get the full report card for any wallet address */
  async getReportCard(walletAddress?: string): Promise<ReportCard | null> {
    const addr = walletAddress ?? this.opts.walletAddress;
    try {
      const result = await apiFetch<ApiResponse<ReportCard>>(
        `${this.opts.apiUrl}/v1/report/${addr}`,
        { headers: this.headers }
      );
      return result.data ?? null;
    } catch (err) {
      this.opts.logger.error(`Failed to fetch report card for ${addr}`, err);
      return null;
    }
  }

  // ── Attestation (Server-Side) ───────────────────────────

  /**
   * Request the ProofLayer backend to create an on-chain attestation.
   * This is the recommended path — avoids needing a private key in the SDK.
   */
  async requestAttestation(): Promise<AttestationResult | null> {
    try {
      const result = await apiFetch<ApiResponse<AttestationResult>>(
        `${this.opts.apiUrl}/v1/attestations/create`,
        {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify({
            walletAddress: this.opts.walletAddress,
          }),
        }
      );
      return result.data ?? null;
    } catch (err) {
      this.opts.logger.error("Attestation request failed", err);
      return null;
    }
  }

  // ── Badge Verification ──────────────────────────────────

  /** Check if a wallet has a verified badge */
  async isVerified(walletAddress?: string): Promise<boolean> {
    const addr = walletAddress ?? this.opts.walletAddress;
    try {
      const result = await apiFetch<ApiResponse<{ verified: boolean }>>(
        `${this.opts.apiUrl}/v1/badges/${addr}`,
        { headers: this.headers }
      );
      return result.data?.verified ?? false;
    } catch {
      return false;
    }
  }

  // ── Protocol API (for platforms querying trust) ─────────

  /**
   * Query whether an agent is trustworthy enough for a given operation.
   * Used by protocols/marketplaces before allowing transactions.
   *
   * @param walletAddress - The agent to check
   * @param minComposite - Minimum composite score required
   * @param context - Optional context like "escrow_10k" or "swap_execution"
   */
  async checkTrust(
    walletAddress: string,
    minComposite: number = 50,
    context?: string
  ): Promise<{
    allowed: boolean;
    score: number;
    tier: string;
    reason?: string;
  }> {
    try {
      const result = await apiFetch<
        ApiResponse<{
          allowed: boolean;
          score: number;
          tier: string;
          reason?: string;
        }>
      >(
        `${this.opts.apiUrl}/v1/trust/check`,
        {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify({
            walletAddress,
            minComposite,
            context,
          }),
        }
      );
      return (
        result.data ?? {
          allowed: false,
          score: 0,
          tier: "Unverified",
          reason: "Score unavailable",
        }
      );
    } catch {
      return {
        allowed: false,
        score: 0,
        tier: "Unverified",
        reason: "API unreachable",
      };
    }
  }
}
