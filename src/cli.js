#!/usr/bin/env node
// ============================================================
// ProofLayer CLI
// Usage:
//   npx prooflayer score <wallet>        — View trust score
//   npx prooflayer report <wallet>       — Full report card
//   npx prooflayer check <wallet> [min]  — Trust gate check
//   npx prooflayer verify <wallet>       — Check verification badge
// ============================================================

const API_URL = process.env.PROOFLAYER_API_URL || "https://api.prooflayer.net";
const API_KEY = process.env.PROOFLAYER_API_KEY || "";

// ── ANSI colors ─────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

// ── Tier colors ─────────────────────────────────────────

function tierColor(tier) {
  switch (tier) {
    case "Platinum": return c.cyan;
    case "Gold": return c.yellow;
    case "Silver": return c.white;
    case "Bronze": return c.magenta;
    default: return c.gray;
  }
}

function scoreColor(score) {
  if (score >= 90) return c.cyan;
  if (score >= 75) return c.green;
  if (score >= 55) return c.yellow;
  if (score >= 30) return c.magenta;
  return c.red;
}

// ── Score bar visualization ─────────────────────────────

function scoreBar(label, score, width = 30) {
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const color = scoreColor(score);
  const paddedLabel = label.padEnd(12);
  return `  ${c.bold}${paddedLabel}${c.reset} ${color}${bar}${c.reset} ${color}${score}${c.reset}/100`;
}

// ── API fetch ───────────────────────────────────────────

async function apiFetch(path) {
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

  const res = await fetch(`${API_URL}${path}`, { headers });
  if (!res.ok) {
    throw new Error(`API returned ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

// ── Commands ────────────────────────────────────────────

async function showScore(wallet) {
  console.log(`\n${c.dim}Fetching score for ${wallet}...${c.reset}\n`);

  try {
    const result = await apiFetch(`/v1/score/${wallet}`);
    const score = result.data || result;

    console.log(`${c.bold}╔══════════════════════════════════════════════╗${c.reset}`);
    console.log(`${c.bold}║         PROOFLAYER TRUST SCORE               ║${c.reset}`);
    console.log(`${c.bold}╚══════════════════════════════════════════════╝${c.reset}`);
    console.log();
    console.log(`  ${c.dim}Agent:${c.reset}  ${wallet}`);
    console.log();

    console.log(scoreBar("Financial", score.financial));
    console.log(scoreBar("Social", score.social));
    console.log(scoreBar("Reliability", score.reliability));
    console.log(scoreBar("Trust", score.trust));
    console.log();

    const compColor = scoreColor(score.composite);
    console.log(`  ${c.bold}Composite:${c.reset}   ${compColor}${c.bold}${score.composite}${c.reset}/100`);

    const tier = getTier(score.composite);
    const tc = tierColor(tier);
    console.log(`  ${c.bold}Tier:${c.reset}        ${tc}${c.bold}${tier}${c.reset}`);
    console.log(`  ${c.dim}Data points: ${score.dataPoints || "N/A"}${c.reset}`);
    console.log(`  ${c.dim}Computed:    ${score.computedAt || "N/A"}${c.reset}`);
    console.log();
  } catch (err) {
    handleError(err, wallet);
  }
}

async function showReport(wallet) {
  console.log(`\n${c.dim}Fetching report card for ${wallet}...${c.reset}\n`);

  try {
    const result = await apiFetch(`/v1/report/${wallet}`);
    const report = result.data || result;
    const score = report.score;

    console.log(`${c.bold}╔══════════════════════════════════════════════╗${c.reset}`);
    console.log(`${c.bold}║       PROOFLAYER REPORT CARD                 ║${c.reset}`);
    console.log(`${c.bold}╚══════════════════════════════════════════════╝${c.reset}`);
    console.log();
    console.log(`  ${c.dim}Agent:${c.reset}       ${report.walletAddress}`);

    const tc = tierColor(report.tier);
    console.log(`  ${c.bold}Tier:${c.reset}        ${tc}${c.bold}${report.tier}${c.reset}`);
    console.log(`  ${c.bold}Verified:${c.reset}    ${report.verified ? `${c.green}✓ YES${c.reset}` : `${c.gray}✗ No${c.reset}`}`);
    console.log();

    if (score) {
      console.log(scoreBar("Financial", score.financial));
      console.log(scoreBar("Social", score.social));
      console.log(scoreBar("Reliability", score.reliability));
      console.log(scoreBar("Trust", score.trust));
      console.log();

      const compColor = scoreColor(score.composite);
      console.log(`  ${c.bold}Composite:${c.reset}   ${compColor}${c.bold}${score.composite}${c.reset}/100`);
    }

    console.log();
    console.log(`  ${c.dim}First seen:     ${report.firstSeen || "N/A"}${c.reset}`);
    console.log(`  ${c.dim}Last seen:      ${report.lastSeen || "N/A"}${c.reset}`);
    console.log(`  ${c.dim}Events tracked: ${report.totalEventsTracked || "N/A"}${c.reset}`);
    if (report.attestationUid) {
      console.log(`  ${c.dim}Attestation:    ${report.attestationUid}${c.reset}`);
    }
    console.log();
  } catch (err) {
    handleError(err, wallet);
  }
}

async function checkTrust(wallet, minScore) {
  const min = parseInt(minScore) || 50;
  console.log(`\n${c.dim}Checking trust for ${wallet} (min: ${min})...${c.reset}\n`);

  try {
    const res = await fetch(`${API_URL}/v1/trust/check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      body: JSON.stringify({ walletAddress: wallet, minComposite: min }),
    });
    const result = await res.json();
    const data = result.data || result;

    if (data.allowed) {
      console.log(`  ${c.green}${c.bold}✓ TRUSTED${c.reset}`);
    } else {
      console.log(`  ${c.red}${c.bold}✗ NOT TRUSTED${c.reset}`);
    }
    console.log(`  ${c.dim}Score:${c.reset}  ${scoreColor(data.score)}${data.score}${c.reset}/100`);
    console.log(`  ${c.dim}Tier:${c.reset}   ${tierColor(data.tier)}${data.tier}${c.reset}`);
    if (data.reason) {
      console.log(`  ${c.dim}Reason:${c.reset} ${data.reason}`);
    }
    console.log();
  } catch (err) {
    handleError(err, wallet);
  }
}

async function checkVerified(wallet) {
  console.log(`\n${c.dim}Checking verification for ${wallet}...${c.reset}\n`);

  try {
    const result = await apiFetch(`/v1/badges/${wallet}`);
    const data = result.data || result;

    if (data.verified) {
      console.log(`  ${c.green}${c.bold}✓ VERIFIED${c.reset}`);
      console.log(`  ${c.dim}This agent holds a ProofLayer verification badge.${c.reset}`);
    } else {
      console.log(`  ${c.gray}✗ Not verified${c.reset}`);
      console.log(`  ${c.dim}This agent does not have a verification badge yet.${c.reset}`);
    }
    console.log();
  } catch (err) {
    handleError(err, wallet);
  }
}

// ── Helpers ─────────────────────────────────────────────

function getTier(composite) {
  if (composite >= 90) return "Platinum";
  if (composite >= 75) return "Gold";
  if (composite >= 55) return "Silver";
  if (composite >= 30) return "Bronze";
  return "Unverified";
}

function handleError(err, wallet) {
  if (err.message?.includes("fetch")) {
    console.log(`  ${c.yellow}⚠ Could not reach ProofLayer API at ${API_URL}${c.reset}`);
    console.log(`  ${c.dim}Set PROOFLAYER_API_URL env var if using a custom endpoint.${c.reset}`);
  } else {
    console.log(`  ${c.red}Error: ${err.message}${c.reset}`);
  }
  console.log();
}

function isValidAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

function printUsage() {
  console.log(`
${c.bold}ProofLayer CLI${c.reset} — Trust scoring for AI agents

${c.bold}Usage:${c.reset}
  npx prooflayer score  <wallet>         View trust score
  npx prooflayer report <wallet>         Full report card
  npx prooflayer check  <wallet> [min]   Trust gate check (default min: 50)
  npx prooflayer verify <wallet>         Check verification badge

${c.bold}Environment:${c.reset}
  PROOFLAYER_API_URL    API endpoint (default: https://api.prooflayer.net)
  PROOFLAYER_API_KEY    API key for premium features

${c.bold}Examples:${c.reset}
  ${c.dim}npx prooflayer score 0x1234...abcd${c.reset}
  ${c.dim}npx prooflayer check 0x1234...abcd 70${c.reset}
  ${c.dim}PROOFLAYER_API_KEY=pl_xxx npx prooflayer report 0x1234...abcd${c.reset}
`);
}

// ── Main ────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();
  const wallet = args[1];
  const extra = args[2];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  if (!wallet) {
    console.error(`\n  ${c.red}Error: wallet address required${c.reset}\n`);
    printUsage();
    process.exit(1);
  }

  if (!isValidAddress(wallet)) {
    console.error(`\n  ${c.red}Error: invalid Ethereum address: ${wallet}${c.reset}\n`);
    process.exit(1);
  }

  switch (command) {
    case "score":
      await showScore(wallet);
      break;
    case "report":
      await showReport(wallet);
      break;
    case "check":
      await checkTrust(wallet, extra);
      break;
    case "verify":
      await checkVerified(wallet);
      break;
    default:
      console.error(`\n  ${c.red}Unknown command: ${command}${c.reset}\n`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n  ${c.red}Fatal: ${err.message}${c.reset}\n`);
  process.exit(1);
});
