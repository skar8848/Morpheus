import type { Edge, Connection } from "@xyflow/react";
import type { CanvasNode } from "./types";
import { VALID_CONNECTIONS } from "./types";
import { isAddress } from "viem";

/** Safe parseFloat that rejects NaN, Infinity, and negatives */
function safeParseAmount(value: string | undefined | null): number {
  if (!value) return 0;
  const num = parseFloat(value);
  if (!isFinite(num) || num < 0) return 0;
  return num;
}

/** Validate decimals is a reasonable number (0-18) */
function isValidDecimals(decimals: unknown): decimals is number {
  return typeof decimals === "number" && Number.isInteger(decimals) && decimals >= 0 && decimals <= 18;
}

/** Validate an Ethereum address format */
function isValidAddr(addr: unknown): addr is string {
  return typeof addr === "string" && isAddress(addr);
}

/**
 * Check if a connection between two nodes is valid based on VALID_CONNECTIONS map.
 */
export function isValidConnection(
  connection: Connection,
  nodes: CanvasNode[]
): boolean {
  const sourceNode = nodes.find((n) => n.id === connection.source);
  const targetNode = nodes.find((n) => n.id === connection.target);

  if (!sourceNode || !targetNode) return false;

  // Reject self-loops
  if (connection.source === connection.target) return false;

  const sourceType = (sourceNode.data as { type?: string }).type;
  const targetType = (targetNode.data as { type?: string }).type;

  if (!sourceType || !targetType) return false;

  const allowed = VALID_CONNECTIONS[sourceType];
  if (!allowed) return false;

  return allowed.includes(targetType);
}

/**
 * Get a hint message for invalid connection attempts.
 * Returns null if no specific hint applies.
 */
export function getConnectionHint(
  connection: Connection,
  nodes: CanvasNode[]
): { message: string; highlightType: string } | null {
  const sourceNode = nodes.find((n) => n.id === connection.source);
  const targetNode = nodes.find((n) => n.id === connection.target);

  if (!sourceNode || !targetNode) return null;

  const sourceType = (sourceNode.data as { type?: string }).type;
  const targetType = (targetNode.data as { type?: string }).type;

  if (!sourceType || !targetType) return null;

  if (sourceType === "swap" && targetType === "borrow") {
    return {
      message: "You need to supply collateral first",
      highlightType: "supplyCollateral",
    };
  }

  if (sourceType === "wallet" && targetType === "borrow") {
    return {
      message: "You need to supply collateral first",
      highlightType: "supplyCollateral",
    };
  }

  if (sourceType === "borrow" && targetType === "borrow") {
    return {
      message: "Connect borrow output to a swap or vault deposit",
      highlightType: "swap",
    };
  }

  if (sourceType === "wallet" && targetType === "vaultDeposit") {
    return {
      message: "Supply collateral first, then borrow to deposit into a vault",
      highlightType: "supplyCollateral",
    };
  }

  return null;
}

/**
 * Validate entire graph — returns list of error messages (empty = valid).
 * Includes cycle detection, address validation, and amount bounds checking.
 */
export function validateGraph(
  nodes: CanvasNode[],
  edges: Edge[]
): string[] {
  const errors: string[] = [];

  // --- Self-loop and duplicate edge detection ---
  const seenEdges = new Set<string>();
  for (const edge of edges) {
    if (edge.source === edge.target) {
      errors.push(`Edge ${edge.id}: self-loop not allowed`);
    }
    const edgeKey = `${edge.source}->${edge.target}`;
    if (seenEdges.has(edgeKey)) {
      errors.push(`Duplicate edge: ${edge.source} → ${edge.target}`);
    }
    seenEdges.add(edgeKey);
  }

  // --- Cycle detection via topological sort ---
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjList.set(node.id, []);
  }
  for (const edge of edges) {
    // Validate edge references exist
    if (!inDegree.has(edge.source) || !inDegree.has(edge.target)) {
      errors.push(`Edge ${edge.id}: references non-existent node`);
      continue;
    }
    if (edge.source === edge.target) continue; // skip self-loops (already reported)
    adjList.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  let sortedCount = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    sortedCount++;
    for (const neighbor of adjList.get(id) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }
  if (sortedCount < nodes.length) {
    errors.push("Graph contains a cycle — remove circular connections");
  }

  // --- Node-level validation ---
  for (const node of nodes) {
    const data = node.data as { type?: string };
    if (!data.type) {
      errors.push(`Node ${node.id}: missing type`);
      continue;
    }

    switch (data.type) {
      case "supplyCollateral": {
        const d = node.data as { asset?: { address?: string; decimals?: number }; amount?: string };
        if (!d.asset) {
          errors.push(`Supply node: no asset selected`);
        } else {
          if (!isValidAddr(d.asset.address))
            errors.push(`Supply node: invalid asset address`);
          if (!isValidDecimals(d.asset.decimals))
            errors.push(`Supply node: invalid decimals`);
        }
        const amt = safeParseAmount(d.amount);
        if (amt <= 0) errors.push(`Supply node: no amount set`);
        break;
      }
      case "borrow": {
        const d = node.data as {
          market?: {
            loanAsset?: { address?: string; decimals?: number };
            collateralAsset?: { address?: string };
            oracle?: { address?: string };
            irmAddress?: string;
            lltv?: string;
          };
          borrowAmount?: number;
        };
        if (!d.market) {
          errors.push(`Borrow node: no market selected`);
        } else {
          if (!isValidAddr(d.market.loanAsset?.address))
            errors.push(`Borrow node: invalid loan asset address`);
          if (!isValidAddr(d.market.collateralAsset?.address))
            errors.push(`Borrow node: invalid collateral asset address`);
          if (!isValidAddr(d.market.oracle?.address))
            errors.push(`Borrow node: invalid oracle address`);
          if (!isValidAddr(d.market.irmAddress))
            errors.push(`Borrow node: invalid IRM address`);
          if (!isValidDecimals(d.market.loanAsset?.decimals))
            errors.push(`Borrow node: invalid loan decimals`);
          // Validate LLTV is a valid bigint string
          const lltv = Number(d.market.lltv ?? "0") / 1e18;
          if (!isFinite(lltv) || lltv <= 0 || lltv > 1)
            errors.push(`Borrow node: invalid LLTV value`);
        }
        if (!d.borrowAmount || !isFinite(d.borrowAmount) || d.borrowAmount <= 0)
          errors.push(`Borrow node: no borrow amount`);
        break;
      }
      case "swap": {
        const d = node.data as {
          tokenIn?: { address?: string };
          tokenOut?: { address?: string };
          amountIn?: string;
        };
        if (!d.tokenIn || !d.tokenOut)
          errors.push(`Swap node: missing token`);
        else {
          if (!isValidAddr(d.tokenIn.address))
            errors.push(`Swap node: invalid tokenIn address`);
          if (!isValidAddr(d.tokenOut.address))
            errors.push(`Swap node: invalid tokenOut address`);
        }
        if (safeParseAmount(d.amountIn) <= 0)
          errors.push(`Swap node: no amount`);
        break;
      }
      case "vaultDeposit": {
        const d = node.data as {
          vault?: { address?: string; asset?: { decimals?: number } };
          amount?: string;
        };
        if (!d.vault) {
          errors.push(`Vault deposit node: no vault selected`);
        } else {
          if (!isValidAddr(d.vault.address))
            errors.push(`Vault deposit node: invalid vault address`);
          if (!isValidDecimals(d.vault.asset?.decimals))
            errors.push(`Vault deposit node: invalid decimals`);
        }
        if (safeParseAmount(d.amount) <= 0)
          errors.push(`Vault deposit node: no amount`);
        break;
      }
      case "vaultWithdraw": {
        const d = node.data as {
          position?: { vault?: { address?: string; asset?: { decimals?: number } } };
          amount?: string;
        };
        if (!d.position) {
          errors.push(`Withdraw node: no position selected`);
        } else {
          if (!isValidAddr(d.position.vault?.address))
            errors.push(`Withdraw node: invalid vault address`);
          if (!isValidDecimals(d.position.vault?.asset?.decimals))
            errors.push(`Withdraw node: invalid decimals`);
        }
        if (safeParseAmount(d.amount) <= 0)
          errors.push(`Withdraw node: no amount`);
        break;
      }
    }
  }

  // Check for disconnected non-wallet/position nodes
  for (const node of nodes) {
    const data = node.data as { type?: string };
    if (data.type === "wallet" || data.type === "position" || data.type === "vaultWithdraw") continue;

    const hasIncoming = edges.some((e) => e.target === node.id);
    if (!hasIncoming) {
      errors.push(`${data.type} node: not connected to any input`);
    }
  }

  return errors;
}
