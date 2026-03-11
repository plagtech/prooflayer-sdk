// ============================================================
// ProofLayer SDK — Main Entry Point
// The primary class developers interact with.
// ============================================================

import {
  type ProofLayerConfig,
  type TrustScore,
  type ReportCard,
  type AttestationResult,
  type FlushResult,
  EventType,
  ProofLayerConfigSchema,
} from "./types/index.js";
import { Logger, DEFAULTS, SCORING_DEFAULTS, compositeToTier } from "./utils/index.js";
import { EventCollector } from "./collectors/event-collector.js";
import { ApiClient } from "./collectors/api-client.js";
import { ScoringEngine } from "./scoring/engine.js";
import { AttestationManager } from "./attestations/eas.js";

export class ProofLayer {
  private readonly config: Required<
    Omit<ProofLayerConfig, "apiKey" | "signerPrivateKey" | "easContractAddress" | "scoringWeights">
  > & {
    apiKey?: string;
    signerPrivateKey?: string;
    easContractAddress: string;
    scoringWeights: { financial: number; social: number; reliability: number; trust: number };
  };

  private readonly logger: Logger;
  private readonly collector: EventCollector;
  private readonly api: ApiClient;
  private readonly scorer: ScoringEngine;
  private readonly attestor: AttestationManager;
  private started = false;
  private scoreListeners: Array<(score: TrustScore) => void> = [];
  private lastScore: TrustScore | null = null;

  constructor(config: ProofLayerConfig) {
    // Validate config
    const parsed = ProofLayerConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new Error(
        `Invalid ProofLayer config: ${parsed.error.issues.map((i) => i.message).join(", ")}`
      );
    }

    this.config = {
      walletAddress: config.walletAddress,
      apiUrl: config.apiUrl ?? DEFAULTS.API_URL,
      apiKey: config.apiKey,
      flushIntervalMs: config.flushIntervalMs ?? DEFAULTS.FLUSH_INTERVAL_MS,
      maxBufferSize: config.maxBufferSize ?? DEFAULTS.MAX_BUFFER_SIZE,
      enableHeartbeat: config.enableHeartbeat ?? true,
      heartbeatIntervalMs:
        config.heartbeatIntervalMs ?? DEFAULTS.HEARTBEAT_INTERVAL_MS,
      debug: config.debug ?? false,
      scoringWeights: {
        ...SCORING_DEFAULTS,
        ...config.scoringWeights,
      },
      chainId: config.chainId ?? DEFAULTS.CHAIN_ID,
      easContractAddress:
        config.easContractAddress ?? DEFAULTS.EAS_CONTRACT,
      signerPrivateKey: config.signerPrivateKey,
    };

    this.logger = new Logger(this.config.debug);

    this.collector = new EventCollector({
      walletAddress: this.config.walletAddress,
      apiUrl: this.config.apiUrl,
      apiKey: this.config.apiKey,
      flushIntervalMs: this.config.flushIntervalMs,
      maxBufferSize: this.config.maxBufferSize,
      enableHeartbeat: this.config.enableHeartbeat,
      heartbeatIntervalMs: this.config.heartbeatIntervalMs,
      logger: this.logger,
      onScore: (score) => this.handleScoreUpdate(score),
    });

    this.api = new ApiClient({
      apiUrl: this.config.apiUrl,
      apiKey: this.config.apiKey,
      walletAddress: this.config.walletAddress,
      logger: this.logger,
    });

    this.scorer = new ScoringEngine(this.config.scoringWeights);

    this.attestor = new AttestationManager({
      chainId: this.config.chainId,
      easContractAddress: this.config.easContractAddress,
      signerPrivateKey: this.config.signerPrivateKey,
      logger: this.logger,
    });
  }

  // ════════════════════════════════════════════════════════
  // LIFECYCLE
  // ════════════════════════════════════════════════════════

  /**
   * Start the ProofLayer SDK.
   * Begins collecting events, sending heartbeats, and periodic flushes.
   */
  async start(): Promise<void> {
    if (this.started) {
      this.logger.warn("ProofLayer already started");
      return;
    }

    this.logger.info("ProofLayer SDK starting", {
      wallet: this.config.walletAddress,
      api: this.config.apiUrl,
    });

    // Register agent with backend (fire-and-forget)
    void this.api.register({
      chainId: this.config.chainId,
      sdkVersion: "0.1.0",
    });

    this.collector.start();
    this.started = true;

    this.logger.info("ProofLayer SDK started");
  }

  /**
   * Stop the SDK. Flushes remaining events before stopping.
   */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.logger.info("ProofLayer SDK stopping — flushing remaining events");
    await this.collector.flush();
    this.collector.stop();
    this.started = false;
    this.logger.info("ProofLayer SDK stopped");
  }

  // ════════════════════════════════════════════════════════
  // EVENT RECORDING
  // ════════════════════════════════════════════════════════

  /** Record a raw event */
  record(type: EventType | string, metadata?: Record<string, unknown>): void {
    this.ensureStarted();
    this.collector.record(type, metadata);
  }

  /** Record a successful transaction */
  txSuccess(meta?: Record<string, unknown>): void {
    this.ensureStarted();
    this.collector.transactionSuccess(meta);
  }

  /** Record a failed transaction */
  txFailure(meta?: Record<string, unknown>): void {
    this.ensureStarted();
    this.collector.transactionFailure(meta);
  }

  /** Record an escrow event */
  escrow(
    action: "created" | "completed" | "disputed" | "expired",
    meta?: Record<string, unknown>
  ): void {
    this.ensureStarted();
    this.collector.escrow(action, meta);
  }

  /** Record an API call with optional response time */
  apiCall(responseTimeMs?: number, meta?: Record<string, unknown>): void {
    this.ensureStarted();
    this.collector.apiCall(responseTimeMs, meta);
  }

  /** Record an API error */
  apiError(meta?: Record<string, unknown>): void {
    this.ensureStarted();
    this.collector.apiError(meta);
  }

  /** Record an interaction with another agent/wallet */
  interaction(counterparty: string, meta?: Record<string, unknown>): void {
    this.ensureStarted();
    this.collector.interaction(counterparty, meta);
  }

  /**
   * Wrap an async function to auto-track execution time and success/failure.
   *
   * ```ts
   * const result = await proof.wrap(() => agent.executeSwap(params));
   * ```
   */
  async wrap<T>(
    fn: () => Promise<T>,
    eventType?: EventType | string,
    meta?: Record<string, unknown>
  ): Promise<T> {
    this.ensureStarted();
    return this.collector.wrap(fn, eventType, meta);
  }

  /** Force flush buffered events to the backend */
  async flush(): Promise<FlushResult | null> {
    return this.collector.flush();
  }

  // ════════════════════════════════════════════════════════
  // SCORE QUERIES
  // ════════════════════════════════════════════════════════

  /**
   * Get the trust score for a wallet from the backend API.
   * Pass no argument to get your own score.
   */
  async getScore(walletAddress?: string): Promise<TrustScore | null> {
    return this.api.getScore(walletAddress);
  }

  /** Get the full report card for a wallet */
  async getReportCard(walletAddress?: string): Promise<ReportCard | null> {
    return this.api.getReportCard(walletAddress);
  }

  /**
   * Compute a local preview score from data collected this session.
   * Useful for debugging or when the backend is unreachable.
   */
  getLocalScore(): TrustScore {
    return this.scorer.compute();
  }

  // ════════════════════════════════════════════════════════
  // TRUST CHECKS (for protocols / marketplaces)
  // ════════════════════════════════════════════════════════

  /**
   * Check if an agent meets a minimum trust threshold.
   * Designed for protocols to gate access.
   *
   * ```ts
   * const check = await proof.checkTrust(agentWallet, 70, "escrow_10k");
   * if (!check.allowed) reject();
   * ```
   */
  async checkTrust(
    walletAddress: string,
    minComposite?: number,
    context?: string
  ): Promise<{
    allowed: boolean;
    score: number;
    tier: string;
    reason?: string;
  }> {
    return this.api.checkTrust(walletAddress, minComposite, context);
  }

  /** Check if a wallet has a verified badge */
  async isVerified(walletAddress?: string): Promise<boolean> {
    return this.api.isVerified(walletAddress);
  }

  // ════════════════════════════════════════════════════════
  // ON-CHAIN ATTESTATIONS
  // ════════════════════════════════════════════════════════

  /**
   * Create an on-chain EAS attestation of the current trust score.
   * Requires a signer (private key in config) or use `requestAttestation()`
   * for server-side attestation.
   */
  async attest(score?: TrustScore): Promise<AttestationResult> {
    const scoreToAttest = score ?? (await this.getScore()) ?? this.getLocalScore();
    return this.attestor.attest(this.config.walletAddress, scoreToAttest);
  }

  /**
   * Request the ProofLayer backend to create an attestation.
   * No private key needed — the backend handles signing.
   */
  async requestAttestation(): Promise<AttestationResult | null> {
    return this.api.requestAttestation();
  }

  /**
   * Read an existing attestation from on-chain by UID.
   */
  async readAttestation(uid: string) {
    return this.attestor.getAttestation(uid);
  }

  // ════════════════════════════════════════════════════════
  // DIAGNOSTICS
  // ════════════════════════════════════════════════════════

  /** Get current buffer size and session metrics */
  getMetrics(): Record<string, unknown> {
    return {
      ...this.collector.getMetrics(),
      started: this.started,
      wallet: this.config.walletAddress,
      apiUrl: this.config.apiUrl,
      lastScore: this.lastScore,
    };
  }

  /** The agent's wallet address */
  get walletAddress(): string {
    return this.config.walletAddress;
  }

  /** Get the most recently received score (from the last flush) */
  getLastScore(): TrustScore | null {
    return this.lastScore;
  }

  // ════════════════════════════════════════════════════════
  // SCORE EVENTS
  // ════════════════════════════════════════════════════════

  /**
   * Register a callback that fires whenever a new score is received
   * (after each successful flush to the backend).
   *
   * ```ts
   * proof.onScore((score) => {
   *   console.log(`Trust score updated: ${score.composite}/100`);
   * });
   * ```
   */
  onScore(listener: (score: TrustScore) => void): () => void {
    this.scoreListeners.push(listener);
    // Return unsubscribe function
    return () => {
      this.scoreListeners = this.scoreListeners.filter((l) => l !== listener);
    };
  }

  // ── Internal ────────────────────────────────────────────

  private handleScoreUpdate(score: TrustScore): void {
    this.lastScore = score;
    const tier = compositeToTier(score.composite);

    // Auto-log the score update
    this.logger.info(
      `📊 Score updated: ${score.composite}/100 [${tier}] ` +
        `(F:${score.financial} S:${score.social} R:${score.reliability} T:${score.trust})`
    );

    // Notify all registered listeners
    for (const listener of this.scoreListeners) {
      try {
        listener(score);
      } catch (err) {
        this.logger.warn("Score listener threw an error", err);
      }
    }
  }

  private ensureStarted(): void {
    if (!this.started) {
      throw new Error(
        "ProofLayer SDK not started. Call `await proof.start()` first."
      );
    }
  }
}
