// ============================================================
// ProofLayer SDK — Scoring Engine
// Computes multi-dimensional trust scores from behavioral data.
// Can run locally (offline mode) or defer to the backend API.
// ============================================================

import type {
  TrustScore,
  ScoringWeights,
  BehavioralSnapshot,
  ScoreTier,
} from "../types/index.js";
import { SCORING_DEFAULTS, compositeToTier, now } from "../utils/index.js";

/**
 * Accumulated state the scoring engine uses across snapshots.
 * In production the backend maintains this; locally the SDK
 * keeps a running tally for offline/preview scores.
 */
export interface ScoringState {
  totalTransactions: number;
  totalSuccess: number;
  totalFailures: number;
  totalEscrowsCreated: number;
  totalEscrowsCompleted: number;
  totalEscrowsDisputed: number;
  avgResponseTimeMs: number;
  uptimeReadings: number[];
  uniqueInteractions: Set<string>;
  totalApiCalls: number;
  totalApiErrors: number;
  firstSeen: string;
  lastSeen: string;
  snapshotCount: number;
}

export class ScoringEngine {
  private weights: ScoringWeights;
  private state: ScoringState;

  constructor(weights?: Partial<ScoringWeights>) {
    this.weights = { ...SCORING_DEFAULTS, ...weights };
    this.state = this.emptyState();
  }

  // ── Ingest a snapshot and update running state ──────────

  ingest(snapshot: BehavioralSnapshot): void {
    const s = this.state;
    s.totalTransactions += snapshot.transactionCount;
    s.totalSuccess += snapshot.successCount;
    s.totalFailures += snapshot.failureCount;
    s.totalEscrowsCreated += snapshot.escrowsCreated;
    s.totalEscrowsCompleted += snapshot.escrowsCompleted;
    s.totalEscrowsDisputed += snapshot.escrowsDisputed;

    // Rolling average for response time
    if (snapshot.avgResponseTimeMs > 0) {
      s.avgResponseTimeMs =
        (s.avgResponseTimeMs * s.snapshotCount + snapshot.avgResponseTimeMs) /
        (s.snapshotCount + 1);
    }

    s.uptimeReadings.push(snapshot.uptimePercent);
    s.totalApiCalls += snapshot.apiCallCount;
    s.totalApiErrors += snapshot.apiErrorCount;

    // Track unique interactions from event metadata
    for (const event of snapshot.events) {
      const cp = event.metadata?.counterparty;
      if (typeof cp === "string") {
        s.uniqueInteractions.add(cp.toLowerCase());
      }
    }

    if (!s.firstSeen || snapshot.windowStart < s.firstSeen) {
      s.firstSeen = snapshot.windowStart;
    }
    s.lastSeen = snapshot.windowEnd;
    s.snapshotCount++;
  }

  // ── Compute the score ───────────────────────────────────

  compute(): TrustScore {
    const financial = this.scoreFinancial();
    const social = this.scoreSocial();
    const reliability = this.scoreReliability();
    const trust = this.scoreTrust();

    const composite = Math.round(
      financial * this.weights.financial +
        social * this.weights.social +
        reliability * this.weights.reliability +
        trust * this.weights.trust
    );

    return {
      financial: Math.round(financial),
      social: Math.round(social),
      reliability: Math.round(reliability),
      trust: Math.round(trust),
      composite: clamp(composite, 0, 100),
      computedAt: now(),
      dataPoints: this.state.totalTransactions + this.state.totalApiCalls,
    };
  }

  /** Get the current tier based on composite score */
  getTier(): ScoreTier {
    return compositeToTier(this.compute().composite);
  }

  /** Reset scoring state */
  reset(): void {
    this.state = this.emptyState();
  }

  /** Get total data points tracked */
  get dataPoints(): number {
    return this.state.totalTransactions + this.state.totalApiCalls;
  }

  // ── Axis Scoring Functions ──────────────────────────────

  private scoreFinancial(): number {
    const s = this.state;
    if (s.totalTransactions === 0) return 0;

    // Success rate (0-40 pts)
    const successRate = s.totalSuccess / s.totalTransactions;
    const successScore = successRate * 40;

    // Escrow completion rate (0-30 pts)
    let escrowScore = 0;
    if (s.totalEscrowsCreated > 0) {
      const completionRate = s.totalEscrowsCompleted / s.totalEscrowsCreated;
      const disputeRate = s.totalEscrowsDisputed / s.totalEscrowsCreated;
      escrowScore = completionRate * 30 - disputeRate * 15;
    }

    // Volume consistency — more transactions = more trustworthy, with diminishing returns
    // log2 scale: 1 tx = 0, 8 tx = 15, 64 tx = 30, 1024 = 50 (capped)
    const volumeScore = Math.min(30, Math.log2(s.totalTransactions + 1) * 5);

    return clamp(successScore + escrowScore + volumeScore, 0, 100);
  }

  private scoreSocial(): number {
    const s = this.state;

    // Unique interaction count (0-60 pts, log scale)
    const interactionScore = Math.min(
      60,
      Math.log2(s.uniqueInteractions.size + 1) * 12
    );

    // Snapshot count indicates sustained activity (0-40 pts)
    const activityScore = Math.min(40, Math.log2(s.snapshotCount + 1) * 8);

    return clamp(interactionScore + activityScore, 0, 100);
  }

  private scoreReliability(): number {
    const s = this.state;

    // Uptime (0-40 pts)
    let uptimeScore = 0;
    if (s.uptimeReadings.length > 0) {
      const avgUptime =
        s.uptimeReadings.reduce((a, b) => a + b, 0) / s.uptimeReadings.length;
      uptimeScore = (avgUptime / 100) * 40;
    }

    // Response time (0-30 pts) — under 200ms = full, over 5000ms = 0
    let responseScore = 0;
    if (s.avgResponseTimeMs > 0) {
      responseScore = Math.max(
        0,
        30 - (s.avgResponseTimeMs / 5000) * 30
      );
    }

    // API error rate (0-30 pts)
    let errorScore = 30;
    if (s.totalApiCalls > 0) {
      const errorRate = s.totalApiErrors / s.totalApiCalls;
      errorScore = (1 - errorRate) * 30;
    }

    return clamp(uptimeScore + responseScore + errorScore, 0, 100);
  }

  private scoreTrust(): number {
    const s = this.state;

    // History length — older = more trustworthy (0-40 pts)
    let ageScore = 0;
    if (s.firstSeen) {
      const ageMs = Date.now() - new Date(s.firstSeen).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      // 7 days = ~13pts, 30 days = ~25pts, 90 days = ~33pts, 365 days = ~40pts
      ageScore = Math.min(40, Math.log2(ageDays + 1) * 5);
    }

    // Consistency — low dispute ratio (0-30 pts)
    let consistencyScore = 30;
    if (s.totalEscrowsCreated > 0) {
      const disputeRatio = s.totalEscrowsDisputed / s.totalEscrowsCreated;
      consistencyScore = (1 - disputeRatio) * 30;
    }

    // Activity volume — sustained participation (0-30 pts)
    const participationScore = Math.min(
      30,
      Math.log2(s.snapshotCount + 1) * 6
    );

    return clamp(ageScore + consistencyScore + participationScore, 0, 100);
  }

  // ── Helpers ─────────────────────────────────────────────

  private emptyState(): ScoringState {
    return {
      totalTransactions: 0,
      totalSuccess: 0,
      totalFailures: 0,
      totalEscrowsCreated: 0,
      totalEscrowsCompleted: 0,
      totalEscrowsDisputed: 0,
      avgResponseTimeMs: 0,
      uptimeReadings: [],
      uniqueInteractions: new Set<string>(),
      totalApiCalls: 0,
      totalApiErrors: 0,
      firstSeen: "",
      lastSeen: "",
      snapshotCount: 0,
    };
  }
}

// ── Utility ───────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
