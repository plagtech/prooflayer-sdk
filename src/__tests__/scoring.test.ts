// ============================================================
// ProofLayer SDK — Tests
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import { ScoringEngine } from "../scoring/engine.js";
import { EventType, type BehavioralSnapshot } from "../types/index.js";
import { compositeToTier } from "../utils/index.js";

function makeSnapshot(
  overrides: Partial<BehavioralSnapshot> = {}
): BehavioralSnapshot {
  return {
    walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
    windowStart: new Date(Date.now() - 60000).toISOString(),
    windowEnd: new Date().toISOString(),
    transactionCount: 10,
    successCount: 9,
    failureCount: 1,
    escrowsCreated: 3,
    escrowsCompleted: 3,
    escrowsDisputed: 0,
    avgResponseTimeMs: 150,
    uptimePercent: 98,
    uniqueInteractions: 5,
    apiCallCount: 50,
    apiErrorCount: 2,
    events: [],
    ...overrides,
  };
}

describe("ScoringEngine", () => {
  let engine: ScoringEngine;

  beforeEach(() => {
    engine = new ScoringEngine();
  });

  it("returns baseline score with no data", () => {
    const score = engine.compute();
    expect(score.financial).toBe(0);
    expect(score.social).toBe(0);
    // Reliability starts at 30 — clean error rate baseline (no errors = full marks on that axis)
    expect(score.reliability).toBe(30);
    expect(score.trust).toBe(30);
    // Composite is weighted: 0*0.3 + 0*0.15 + 30*0.3 + 30*0.25 = 16.5 → 17
    expect(score.composite).toBe(17);
  });

  it("computes a reasonable score from a single snapshot", () => {
    engine.ingest(makeSnapshot());
    const score = engine.compute();

    expect(score.financial).toBeGreaterThan(0);
    expect(score.reliability).toBeGreaterThan(0);
    expect(score.composite).toBeGreaterThan(0);
    expect(score.composite).toBeLessThanOrEqual(100);
  });

  it("penalizes high failure rates", () => {
    const good = new ScoringEngine();
    good.ingest(makeSnapshot({ successCount: 10, failureCount: 0, transactionCount: 10 }));

    const bad = new ScoringEngine();
    bad.ingest(makeSnapshot({ successCount: 2, failureCount: 8, transactionCount: 10 }));

    expect(good.compute().financial).toBeGreaterThan(bad.compute().financial);
  });

  it("penalizes escrow disputes", () => {
    const clean = new ScoringEngine();
    clean.ingest(makeSnapshot({ escrowsCreated: 10, escrowsCompleted: 10, escrowsDisputed: 0 }));

    const disputed = new ScoringEngine();
    disputed.ingest(makeSnapshot({ escrowsCreated: 10, escrowsCompleted: 5, escrowsDisputed: 5 }));

    expect(clean.compute().financial).toBeGreaterThan(disputed.compute().financial);
  });

  it("rewards more unique interactions in social score", () => {
    const lonely = new ScoringEngine();
    lonely.ingest(makeSnapshot({ events: [] }));

    const social = new ScoringEngine();
    social.ingest(
      makeSnapshot({
        events: Array.from({ length: 20 }, (_, i) => ({
          type: EventType.INTERACTION,
          timestamp: new Date().toISOString(),
          metadata: { counterparty: `0x${i.toString(16).padStart(40, "0")}` },
        })),
      })
    );

    expect(social.compute().social).toBeGreaterThan(lonely.compute().social);
  });

  it("improves score with sustained activity over multiple snapshots", () => {
    engine.ingest(makeSnapshot());
    const scoreSingle = engine.compute().composite;

    for (let i = 0; i < 10; i++) {
      engine.ingest(makeSnapshot());
    }
    const scoreMulti = engine.compute().composite;

    expect(scoreMulti).toBeGreaterThanOrEqual(scoreSingle);
  });

  it("all axes stay within 0-100", () => {
    // Extreme good data
    engine.ingest(
      makeSnapshot({
        transactionCount: 100000,
        successCount: 100000,
        failureCount: 0,
        escrowsCreated: 10000,
        escrowsCompleted: 10000,
        escrowsDisputed: 0,
        avgResponseTimeMs: 10,
        uptimePercent: 100,
        uniqueInteractions: 500,
        apiCallCount: 500000,
        apiErrorCount: 0,
      })
    );

    const score = engine.compute();
    for (const axis of ["financial", "social", "reliability", "trust", "composite"] as const) {
      expect(score[axis]).toBeGreaterThanOrEqual(0);
      expect(score[axis]).toBeLessThanOrEqual(100);
    }
  });
});

describe("compositeToTier", () => {
  it("maps scores to correct tiers", () => {
    expect(compositeToTier(95)).toBe("Platinum");
    expect(compositeToTier(90)).toBe("Platinum");
    expect(compositeToTier(80)).toBe("Gold");
    expect(compositeToTier(75)).toBe("Gold");
    expect(compositeToTier(60)).toBe("Silver");
    expect(compositeToTier(55)).toBe("Silver");
    expect(compositeToTier(40)).toBe("Bronze");
    expect(compositeToTier(30)).toBe("Bronze");
    expect(compositeToTier(10)).toBe("Unverified");
    expect(compositeToTier(0)).toBe("Unverified");
  });
});
