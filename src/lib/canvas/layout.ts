import type { Edge } from "@xyflow/react";
import type { CanvasNode } from "./types";
import type {
  UserMarketPosition,
  UserVaultPosition,
} from "@/lib/graphql/types";
import { safeBigInt } from "@/lib/utils/bigint";

const COLUMN_X = {
  wallet: 50,
  positions: 50,
  borrows: 400,
  vaults: 750,
};
const ROW_SPACING = 200;
const START_Y = 80;

/**
 * Build initial canvas layout from wallet + existing positions.
 */
export function buildInitialLayout(
  address: string | undefined,
  chain: string,
  chainId: number,
  marketPositions: UserMarketPosition[],
  vaultPositions: UserVaultPosition[]
): CanvasNode[] {
  const nodes: CanvasNode[] = [];
  let walletY = START_Y;

  // Wallet node
  nodes.push({
    id: "wallet-1",
    type: "walletNode",
    position: { x: COLUMN_X.wallet, y: walletY },
    data: {
      type: "wallet",
      address,
      chain,
      chainId,
      balances: [],
    },
  });

  // Borrow positions
  const borrowPositions = marketPositions.filter(
    (p) => p.state && p.state.borrowAssets && safeBigInt(p.state.borrowAssets) > 0n
  );
  borrowPositions.forEach((pos, i) => {
    nodes.push({
      id: `position-borrow-${pos.market.uniqueKey}`,
      type: "positionNode",
      position: { x: COLUMN_X.borrows, y: START_Y + i * ROW_SPACING },
      data: {
        type: "position",
        positionType: "borrow",
        marketPosition: pos,
        vaultPosition: null,
      },
    });
  });

  // Vault positions
  vaultPositions.forEach((pos, i) => {
    nodes.push({
      id: `position-vault-${pos.vault.address}`,
      type: "positionNode",
      position: {
        x: COLUMN_X.vaults,
        y: START_Y + i * ROW_SPACING,
      },
      data: {
        type: "position",
        positionType: "vault",
        vaultPosition: pos,
        marketPosition: null,
      },
    });
  });

  // Supply-only positions
  const supplyPositions = marketPositions.filter(
    (p) =>
      p.state &&
      p.state.supplyAssets &&
      safeBigInt(p.state.supplyAssets) > 0n &&
      !(p.state.borrowAssets && safeBigInt(p.state.borrowAssets) > 0n)
  );
  const offsetY = borrowPositions.length * ROW_SPACING;
  supplyPositions.forEach((pos, i) => {
    nodes.push({
      id: `position-supply-${pos.market.uniqueKey}`,
      type: "positionNode",
      position: {
        x: COLUMN_X.borrows,
        y: START_Y + offsetY + i * ROW_SPACING,
      },
      data: {
        type: "position",
        positionType: "supply",
        marketPosition: pos,
        vaultPosition: null,
      },
    });
  });

  return nodes;
}

/**
 * Auto-organize nodes into clean columns based on graph depth.
 * Roots (no incoming edges) at column 0, then BFS outward.
 */
const ORGANIZE_COL_SPACING = 350;
const ORGANIZE_ROW_SPACING = 180;
const ORGANIZE_START_X = 80;
const ORGANIZE_START_Y = 80;

export function organizeLayout(
  nodes: CanvasNode[],
  edges: Edge[]
): CanvasNode[] {
  if (nodes.length === 0) return nodes;

  // Build adjacency
  const incoming = new Map<string, string[]>(); // nodeId → source ids
  const outgoing = new Map<string, string[]>(); // nodeId → target ids
  for (const n of nodes) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  }
  for (const e of edges) {
    if (!incoming.has(e.target) || !outgoing.has(e.source)) continue;
    incoming.get(e.target)!.push(e.source);
    outgoing.get(e.source)!.push(e.target);
  }

  // Assign depth via BFS from roots
  const depth = new Map<string, number>();
  const roots = nodes.filter((n) => incoming.get(n.id)!.length === 0);

  // If no roots (cycle), use all nodes as roots at depth 0
  const queue: string[] = [];
  if (roots.length === 0) {
    for (const n of nodes) {
      depth.set(n.id, 0);
      queue.push(n.id);
    }
  } else {
    for (const r of roots) {
      depth.set(r.id, 0);
      queue.push(r.id);
    }
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const d = depth.get(id)!;
    for (const target of outgoing.get(id) ?? []) {
      const existing = depth.get(target);
      // Always push deeper (max depth wins)
      if (existing === undefined || d + 1 > existing) {
        depth.set(target, d + 1);
        queue.push(target);
      }
    }
  }

  // Handle disconnected nodes (no edges at all)
  for (const n of nodes) {
    if (!depth.has(n.id)) {
      depth.set(n.id, 0);
    }
  }

  // Group by column
  const columns = new Map<number, CanvasNode[]>();
  for (const n of nodes) {
    const col = depth.get(n.id)!;
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col)!.push(n);
  }

  // Sort columns by key, sort nodes within columns to keep connected ones adjacent
  const sortedCols = [...columns.keys()].sort((a, b) => a - b);

  // Position nodes
  const positioned = new Map<string, { x: number; y: number }>();

  for (const col of sortedCols) {
    const colNodes = columns.get(col)!;
    const x = ORGANIZE_START_X + col * ORGANIZE_COL_SPACING;

    // Sort nodes within column: try to align with their source's y position
    colNodes.sort((a, b) => {
      const aSourceY = getAvgSourceY(a.id, incoming, positioned);
      const bSourceY = getAvgSourceY(b.id, incoming, positioned);
      return aSourceY - bSourceY;
    });

    // Center the column vertically
    const totalHeight = (colNodes.length - 1) * ORGANIZE_ROW_SPACING;
    const startY = ORGANIZE_START_Y + Math.max(0, (nodes.length > 6 ? 0 : (300 - totalHeight) / 2));

    for (let i = 0; i < colNodes.length; i++) {
      positioned.set(colNodes[i].id, { x, y: startY + i * ORGANIZE_ROW_SPACING });
    }
  }

  // Return new nodes with updated positions
  return nodes.map((n) => ({
    ...n,
    position: positioned.get(n.id) ?? n.position,
  }));
}

/** Average y position of a node's sources (for vertical alignment) */
function getAvgSourceY(
  nodeId: string,
  incoming: Map<string, string[]>,
  positioned: Map<string, { x: number; y: number }>
): number {
  const sources = incoming.get(nodeId) ?? [];
  const ys = sources
    .map((s) => positioned.get(s)?.y)
    .filter((y): y is number => y !== undefined);
  if (ys.length === 0) return 0;
  return ys.reduce((a, b) => a + b, 0) / ys.length;
}
