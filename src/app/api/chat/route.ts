// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * POST /api/chat
 *
 * Bridges the in-canvas chat panel to Claude via the Anthropic SDK.
 *
 * The system prompt teaches Claude about Morpheus's mental model so that
 * users can describe a strategy in natural language and get back a
 * structured response that includes deep link URLs they can open with one
 * click. Tool calling is intentionally NOT enabled in v1 — Claude responds
 * in markdown and the user takes the action manually. We ship the UI loop
 * first, tools come in a later iteration.
 *
 * Requires `ANTHROPIC_API_KEY` env var. When the key is missing, the route
 * returns a 503 with a helpful message — the panel stays usable as a UI
 * scaffold, just no AI replies.
 */

import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs"; // Anthropic SDK needs Node runtime
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are an AI assistant inside Morpheus, a visual node-graph editor for composing Morpho lending strategies on Ethereum and Base.

# Your role
Help the user design a lending strategy. They describe a goal in natural language. You reply with:
1. A short explanation of the strategy you'd recommend
2. A list of the nodes the user should drag onto their canvas (in order)
3. The Morpho markets and vaults you suggest, with their addresses if you know them
4. Risk warnings (health factor, liquidation, slippage, vault concentration)

# Morpheus mental model
A canvas is a directed graph. Each node represents one DeFi action. Edges express data flow.

Node types and their valid connections:
- wallet: source. Connects to: supplyCollateral, swap, repay
- supplyCollateral: supply ERC-20 as collateral. Connects from wallet/swap/vaultWithdraw/position. Connects to: borrow, vaultDeposit
- borrow: borrow loan asset from a Morpho Blue market. Connects from supplyCollateral. Connects to: swap, vaultDeposit
- swap: CowSwap intent (Ethereum mainnet only — Base not supported by CoW). Connects from wallet/borrow/vaultWithdraw. Connects to: vaultDeposit, supplyCollateral, wallet, repay
- vaultDeposit: deposit into a Morpho Vault. Terminal node.
- vaultWithdraw: withdraw from existing vault position. Connects from position. Connects to: swap, vaultDeposit, supplyCollateral, repay
- repay: repay a Morpho Blue borrow. Terminal.
- position: read-only existing on-chain position.

# Canonical strategies (templates already built into Morpheus)
1. Looped wstETH (Ethereum): leveraged Lido staking
2. Borrow & Yield (Ethereum or Base): supply WETH, borrow USDC, deposit USDC into a high-APY vault
3. Multi-Collateral Diversified (Ethereum): supply wstETH + WBTC, borrow USDC, deposit
4. Base WETH Carry: same as Borrow & Yield but on Base

If the user's request maps to one of these templates, recommend they click "Templates" in the sidebar and pick it. Otherwise, walk them through the manual node setup.

# Key Morpho protocol facts
- Morpho Blue is at 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb on both Ethereum and Base
- Markets are isolated lending pools defined by (loanToken, collateralToken, oracle, irm, lltv)
- Vaults are ERC-4626 aggregators that allocate across markets
- LLTV is the liquidation threshold; HF = (collateral × LLTV) / borrow; HF >= 1.0 = safe
- Use Morpho Vaults V2 for new deployments, not MetaMorpho V1 (incompatible ABIs)
- USDC on Ethereum: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 (6 decimals)
- USDC on Base: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (6 decimals)
- WETH on Ethereum: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 (18 decimals)
- WETH on Base: 0x4200000000000000000000000000000000000006 (18 decimals)
- wstETH on Ethereum: 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0 (18 decimals)

# Rules
- Never invent market IDs or vault addresses. If you don't know one, tell the user to use the dropdowns inside the BorrowNode or VaultDepositNode.
- Always warn about health factor when recommending borrow strategies. Below 1.5 is risky. Below 1.2 is dangerous.
- For full vault exits, use redeem (Morpheus does this automatically when amount >= 99% of position).
- CowSwap only works on Ethereum mainnet. On Base, suggest a different swap route or skip the swap.
- Bundler3 is deprecated in Morpho. Morpheus is being migrated to @morpho-org/bundler-sdk-viem — don't recommend Bundler3 patterns directly.
- Reply in the user's language (French if they write in French, English otherwise).
- Be concise. The chat panel is small. Use markdown sparingly: bold for nodes, code for addresses, no large headers.`;

interface ChatRequestBody {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonError(
      503,
      "Chat is not configured on this deployment. Set the ANTHROPIC_API_KEY environment variable to enable the AI assistant."
    );
  }

  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonError(400, "Body must include a non-empty `messages` array");
  }

  // Cap message count and length to avoid runaway costs
  if (body.messages.length > 30) {
    return jsonError(400, "Conversation too long (max 30 messages)");
  }
  for (const m of body.messages) {
    if (
      !m ||
      (m.role !== "user" && m.role !== "assistant") ||
      typeof m.content !== "string"
    ) {
      return jsonError(400, "Each message must have role and string content");
    }
    if (m.content.length > 4000) {
      return jsonError(400, "Message too long (max 4000 chars)");
    }
  }

  const client = new Anthropic({ apiKey });

  // Allow overriding the model via env var. Defaults to Haiku for cost.
  // For higher quality answers, set ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
  const model = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: body.messages,
    });

    // Extract text from the response (Claude may return multiple content blocks)
    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join("\n");

    return new Response(
      JSON.stringify({
        text,
        usage: response.usage,
      }),
      {
        status: 200,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[chat] Anthropic call failed:", msg);
    return jsonError(500, `AI request failed: ${msg.slice(0, 200)}`);
  }
}
