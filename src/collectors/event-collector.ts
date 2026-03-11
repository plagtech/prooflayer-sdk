// ============================================================
// ProofLayer SDK — Event Collector
// Buffers behavioral events and flushes them to the backend.
// This is the "LoJack" wrapper that sits around agent activity.
// ============================================================

import {
  EventType,
  type BehavioralEvent,
  type BehavioralSnapshot,
  type FlushResult,
  type ApiResponse,
  BehavioralEventSchema,
} from "../types/index.js";
import { Logger, now, apiFetch, DEFAULTS } from "../utils/index.js";

export interface CollectorOptions {
  walletAddress: string;
  apiUrl: string;
  apiKey?: string;
  flushIntervalMs: number;
  maxBufferSize: number;
  enableHeartbeat: boolean;
  heartbeatIntervalMs: number;
  logger: Logger;
  /** Called after each successful flush with the updated score */
  onScore?: (score: import("../types/index.js").TrustScore) => void;
}

export class EventCollector {
  private buffer: BehavioralEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private windowStart: string;
  private metrics = {
    transactionCount: 0,
    successCount: 0,
    failureCount: 0,
    escrowsCreated: 0,
    escrowsCompleted: 0,
    escrowsDisputed: 0,
    responseTimes: [] as number[],
    uniqueInteractions: new Set<string>(),
    apiCallCount: 0,
    apiErrorCount: 0,
  };

  constructor(private opts: CollectorOptions) {
    this.windowStart = now();
  }

  // ── Lifecycle ───────────────────────────────────────────

  start(): void {
    this.opts.logger.info("Collector starting", {
      wallet: this.opts.walletAddress,
      flushInterval: this.opts.flushIntervalMs,
    });

    // Periodic flush
    this.flushTimer = setInterval(
      () => void this.flush(),
      this.opts.flushIntervalMs
    );

    // Heartbeat for uptime tracking
    if (this.opts.enableHeartbeat) {
      this.heartbeatTimer = setInterval(
        () => this.recordHeartbeat(),
        this.opts.heartbeatIntervalMs
      );
      // Send an initial heartbeat immediately
      this.recordHeartbeat();
    }
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.opts.logger.info("Collector stopped");
  }

  // ── Event Recording ─────────────────────────────────────

  /**
   * Record a raw behavioral event.
   * Auto-flushes when the buffer is full.
   */
  record(type: EventType | string, metadata: Record<string, unknown> = {}): void {
    const event: BehavioralEvent = {
      type,
      timestamp: now(),
      metadata,
    };

    // Validate
    const parsed = BehavioralEventSchema.safeParse(event);
    if (!parsed.success) {
      this.opts.logger.warn("Invalid event rejected", parsed.error.issues);
      return;
    }

    // Update aggregate metrics
    this.updateMetrics(event);

    // Buffer
    this.buffer.push(event);
    this.opts.logger.debug(`Event buffered [${this.buffer.length}/${this.opts.maxBufferSize}]`, {
      type,
    });

    // Auto-flush if buffer is full
    if (this.buffer.length >= this.opts.maxBufferSize) {
      void this.flush();
    }
  }

  // ── Convenience Methods ─────────────────────────────────

  /** Record a successful transaction */
  transactionSuccess(meta: Record<string, unknown> = {}): void {
    this.record(EventType.TRANSACTION_SENT, { ...meta, success: true });
  }

  /** Record a failed transaction */
  transactionFailure(meta: Record<string, unknown> = {}): void {
    this.record(EventType.TRANSACTION_FAILED, meta);
  }

  /** Record an escrow lifecycle event */
  escrow(
    action: "created" | "completed" | "disputed" | "expired",
    meta: Record<string, unknown> = {}
  ): void {
    const typeMap = {
      created: EventType.ESCROW_CREATED,
      completed: EventType.ESCROW_COMPLETED,
      disputed: EventType.ESCROW_DISPUTED,
      expired: EventType.ESCROW_EXPIRED,
    };
    this.record(typeMap[action], meta);
  }

  /** Record an API call with optional response time */
  apiCall(responseTimeMs?: number, meta: Record<string, unknown> = {}): void {
    this.record(EventType.API_CALL, { ...meta, responseTimeMs });
    if (responseTimeMs !== undefined) {
      this.metrics.responseTimes.push(responseTimeMs);
    }
  }

  /** Record an API error */
  apiError(meta: Record<string, unknown> = {}): void {
    this.record(EventType.API_ERROR, meta);
  }

  /** Record an interaction with another wallet/agent */
  interaction(counterparty: string, meta: Record<string, unknown> = {}): void {
    this.record(EventType.INTERACTION, { ...meta, counterparty });
    this.metrics.uniqueInteractions.add(counterparty.toLowerCase());
  }

  // ── Wrapping Agent Calls ────────────────────────────────

  /**
   * Wrap an async function to automatically track its execution
   * as an API call with response time and success/failure.
   */
  wrap<T>(
    fn: () => Promise<T>,
    eventType: EventType | string = EventType.API_CALL,
    meta: Record<string, unknown> = {}
  ): Promise<T> {
    const start = Date.now();
    return fn()
      .then((result) => {
        const elapsed = Date.now() - start;
        this.record(eventType, { ...meta, responseTimeMs: elapsed, success: true });
        this.metrics.responseTimes.push(elapsed);
        return result;
      })
      .catch((err: unknown) => {
        const elapsed = Date.now() - start;
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.record(eventType, {
          ...meta,
          responseTimeMs: elapsed,
          success: false,
          error: errorMsg,
        });
        this.metrics.responseTimes.push(elapsed);
        throw err;
      });
  }

  // ── Flush ───────────────────────────────────────────────

  /** Flush buffered events to the ProofLayer backend */
  async flush(): Promise<FlushResult | null> {
    if (this.buffer.length === 0) {
      this.opts.logger.debug("Flush skipped — buffer empty");
      return null;
    }

    const snapshot = this.buildSnapshot();
    this.resetWindow();

    try {
      this.opts.logger.info(`Flushing ${snapshot.events.length} events`);
      const result = await apiFetch<ApiResponse<FlushResult>>(
        `${this.opts.apiUrl}/v1/ingest`,
        {
          method: "POST",
          headers: this.opts.apiKey
            ? { Authorization: `Bearer ${this.opts.apiKey}` }
            : {},
          body: JSON.stringify(snapshot),
        }
      );

      if (result.success && result.data) {
        this.opts.logger.info("Flush successful", result.data);
        // Fire the score callback if a new score was returned
        if (result.data.newScore && this.opts.onScore) {
          this.opts.onScore(result.data.newScore);
        }
        return result.data;
      } else {
        this.opts.logger.warn("Flush returned error", result.error);
        return null;
      }
    } catch (err) {
      this.opts.logger.error("Flush failed — events will be re-buffered", err);
      // Put events back in the buffer for retry
      this.buffer.unshift(...snapshot.events);
      // Trim to max to prevent unbounded growth
      if (this.buffer.length > this.opts.maxBufferSize * 2) {
        const dropped = this.buffer.length - this.opts.maxBufferSize;
        this.buffer = this.buffer.slice(-this.opts.maxBufferSize);
        this.opts.logger.warn(`Dropped ${dropped} oldest events to prevent buffer overflow`);
      }
      return null;
    }
  }

  /** Get current buffer size */
  get bufferSize(): number {
    return this.buffer.length;
  }

  /** Get current metrics snapshot (without flushing) */
  getMetrics(): Record<string, unknown> {
    return {
      bufferSize: this.buffer.length,
      transactionCount: this.metrics.transactionCount,
      successRate:
        this.metrics.transactionCount > 0
          ? this.metrics.successCount / this.metrics.transactionCount
          : null,
      escrowsCreated: this.metrics.escrowsCreated,
      escrowsCompleted: this.metrics.escrowsCompleted,
      avgResponseTimeMs:
        this.metrics.responseTimes.length > 0
          ? this.metrics.responseTimes.reduce((a, b) => a + b, 0) /
            this.metrics.responseTimes.length
          : null,
      uniqueInteractions: this.metrics.uniqueInteractions.size,
      apiCallCount: this.metrics.apiCallCount,
      apiErrorCount: this.metrics.apiErrorCount,
    };
  }

  // ── Internal ────────────────────────────────────────────

  private recordHeartbeat(): void {
    this.record(EventType.HEARTBEAT, { uptimeCheck: true });
  }

  private updateMetrics(event: BehavioralEvent): void {
    switch (event.type) {
      case EventType.TRANSACTION_SENT:
      case EventType.TRANSACTION_RECEIVED:
        this.metrics.transactionCount++;
        this.metrics.successCount++;
        break;
      case EventType.TRANSACTION_FAILED:
        this.metrics.transactionCount++;
        this.metrics.failureCount++;
        break;
      case EventType.ESCROW_CREATED:
        this.metrics.escrowsCreated++;
        break;
      case EventType.ESCROW_COMPLETED:
        this.metrics.escrowsCompleted++;
        break;
      case EventType.ESCROW_DISPUTED:
        this.metrics.escrowsDisputed++;
        break;
      case EventType.API_CALL:
        this.metrics.apiCallCount++;
        break;
      case EventType.API_ERROR:
        this.metrics.apiErrorCount++;
        break;
    }
  }

  private buildSnapshot(): BehavioralSnapshot {
    const windowEnd = now();
    const avgResponseTime =
      this.metrics.responseTimes.length > 0
        ? this.metrics.responseTimes.reduce((a, b) => a + b, 0) /
          this.metrics.responseTimes.length
        : 0;

    // Calculate uptime based on heartbeat presence
    const heartbeatEvents = this.buffer.filter(
      (e) => e.type === EventType.HEARTBEAT
    );
    const expectedHeartbeats = Math.max(
      1,
      Math.floor(
        (Date.now() - new Date(this.windowStart).getTime()) /
          this.opts.heartbeatIntervalMs
      )
    );
    const uptimePercent = Math.min(
      100,
      (heartbeatEvents.length / expectedHeartbeats) * 100
    );

    return {
      walletAddress: this.opts.walletAddress,
      windowStart: this.windowStart,
      windowEnd,
      transactionCount: this.metrics.transactionCount,
      successCount: this.metrics.successCount,
      failureCount: this.metrics.failureCount,
      escrowsCreated: this.metrics.escrowsCreated,
      escrowsCompleted: this.metrics.escrowsCompleted,
      escrowsDisputed: this.metrics.escrowsDisputed,
      avgResponseTimeMs: Math.round(avgResponseTime),
      uptimePercent: Math.round(uptimePercent * 100) / 100,
      uniqueInteractions: this.metrics.uniqueInteractions.size,
      apiCallCount: this.metrics.apiCallCount,
      apiErrorCount: this.metrics.apiErrorCount,
      events: [...this.buffer],
    };
  }

  private resetWindow(): void {
    this.buffer = [];
    this.windowStart = now();
    this.metrics = {
      transactionCount: 0,
      successCount: 0,
      failureCount: 0,
      escrowsCreated: 0,
      escrowsCompleted: 0,
      escrowsDisputed: 0,
      responseTimes: [],
      uniqueInteractions: new Set<string>(),
      apiCallCount: 0,
      apiErrorCount: 0,
    };
  }
}
