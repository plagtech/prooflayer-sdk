// ============================================================
// ProofLayer SDK — Core Type Definitions
// ============================================================

import { z } from "zod";

// ── Score Axes ──────────────────────────────────────────────

/**
 * The four trust dimensions ProofLayer tracks.
 * Each axis is scored 0-100.
 */
export interface TrustScore {
  /** Payment completion, escrow behavior, volume consistency */
  financial: number;
  /** Interaction diversity, peer attestations, network health */
  social: number;
  /** Uptime, response times, error rates, consistency */
  reliability: number;
  /** Wallet age, association with flagged addresses, behavioral drift */
  trust: number;
  /** Weighted composite of all four axes (0-100) */
  composite: number;
  /** ISO timestamp of when this score was computed */
  computedAt: string;
  /** Number of data points used in this computation */
  dataPoints: number;
}

// ── Behavioral Events ───────────────────────────────────────

export enum EventType {
  TRANSACTION_SENT = "transaction_sent",
  TRANSACTION_RECEIVED = "transaction_received",
  TRANSACTION_FAILED = "transaction_failed",
  ESCROW_CREATED = "escrow_created",
  ESCROW_COMPLETED = "escrow_completed",
  ESCROW_DISPUTED = "escrow_disputed",
  ESCROW_EXPIRED = "escrow_expired",
  API_CALL = "api_call",
  API_ERROR = "api_error",
  HEARTBEAT = "heartbeat",
  INTERACTION = "interaction",
  CUSTOM = "custom",
}

export interface BehavioralEvent {
  /** Event type from the EventType enum or a custom string */
  type: EventType | string;
  /** ISO timestamp */
  timestamp: string;
  /** Arbitrary metadata — NO private keys, NO transaction contents */
  metadata: Record<string, unknown>;
}

/** What the SDK tracks internally per reporting window */
export interface BehavioralSnapshot {
  walletAddress: string;
  windowStart: string;
  windowEnd: string;
  transactionCount: number;
  successCount: number;
  failureCount: number;
  escrowsCreated: number;
  escrowsCompleted: number;
  escrowsDisputed: number;
  avgResponseTimeMs: number;
  uptimePercent: number;
  uniqueInteractions: number;
  apiCallCount: number;
  apiErrorCount: number;
  events: BehavioralEvent[];
}

// ── Report Card ─────────────────────────────────────────────

export interface ReportCard {
  walletAddress: string;
  score: TrustScore;
  /** Human-readable tier: "Unverified" | "Bronze" | "Silver" | "Gold" | "Platinum" */
  tier: ScoreTier;
  /** Total events tracked since registration */
  totalEventsTracked: number;
  /** First event timestamp */
  firstSeen: string;
  /** Most recent event timestamp */
  lastSeen: string;
  /** On-chain attestation UID (if attested) */
  attestationUid?: string;
  /** Whether the agent holds a verification badge */
  verified: boolean;
}

export type ScoreTier =
  | "Unverified"
  | "Bronze"
  | "Silver"
  | "Gold"
  | "Platinum";

// ── Configuration ───────────────────────────────────────────

export interface ProofLayerConfig {
  /** The agent's wallet address (primary identifier) */
  walletAddress: string;
  /** ProofLayer API endpoint (defaults to https://api.prooflayer.net) */
  apiUrl?: string;
  /** API key for premium features (optional for free tier) */
  apiKey?: string;
  /** How often to flush buffered events to the backend (ms, default: 60000) */
  flushIntervalMs?: number;
  /** Max events to buffer before auto-flush (default: 100) */
  maxBufferSize?: number;
  /** Enable heartbeat pings for uptime tracking (default: true) */
  enableHeartbeat?: boolean;
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatIntervalMs?: number;
  /** Enable debug logging to stderr (default: false) */
  debug?: boolean;
  /** Custom scoring weights (optional, uses defaults if omitted) */
  scoringWeights?: Partial<ScoringWeights>;
  /** Chain ID for on-chain attestations (default: 8453 for Base) */
  chainId?: number;
  /** EAS contract address override */
  easContractAddress?: string;
  /** Private key or signer for on-chain attestations (optional) */
  signerPrivateKey?: string;
}

export interface ScoringWeights {
  financial: number;
  social: number;
  reliability: number;
  trust: number;
}

// ── API Responses ───────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface FlushResult {
  eventsAccepted: number;
  eventsRejected: number;
  newScore?: TrustScore;
}

export interface AttestationResult {
  uid: string;
  txHash: string;
  chainId: number;
  schemaId: string;
  timestamp: string;
}

// ── Zod Schemas (for runtime validation) ────────────────────

export const BehavioralEventSchema = z.object({
  type: z.string().min(1),
  timestamp: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});

export const ProofLayerConfigSchema = z.object({
  walletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid Ethereum address"),
  apiUrl: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
  flushIntervalMs: z.number().int().min(5000).max(600000).optional(),
  maxBufferSize: z.number().int().min(10).max(10000).optional(),
  enableHeartbeat: z.boolean().optional(),
  heartbeatIntervalMs: z.number().int().min(5000).max(300000).optional(),
  debug: z.boolean().optional(),
  scoringWeights: z
    .object({
      financial: z.number().min(0).max(1),
      social: z.number().min(0).max(1),
      reliability: z.number().min(0).max(1),
      trust: z.number().min(0).max(1),
    })
    .partial()
    .optional(),
  chainId: z.number().int().optional(),
  easContractAddress: z.string().optional(),
  signerPrivateKey: z.string().optional(),
});
