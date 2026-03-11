// ============================================================
// ProofLayer SDK — On-Chain EAS Attestations
// Publishes trust scores as EAS attestations on Base.
// ============================================================

import type { TrustScore, AttestationResult } from "../types/index.js";
import { DEFAULTS, PROOFLAYER_SCHEMA, Logger } from "../utils/index.js";

// ── ABI fragments for EAS interaction ─────────────────────

const EAS_ABI = [
  "function attest((bytes32 schema, (address recipient, uint64 expirationTime, bool revocable, bytes32 refUID, bytes data, uint256 value) data)) external payable returns (bytes32)",
  "function getAttestation(bytes32 uid) external view returns ((bytes32 uid, bytes32 schema, uint64 time, uint64 expirationTime, address attester, address recipient, bool revocable, bytes32 refUID, bytes data))",
];

const SCHEMA_REGISTRY_ABI = [
  "function register(string schema, address resolver, bool revocable) external returns (bytes32)",
  "function getSchema(bytes32 uid) external view returns ((bytes32 uid, address resolver, bool revocable, string schema))",
];

export interface AttestationConfig {
  chainId: number;
  easContractAddress: string;
  schemaRegistryAddress: string;
  signerPrivateKey?: string;
  rpcUrl?: string;
  logger: Logger;
}

/**
 * Handles publishing ProofLayer trust scores as on-chain EAS attestations.
 * 
 * Attestations are created on Base mainnet by default and can be verified
 * by anyone without hitting a centralized API.
 */
export class AttestationManager {
  private config: AttestationConfig;
  private schemaUid: string | null = null;

  constructor(config: Partial<AttestationConfig> & { logger: Logger }) {
    this.config = {
      chainId: config.chainId ?? DEFAULTS.CHAIN_ID,
      easContractAddress: config.easContractAddress ?? DEFAULTS.EAS_CONTRACT,
      schemaRegistryAddress:
        config.schemaRegistryAddress ?? DEFAULTS.EAS_SCHEMA_REGISTRY,
      signerPrivateKey: config.signerPrivateKey,
      rpcUrl: config.rpcUrl,
      logger: config.logger,
    };
  }

  /**
   * Publish a trust score as an EAS attestation.
   * Requires ethers.js and a signer (private key or injected).
   */
  async attest(
    walletAddress: string,
    score: TrustScore
  ): Promise<AttestationResult> {
    // Dynamic import — ethers is an optional peer dependency
    let ethers: typeof import("ethers");
    try {
      ethers = await import("ethers");
    } catch {
      throw new Error(
        "ethers.js is required for on-chain attestations. Install it: npm install ethers"
      );
    }

    if (!this.config.signerPrivateKey) {
      throw new Error(
        "signerPrivateKey is required to create on-chain attestations. " +
          "Provide it in ProofLayer config or use the backend API for server-side attestation."
      );
    }

    const rpcUrl = this.config.rpcUrl ?? this.getRpcUrl(this.config.chainId);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(this.config.signerPrivateKey, provider);

    this.config.logger.info("Creating on-chain attestation", {
      wallet: walletAddress,
      composite: score.composite,
      chain: this.config.chainId,
    });

    // Ensure schema is registered
    const schemaUid = await this.ensureSchema(ethers, signer);

    // Encode attestation data
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const encodedData = abiCoder.encode(
      [
        "uint8",  // financial
        "uint8",  // social
        "uint8",  // reliability
        "uint8",  // trust
        "uint8",  // composite
        "uint64", // dataPoints
        "uint64", // computedAt (unix timestamp)
        "address", // agent wallet
      ],
      [
        score.financial,
        score.social,
        score.reliability,
        score.trust,
        score.composite,
        score.dataPoints,
        Math.floor(new Date(score.computedAt).getTime() / 1000),
        walletAddress,
      ]
    );

    // Create the attestation
    const eas = new ethers.Contract(
      this.config.easContractAddress,
      EAS_ABI,
      signer
    );

    const attestationRequest = {
      schema: schemaUid,
      data: {
        recipient: walletAddress,
        expirationTime: BigInt(0), // No expiration
        revocable: true,
        refUID: ethers.ZeroHash,
        data: encodedData,
        value: BigInt(0),
      },
    };

    const tx = await eas.attest(attestationRequest);
    const receipt = await tx.wait();

    // Parse the attestation UID from the event logs
    const uid = receipt.logs?.[0]?.topics?.[1] ?? ethers.ZeroHash;

    const result: AttestationResult = {
      uid,
      txHash: receipt.hash,
      chainId: this.config.chainId,
      schemaId: schemaUid,
      timestamp: new Date().toISOString(),
    };

    this.config.logger.info("Attestation created", result);
    return result;
  }

  /**
   * Read an existing attestation from on-chain.
   */
  async getAttestation(
    uid: string
  ): Promise<{ score: TrustScore; attester: string; timestamp: number } | null> {
    let ethers: typeof import("ethers");
    try {
      ethers = await import("ethers");
    } catch {
      throw new Error("ethers.js is required to read attestations.");
    }

    const rpcUrl = this.config.rpcUrl ?? this.getRpcUrl(this.config.chainId);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const eas = new ethers.Contract(
      this.config.easContractAddress,
      EAS_ABI,
      provider
    );

    try {
      const attestation = await eas.getAttestation(uid);
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const decoded = abiCoder.decode(
        [
          "uint8",
          "uint8",
          "uint8",
          "uint8",
          "uint8",
          "uint64",
          "uint64",
          "address",
        ],
        attestation.data
      );

      return {
        score: {
          financial: Number(decoded[0]),
          social: Number(decoded[1]),
          reliability: Number(decoded[2]),
          trust: Number(decoded[3]),
          composite: Number(decoded[4]),
          dataPoints: Number(decoded[5]),
          computedAt: new Date(Number(decoded[6]) * 1000).toISOString(),
        },
        attester: attestation.attester,
        timestamp: Number(attestation.time),
      };
    } catch (err) {
      this.config.logger.warn("Failed to read attestation", err);
      return null;
    }
  }

  // ── Internal ────────────────────────────────────────────

  private async ensureSchema(
    ethers: typeof import("ethers"),
    signer: import("ethers").Wallet
  ): Promise<string> {
    if (this.schemaUid) return this.schemaUid;

    // In production, the schema is pre-registered and the UID is known.
    // For now, we use a deterministic UID based on the schema string.
    // TODO: Replace with actual registered schema UID once deployed.
    this.schemaUid = ethers.keccak256(
      ethers.toUtf8Bytes(PROOFLAYER_SCHEMA)
    );

    this.config.logger.debug("Using schema UID", { uid: this.schemaUid });
    return this.schemaUid;
  }

  private getRpcUrl(chainId: number): string {
    const rpcs: Record<number, string> = {
      8453: "https://mainnet.base.org",
      84532: "https://sepolia.base.org",
      1: "https://eth.llamarpc.com",
    };
    return rpcs[chainId] ?? `https://rpc.ankr.com/eth`;
  }
}
