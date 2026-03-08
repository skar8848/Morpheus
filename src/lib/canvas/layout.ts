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
 * Auto-organize into a clean tree layout.
 *
 * Algorithm:
 * 1. Assign depth (columns) via BFS — max depth wins for convergent paths
 * 2. Forward pass (left→right): each node at avg Y of its sources.
 *    Siblings from the same parent are spread centered on parent.
 * 3. Center roots on their children so wallet sits at mid-height of branches.
 * 4. Normalize so top-left starts at (80, 80).
 *
 * Result: Wallet centered, branches fan out, convergent nodes (e.g. two
 * borrows → same vault) land at the midpoint of their sources.
 */
const COL_GAP = 350;
const ROW_GAP = 180;

export function organizeLayout(
  nodes: CanvasNode[],
  edges: Edge[]
): CanvasNode[] {
  if (nodes.length === 0) return nodes;

  // --- Adjacency ---
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const n of nodes) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  }
  for (const e of edges) {
    if (!incoming.has(e.target) || !outgoing.has(e.source)) continue;
    incoming.get(e.target)!.push(e.source);
    outgoing.get(e.source)!.push(e.target);
  }

  // --- Depth assignment (BFS, max depth wins) ---
  const depth = new Map<string, number>();
  const queue: string[] = [];
  const roots = nodes.filter((n) => incoming.get(n.id)!.length === 0);

  if (roots.length === 0) {
    for (const n of nodes) { depth.set(n.id, 0); queue.push(n.id); }
  } else {
    for (const r of roots) { depth.set(r.id, 0); queue.push(r.id); }
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const d = depth.get(id)!;
    for (const t of outgoing.get(id) ?? []) {
      if (!depth.has(t) || d + 1 > depth.get(t)!) {
        depth.set(t, d + 1);
        queue.push(t);
      }
    }
  }
  for (const n of nodes) { if (!depth.has(n.id)) depth.set(n.id, 0); }

  // --- Group by column ---
  const columns = new Map<number, string[]>();
  for (const n of nodes) {
    const col = depth.get(n.id)!;
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col)!.push(n.id);
  }
  const sortedCols = [...columns.keys()].sort((a, b) => a - b);

  // --- Forward pass: place each column based on sources ---
  const yPos = new Map<string, number>();

  for (const col of sortedCols) {
    const ids = columns.get(col)!;

    // Desired Y = avg of source Y positions (or 0 for roots)
    const desired = new Map<string, number>();
    for (const id of ids) {
      const sources = incoming.get(id)!;
      const ys = sources.map((s) => yPos.get(s)).filter((y): y is number => y !== undefined);
      desired.set(id, ys.length > 0 ? ys.reduce((a, b) => a + b, 0) / ys.length : 0);
    }

    // Sort by desired Y (keeps branch order)
    ids.sort((a, b) => (desired.get(a) ?? 0) - (desired.get(b) ?? 0));

    // Place at desired positions
    for (const id of ids) {
      yPos.set(id, desired.get(id) ?? 0);
    }

    // Resolve overlaps — spread apart then re-center on centroid
    spreadAndCenter(ids, yPos);
  }

  // --- Center roots on their direct children ---
  if (sortedCols.length > 0) {
    const rootIds = columns.get(sortedCols[0])!;
    for (const id of rootIds) {
      const children = outgoing.get(id)!;
      const childYs = children.map((c) => yPos.get(c)).filter((y): y is number => y !== undefined);
      if (childYs.length > 0) {
        yPos.set(id, childYs.reduce((a, b) => a + b, 0) / childYs.length);
      }
    }
    rootIds.sort((a, b) => yPos.get(a)! - yPos.get(b)!);
    spreadAndCenter(rootIds, yPos);
  }

  // --- Normalize: shift so min = (80, 80) ---
  let minY = Infinity;
  for (const y of yPos.values()) minY = Math.min(minY, y);
  const offsetY = 80 - minY;

  return nodes.map((n) => ({
    ...n,
    position: {
      x: 80 + (depth.get(n.id) ?? 0) * COL_GAP,
      y: (yPos.get(n.id) ?? 0) + offsetY,
    },
  }));
}

/** Push overlapping nodes apart while keeping them centered on their original centroid. */
function spreadAndCenter(ids: string[], yPos: Map<string, number>) {
  if (ids.length <= 1) return;

  const centroid = ids.reduce((s, id) => s + yPos.get(id)!, 0) / ids.length;

  // Push apart (top to bottom)
  for (let i = 1; i < ids.length; i++) {
    const prev = yPos.get(ids[i - 1])!;
    const curr = yPos.get(ids[i])!;
    if (curr < prev + ROW_GAP) {
      yPos.set(ids[i], prev + ROW_GAP);
    }
  }

  // Re-center on original centroid
  const newCentroid = ids.reduce((s, id) => s + yPos.get(id)!, 0) / ids.length;
  const shift = centroid - newCentroid;
  for (const id of ids) {
    yPos.set(id, yPos.get(id)! + shift);
  }
}
