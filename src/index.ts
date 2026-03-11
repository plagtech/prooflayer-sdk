// ============================================================
// ProofLayer SDK
// Opt-in behavioral trust scoring for AI agents.
// https://prooflayer.net
// ============================================================

// Main class
export { ProofLayer } from "./prooflayer.js";

// Types
export {
  type TrustScore,
  type BehavioralEvent,
  type BehavioralSnapshot,
  type ReportCard,
  type ProofLayerConfig,
  type ScoringWeights,
  type ApiResponse,
  type FlushResult,
  type AttestationResult,
  type ScoreTier,
  EventType,
} from "./types/index.js";

// Scoring engine (for advanced usage / self-hosting)
export { ScoringEngine } from "./scoring/engine.js";
export type { ScoringState } from "./scoring/engine.js";

// Attestation manager (for direct on-chain operations)
export { AttestationManager } from "./attestations/eas.js";
export type { AttestationConfig } from "./attestations/eas.js";

// Utilities
export {
  DEFAULTS,
  SCORING_DEFAULTS,
  TIER_THRESHOLDS,
  PROOFLAYER_SCHEMA,
  compositeToTier,
} from "./utils/index.js";
