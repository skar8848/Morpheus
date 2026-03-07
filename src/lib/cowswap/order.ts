import { signTypedData } from "wagmi/actions";
import { wagmiConfig } from "@/lib/web3/config";

const COW_API_BASE: Record<number, string> = {
  1: "https://api.cow.fi/mainnet/api/v1",
  8453: "https://api.cow.fi/base/api/v1",
};

// GPv2Settlement — same address on all EVM chains
const GPV2_SETTLEMENT =
  "0x9008D19f58AAbD9eD0D60971565AA8510560ab41" as `0x${string}`;

// CowSwap VaultRelayer — user must approve sell tokens to this address
export const COW_VAULT_RELAYER: Record<number, `0x${string}`> = {
  1: "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110" as `0x${string}`,
  8453: "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110" as `0x${string}`,
};

const ORDER_TYPES = {
  Order: [
    { name: "sellToken", type: "address" },
    { name: "buyToken", type: "address" },
    { name: "receiver", type: "address" },
    { name: "sellAmount", type: "uint256" },
    { name: "buyAmount", type: "uint256" },
    { name: "validTo", type: "uint32" },
    { name: "appData", type: "bytes32" },
    { name: "feeAmount", type: "uint256" },
    { name: "kind", type: "string" },
    { name: "partiallyFillable", type: "bool" },
    { name: "sellTokenBalance", type: "string" },
    { name: "buyTokenBalance", type: "string" },
  ],
} as const;

export interface CowQuoteOrder {
  sellToken: string;
  buyToken: string;
  receiver: string;
  sellAmount: string;
  buyAmount: string;
  validTo: number;
  appData: string;
  feeAmount: string;
  kind: string;
  partiallyFillable: boolean;
  sellTokenBalance: string;
  buyTokenBalance: string;
}

export interface CowQuoteResponse {
  quote: CowQuoteOrder;
  from: string;
  expiration: string;
  id: number;
}

/**
 * Get a fresh CowSwap quote with the actual user address (not zero address).
 * This quote can be signed and submitted as an order.
 */
export async function getCowQuote(
  chainId: number,
  sellToken: string,
  buyToken: string,
  sellAmountWei: string,
  userAddress: string
): Promise<CowQuoteResponse> {
  const apiBase = COW_API_BASE[chainId];
  if (!apiBase) throw new Error(`CowSwap not supported on chain ${chainId}`);

  const res = await fetch(`${apiBase}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sellToken,
      buyToken,
      sellAmountBeforeFee: sellAmountWei,
      kind: "sell",
      from: userAddress,
      receiver: userAddress,
      priceQuality: "optimal",
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.description ?? `CowSwap quote error ${res.status}`);
  }

  return res.json();
}

/**
 * Sign the CowSwap order with EIP-712 and submit it to the CowSwap API.
 * Returns the order UID for tracking.
 */
export async function signAndSubmitOrder(
  chainId: number,
  quote: CowQuoteResponse,
  userAddress: string
): Promise<string> {
  const apiBase = COW_API_BASE[chainId];
  if (!apiBase) throw new Error(`CowSwap not supported on chain ${chainId}`);

  const order = quote.quote;

  // EIP-712 signature
  const signature = await signTypedData(wagmiConfig, {
    domain: {
      name: "Gnosis Protocol",
      version: "v2",
      chainId,
      verifyingContract: GPV2_SETTLEMENT,
    },
    types: ORDER_TYPES,
    primaryType: "Order",
    message: {
      sellToken: order.sellToken as `0x${string}`,
      buyToken: order.buyToken as `0x${string}`,
      receiver: (order.receiver || userAddress) as `0x${string}`,
      sellAmount: BigInt(order.sellAmount),
      buyAmount: BigInt(order.buyAmount),
      validTo: order.validTo,
      appData: order.appData as `0x${string}`,
      feeAmount: BigInt(order.feeAmount),
      kind: order.kind,
      partiallyFillable: order.partiallyFillable,
      sellTokenBalance: order.sellTokenBalance,
      buyTokenBalance: order.buyTokenBalance,
    },
  });

  // Submit to CowSwap orderbook
  const submitRes = await fetch(`${apiBase}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sellToken: order.sellToken,
      buyToken: order.buyToken,
      receiver: order.receiver || userAddress,
      sellAmount: order.sellAmount,
      buyAmount: order.buyAmount,
      validTo: order.validTo,
      appData: order.appData,
      feeAmount: order.feeAmount,
      kind: order.kind,
      partiallyFillable: order.partiallyFillable,
      sellTokenBalance: order.sellTokenBalance,
      buyTokenBalance: order.buyTokenBalance,
      from: userAddress,
      signature,
      signingScheme: "eip712",
    }),
  });

  if (!submitRes.ok) {
    const err = await submitRes.json().catch(() => null);
    throw new Error(
      err?.description ?? `CowSwap order submission error ${submitRes.status}`
    );
  }

  // Response is the order UID (JSON string)
  const uid: string = await submitRes.json();
  return uid;
}

/**
 * Poll CowSwap order status until filled, cancelled, or timeout.
 * Returns the actual executed buy amount (raw wei string).
 */
export async function pollOrderUntilFilled(
  chainId: number,
  orderUid: string,
  onStatus?: (status: string) => void,
  timeoutMs: number = 300_000, // 5 minutes
  pollIntervalMs: number = 3_000
): Promise<{ executedBuyAmount: string; executedSellAmount: string }> {
  const apiBase = COW_API_BASE[chainId];
  if (!apiBase) throw new Error(`CowSwap not supported on chain ${chainId}`);

  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${apiBase}/orders/${orderUid}`);
      if (res.ok) {
        const data = await res.json();
        const status = data.status as string;
        onStatus?.(status);

        if (status === "fulfilled") {
          return {
            executedBuyAmount: data.executedBuyAmount ?? "0",
            executedSellAmount: data.executedSellAmount ?? "0",
          };
        }
        if (status === "cancelled" || status === "expired") {
          throw new Error(`CowSwap order ${status}`);
        }
      }
    } catch (err) {
      // Re-throw cancel/expire, ignore network errors
      if (
        err instanceof Error &&
        (err.message.includes("cancelled") || err.message.includes("expired"))
      ) {
        throw err;
      }
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error("CowSwap order timed out (5 min). Check order status manually.");
}
