import type { Edge, Connection } from "@xyflow/react";
import type { CanvasNode } from "./types";
import { VALID_CONNECTIONS } from "./types";

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

  const sourceType = (sourceNode.data as { type: string }).type;
  const targetType = (targetNode.data as { type: string }).type;

  const allowed = VALID_CONNECTIONS[sourceType];
  if (!allowed) return false;

  return allowed.includes(targetType);
}

/**
 * Validate entire graph — returns list of error messages (empty = valid).
 */
export function validateGraph(
  nodes: CanvasNode[],
  edges: Edge[]
): string[] {
  const errors: string[] = [];

  for (const node of nodes) {
    const data = node.data as { type: string };

    // Check required fields per node type
    switch (data.type) {
      case "supplyCollateral": {
        const d = node.data as { asset: unknown; amount: string };
        if (!d.asset) errors.push(`Supply node ${node.id}: no asset selected`);
        if (!d.amount || parseFloat(d.amount) <= 0)
          errors.push(`Supply node ${node.id}: no amount set`);
        break;
      }
      case "borrow": {
        const d = node.data as { market: unknown; borrowAmount: number };
        if (!d.market) errors.push(`Borrow node ${node.id}: no market selected`);
        if (!d.borrowAmount || d.borrowAmount <= 0)
          errors.push(`Borrow node ${node.id}: no borrow amount`);
        break;
      }
      case "swap": {
        const d = node.data as {
          tokenIn: unknown;
          tokenOut: unknown;
          amountIn: string;
        };
        if (!d.tokenIn || !d.tokenOut)
          errors.push(`Swap node ${node.id}: missing token`);
        if (!d.amountIn || parseFloat(d.amountIn) <= 0)
          errors.push(`Swap node ${node.id}: no amount`);
        break;
      }
      case "vaultDeposit": {
        const d = node.data as { vault: unknown; amount: string };
        if (!d.vault) errors.push(`Vault node ${node.id}: no vault selected`);
        if (!d.amount || parseFloat(d.amount) <= 0)
          errors.push(`Vault node ${node.id}: no amount`);
        break;
      }
      case "vaultWithdraw": {
        const d = node.data as { position: unknown; amount: string };
        if (!d.position)
          errors.push(`Withdraw node ${node.id}: no position selected`);
        if (!d.amount || parseFloat(d.amount) <= 0)
          errors.push(`Withdraw node ${node.id}: no amount`);
        break;
      }
    }
  }

  // Check for disconnected non-wallet/position nodes
  for (const node of nodes) {
    const data = node.data as { type: string };
    if (data.type === "wallet" || data.type === "position") continue;

    const hasIncoming = edges.some((e) => e.target === node.id);
    if (!hasIncoming) {
      errors.push(`${data.type} node ${node.id}: not connected to any input`);
    }
  }

  return errors;
}
