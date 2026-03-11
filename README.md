# ProofLayer SDK

**Opt-in behavioral trust scoring for AI agents.**

ProofLayer is a lightweight npm package that wraps an agent's activity with a reporting layer, generating multi-dimensional trust scores and publishing verifiable on-chain attestations. Think of it as a **LoJack for AI agents** — developers install it voluntarily to signal good faith and prove their agent isn't malicious.

> Agents without a score become the suspicious ones.

---

## Install

```bash
npm install prooflayer-sdk
```

For on-chain attestations (optional):

```bash
npm install prooflayer-sdk ethers
```

## Quick Start

```typescript
import { ProofLayer } from "prooflayer-sdk";

const proof = new ProofLayer({
  walletAddress: "0xYourAgentWallet",
  // apiKey: "pl_...",  // Optional — free tier works without a key
});

await proof.start();

// Track transactions
proof.txSuccess({ chain: "base", amount: "1.5" });
proof.txFailure({ chain: "base", error: "insufficient_funds" });

// Track escrow behavior
proof.escrow("created", { counterparty: "0xBob", amount: "100" });
proof.escrow("completed", { counterparty: "0xBob" });

// Track API calls with response times
proof.apiCall(142);  // 142ms response time
proof.apiError({ endpoint: "/swap", status: 500 });

// Track interactions with other agents
proof.interaction("0xOtherAgent", { context: "swap_negotiation" });

// Wrap async functions for automatic tracking
const result = await proof.wrap(() => agent.executeSwap(params));

// Query scores
const score = await proof.getScore();           // From backend
const local = proof.getLocalScore();             // Local preview
const report = await proof.getReportCard();      // Full report card

// Check if another agent is trustworthy
const check = await proof.checkTrust("0xSomeAgent", 70, "escrow_10k");
if (!check.allowed) {
  console.log(`Rejected: ${check.reason} (score: ${check.score})`);
}

// Clean shutdown
await proof.stop();
```

## What It Tracks

ProofLayer tracks **behavioral metadata only** — no private keys, no transaction contents, no sensitive data.

| Category | Signals |
|----------|---------|
| **Financial** | Transaction count, success/failure rates, volume patterns |
| **Escrow** | Creation, completion, dispute, and expiration rates |
| **Reliability** | Response times, uptime (via heartbeat), error rates |
| **Social** | Interaction diversity, frequency, peer patterns |
| **API Usage** | Call patterns, normal usage vs. suspicious hammering |

## Trust Score

Every agent gets a multi-dimensional score across **four axes**, each scored 0-100:

| Axis | What It Measures | Weight |
|------|-----------------|--------|
| **Financial** | Payment completion, escrow behavior, volume consistency | 30% |
| **Social** | Interaction diversity, peer attestations, network health | 15% |
| **Reliability** | Uptime, response times, error rates, consistency | 30% |
| **Trust** | Wallet age, behavioral consistency, dispute history | 25% |

The weighted composite determines the agent's **tier**:

| Tier | Composite Score |
|------|----------------|
| Platinum | 90-100 |
| Gold | 75-89 |
| Silver | 55-74 |
| Bronze | 30-54 |
| Unverified | 0-29 |

## On-Chain Attestations (EAS on Base)

Trust scores are published as [EAS](https://attest.org) attestations on Base, making them verifiable without hitting a centralized API.

```typescript
// Option 1: SDK-side attestation (requires private key)
const proof = new ProofLayer({
  walletAddress: "0x...",
  signerPrivateKey: process.env.PRIVATE_KEY,
});
const attestation = await proof.attest();
console.log(`Attestation UID: ${attestation.uid}`);
console.log(`TX: ${attestation.txHash}`);

// Option 2: Server-side attestation (recommended — no key needed)
const attestation = await proof.requestAttestation();

// Read any attestation
const data = await proof.readAttestation(attestation.uid);
console.log(data.score);  // { financial: 85, social: 72, ... }
```

## Configuration

```typescript
const proof = new ProofLayer({
  // Required
  walletAddress: "0x...",

  // Optional
  apiUrl: "https://api.prooflayer.net",  // Backend URL
  apiKey: "pl_...",                       // Premium features
  flushIntervalMs: 60000,                // Flush events every 60s
  maxBufferSize: 100,                    // Auto-flush at 100 events
  enableHeartbeat: true,                 // Uptime tracking
  heartbeatIntervalMs: 30000,            // Heartbeat every 30s
  debug: false,                          // Debug logging to stderr
  chainId: 8453,                         // Base mainnet
  signerPrivateKey: "0x...",             // For on-chain attestations

  // Custom scoring weights (must sum to 1.0)
  scoringWeights: {
    financial: 0.30,
    social: 0.15,
    reliability: 0.30,
    trust: 0.25,
  },
});
```

## For Protocols & Marketplaces

ProofLayer provides a trust-gating API for platforms that need to verify agents before allowing high-value operations.

```typescript
import { ProofLayer } from "prooflayer-sdk";

const proof = new ProofLayer({
  walletAddress: "0xProtocolWallet",
  apiKey: "pl_protocol_key",
});

// Before allowing an agent to execute a $10K escrow:
const check = await proof.checkTrust(
  "0xAgentWallet",
  70,           // Minimum composite score
  "escrow_10k"  // Context for audit trail
);

if (!check.allowed) {
  throw new Error(`Agent not trusted: ${check.reason} (tier: ${check.tier})`);
}

// Check verification badge
const verified = await proof.isVerified("0xAgentWallet");
```

## Advanced: Self-Hosted Scoring

The scoring engine can run locally for offline or self-hosted deployments:

```typescript
import { ScoringEngine } from "prooflayer-sdk";

const scorer = new ScoringEngine({
  financial: 0.30,
  social: 0.15,
  reliability: 0.30,
  trust: 0.25,
});

// Feed behavioral snapshots
scorer.ingest(snapshot);

// Compute score
const score = scorer.compute();
console.log(score);
// { financial: 85, social: 62, reliability: 91, trust: 78, composite: 81, ... }

console.log(scorer.getTier()); // "Gold"
```

## API Reference

### `ProofLayer`

| Method | Description |
|--------|-------------|
| `start()` | Start collecting events and heartbeats |
| `stop()` | Flush and stop |
| `record(type, meta?)` | Record a raw event |
| `txSuccess(meta?)` | Record successful transaction |
| `txFailure(meta?)` | Record failed transaction |
| `escrow(action, meta?)` | Record escrow lifecycle event |
| `apiCall(ms?, meta?)` | Record API call with response time |
| `apiError(meta?)` | Record API error |
| `interaction(addr, meta?)` | Record interaction with another agent |
| `wrap(fn, type?, meta?)` | Wrap async function for auto-tracking |
| `flush()` | Force flush buffered events |
| `getScore(addr?)` | Get trust score from backend |
| `getReportCard(addr?)` | Get full report card |
| `getLocalScore()` | Compute score from local session data |
| `checkTrust(addr, min?, ctx?)` | Check if agent meets trust threshold |
| `isVerified(addr?)` | Check verification badge |
| `attest(score?)` | Create on-chain EAS attestation |
| `requestAttestation()` | Request server-side attestation |
| `readAttestation(uid)` | Read attestation from chain |
| `getMetrics()` | Get session diagnostics |

## Pricing Tiers

| Tier | Cost | Includes |
|------|------|----------|
| **Free** | $0 | Basic SDK, trust score, public report card |
| **Premium SDK** | $/mo | Dashboard, analytics, drift alerts, benchmarking |
| **Verification Badge** | One-time | On-chain verified attestation, protocol access |
| **Protocol API** | Usage-based | Trust queries for platforms and marketplaces |

## License

MIT
