import type { Edge } from "@xyflow/react";
import type { CanvasNode, CanvasNodeData } from "./types";
import type {
  UserMarketPosition,
  UserVaultPosition,
} from "@/lib/graphql/types";

import { safeBigInt } from "@/lib/utils/bigint";

const COL = { wallet: 50, supply: 380, borrow: 710, vault: 1040 };
const ROW_GAP = 220;
const START_Y = 80;

const STORAGE_KEY = "morpho-canvas-import";

export interface ImportedStrategy {
  nodes: CanvasNode[];
  edges: Edge[];
  sourceAddress: string;
}

/**
 * Build a canvas graph from an address's Morpho positions.
 *
 * Layout:
 *   Wallet → SupplyCollateral → Borrow → VaultDeposit
 *
 * For each borrow position: creates Supply + Borrow nodes.
 * For each vault position: creates VaultDeposit node.
 * Links borrows to vault deposits when the borrowed asset matches the vault asset.
 */
export function buildStrategyFromPositions(
  address: string,
  chain: string,
  chainId: number,
  marketPositions: UserMarketPosition[],
  vaultPositions: UserVaultPosition[]
): ImportedStrategy {
  const nodes: CanvasNode[] = [];
  const edges: Edge[] = [];
  let nodeCounter = 0;

  const makeId = (prefix: string) => `import-${prefix}-${++nodeCounter}`;

  // 1. Wallet node
  const walletId = makeId("wallet");
  nodes.push({
    id: walletId,
    type: "walletNode",
    position: { x: COL.wallet, y: START_Y },
    data: {
      type: "wallet",
      address,
      chain,
      chainId,
      balances: [],
    },
  });

  // Separate borrow positions from supply-only
  const borrowPositions = marketPositions.filter(
    (p) => p.state?.borrowAssets && safeBigInt(p.state.borrowAssets) > 0n
  );
  const supplyOnlyPositions = marketPositions.filter(
    (p) =>
      p.state?.supplyAssets &&
      safeBigInt(p.state.supplyAssets) > 0n &&
      (!p.state?.borrowAssets || safeBigInt(p.state.borrowAssets) === 0n)
  );

  // Track borrow node outputs by loan asset address (for linking to vaults)
  const borrowNodesByLoanAsset: Map<string, string[]> = new Map();
  let borrowRow = 0;

  // 2. For each borrow position: Wallet → SupplyCollateral → Borrow
  for (const pos of borrowPositions) {
    const y = START_Y + borrowRow * ROW_GAP;

    // SupplyCollateral node
    const supplyId = makeId("supply");
    const collateralAsset = pos.market.collateralAsset;
    const collateralAmt = pos.state
      ? (Number(pos.state.collateral) / 10 ** (collateralAsset?.decimals ?? 18)).toFixed(6)
      : "";

    nodes.push({
      id: supplyId,
      type: "supplyCollateralNode",
      position: { x: COL.supply, y },
      data: {
        type: "supplyCollateral",
        asset: collateralAsset
          ? {
              symbol: collateralAsset.symbol,
              name: collateralAsset.symbol,
              address: collateralAsset.address,
              decimals: collateralAsset.decimals,
              logoURI: collateralAsset.logoURI,
            }
          : null,
        amount: collateralAmt,
        amountUsd: pos.state?.collateralUsd ?? 0,
      } as CanvasNodeData,
    });

    // Wallet → SupplyCollateral
    edges.push({
      id: `${walletId}-${supplyId}`,
      source: walletId,
      target: supplyId,
      type: "animatedEdge",
      animated: true,
    });

    // Borrow node
    const borrowId = makeId("borrow");
    const borrowAmt = pos.state?.borrowAssets
      ? Number(pos.state.borrowAssets) / 10 ** pos.market.loanAsset.decimals
      : 0;
    const collateralUsd = pos.state?.collateralUsd ?? 0;
    const borrowUsd = pos.state?.borrowAssetsUsd ?? 0;
    const lltv = Number(pos.market.lltv) / 1e18;
    const ltvPct = collateralUsd > 0 ? Math.round((borrowUsd / collateralUsd) * 100) : 50;

    nodes.push({
      id: borrowId,
      type: "borrowNode",
      position: { x: COL.borrow, y },
      data: {
        type: "borrow",
        market: {
          uniqueKey: pos.market.uniqueKey,
          lltv: pos.market.lltv,
          irmAddress: pos.market.irmAddress,
          oracle: pos.market.oracle,
          collateralAsset: pos.market.collateralAsset ?? {
            symbol: "?",
            address: "",
            logoURI: "",
            priceUsd: null,
            decimals: 18,
          },
          loanAsset: pos.market.loanAsset,
          state: {
            borrowApy: pos.market.state.borrowApy,
            netBorrowApy: pos.market.state.netBorrowApy,
            borrowAssets: "0",
            supplyAssets: "0",
            liquidityAssets: "0",
            price: null,
            rewards: [],
          },
        },
        ltvPercent: Math.min(ltvPct, Math.round(lltv * 100)),
        borrowAmount: borrowAmt,
        borrowAmountUsd: borrowUsd,
        healthFactor: pos.healthFactor,
        depositAmountUsd: collateralUsd,
      } as CanvasNodeData,
    });

    // SupplyCollateral → Borrow
    edges.push({
      id: `${supplyId}-${borrowId}`,
      source: supplyId,
      target: borrowId,
      type: "animatedEdge",
      animated: true,
    });

    // Track for vault linking
    const loanAddr = pos.market.loanAsset.address.toLowerCase();
    const arr = borrowNodesByLoanAsset.get(loanAddr) ?? [];
    arr.push(borrowId);
    borrowNodesByLoanAsset.set(loanAddr, arr);

    borrowRow++;
  }

  // 3. Supply-only positions: Wallet → SupplyCollateral (no borrow downstream)
  for (const pos of supplyOnlyPositions) {
    const y = START_Y + borrowRow * ROW_GAP;

    const supplyId = makeId("supply-only");
    const loanAsset = pos.market.loanAsset;
    const supplyAmt = pos.state?.supplyAssets
      ? (Number(pos.state.supplyAssets) / 10 ** loanAsset.decimals).toFixed(6)
      : "";

    nodes.push({
      id: supplyId,
      type: "supplyCollateralNode",
      position: { x: COL.supply, y },
      data: {
        type: "supplyCollateral",
        asset: {
          symbol: loanAsset.symbol,
          name: loanAsset.symbol,
          address: loanAsset.address,
          decimals: loanAsset.decimals,
          logoURI: loanAsset.logoURI,
        },
        amount: supplyAmt,
        amountUsd: pos.state?.supplyAssetsUsd ?? 0,
      } as CanvasNodeData,
    });

    edges.push({
      id: `${walletId}-${supplyId}`,
      source: walletId,
      target: supplyId,
      type: "animatedEdge",
      animated: true,
    });

    borrowRow++;
  }

  // 4. Vault positions: VaultDeposit nodes
  let vaultRow = 0;
  for (const pos of vaultPositions) {
    const y = START_Y + vaultRow * ROW_GAP;

    const vaultId = makeId("vault");
    const amt = pos.state?.assets
      ? (Number(pos.state.assets) / 10 ** pos.vault.asset.decimals).toFixed(6)
      : "";

    nodes.push({
      id: vaultId,
      type: "vaultDepositNode",
      position: { x: COL.vault, y },
      data: {
        type: "vaultDeposit",
        vault: {
          address: pos.vault.address,
          name: pos.vault.name,
          symbol: pos.vault.symbol,
          asset: pos.vault.asset,
          state: {
            totalAssets: "0",
            totalAssetsUsd: pos.vault.state.totalAssetsUsd,
            curator: null,
            netApy: pos.vault.state.netApy,
            fee: 0,
            allocation: [],
          },
        },
        amount: amt,
        amountUsd: pos.state?.assetsUsd ?? 0,
      } as CanvasNodeData,
    });

    // Link from borrow nodes whose loan asset matches the vault asset
    const vaultAssetAddr = pos.vault.asset.address.toLowerCase();
    const sourceBorrows = borrowNodesByLoanAsset.get(vaultAssetAddr) ?? [];

    if (sourceBorrows.length > 0) {
      // Link from matching borrow nodes
      for (const borrowId of sourceBorrows) {
        edges.push({
          id: `${borrowId}-${vaultId}`,
          source: borrowId,
          target: vaultId,
          type: "animatedEdge",
          animated: true,
        });
      }
    } else {
      // No matching borrow — create a SupplyCollateral node as bridge
      // (wallet→vaultDeposit is not valid, but wallet→supply→vault is)
      const bridgeSupplyId = makeId("bridge-supply");
      const vaultAsset = pos.vault.asset;
      nodes.push({
        id: bridgeSupplyId,
        type: "supplyCollateralNode",
        position: { x: COL.borrow, y },
        data: {
          type: "supplyCollateral",
          asset: {
            symbol: vaultAsset.symbol,
            name: vaultAsset.symbol,
            address: vaultAsset.address,
            decimals: vaultAsset.decimals,
            logoURI: vaultAsset.logoURI,
          },
          amount: amt,
          amountUsd: pos.state?.assetsUsd ?? 0,
        } as CanvasNodeData,
      });
      edges.push({
        id: `${walletId}-${bridgeSupplyId}`,
        source: walletId,
        target: bridgeSupplyId,
        type: "animatedEdge",
        animated: true,
      });
      edges.push({
        id: `${bridgeSupplyId}-${vaultId}`,
        source: bridgeSupplyId,
        target: vaultId,
        type: "animatedEdge",
        animated: true,
      });
    }

    vaultRow++;
  }

  return { nodes, edges, sourceAddress: address };
}

/** Save an imported strategy to localStorage for the canvas to pick up */
export function saveImportedStrategy(strategy: ImportedStrategy) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(strategy));
}

const VALID_NODE_TYPES = new Set([
  "walletNode", "supplyCollateralNode", "borrowNode",
  "swapNode", "vaultDepositNode", "vaultWithdrawNode", "positionNode",
]);
const VALID_DATA_TYPES = new Set([
  "wallet", "supplyCollateral", "borrow",
  "swap", "vaultDeposit", "vaultWithdraw", "position",
]);
const MAX_STRING_LEN = 500;

/** Validate that an imported strategy has valid structure */
function isValidImportedStrategy(data: unknown): data is ImportedStrategy {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;

  // Must have nodes array, edges array, sourceAddress string
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) return false;
  if (typeof obj.sourceAddress !== "string" || obj.sourceAddress.length > 100) return false;

  // Limit size to prevent memory abuse
  if (obj.nodes.length > 200 || obj.edges.length > 500) return false;

  // Validate each node has required fields + whitelisted types
  for (const node of obj.nodes) {
    if (!node || typeof node !== "object") return false;
    const n = node as Record<string, unknown>;
    if (typeof n.id !== "string" || n.id.length > MAX_STRING_LEN) return false;
    if (typeof n.type !== "string" || !VALID_NODE_TYPES.has(n.type)) return false;
    if (!n.position || typeof n.position !== "object") return false;
    if (!n.data || typeof n.data !== "object") return false;
    const d = n.data as Record<string, unknown>;
    if (typeof d.type !== "string" || !VALID_DATA_TYPES.has(d.type)) return false;
  }

  // Validate each edge has required fields + string length limits
  for (const edge of obj.edges) {
    if (!edge || typeof edge !== "object") return false;
    const e = edge as Record<string, unknown>;
    if (typeof e.id !== "string" || e.id.length > MAX_STRING_LEN) return false;
    if (typeof e.source !== "string" || e.source.length > MAX_STRING_LEN) return false;
    if (typeof e.target !== "string" || e.target.length > MAX_STRING_LEN) return false;
    // Reject self-loops
    if (e.source === e.target) return false;
  }

  return true;
}

/** Load and consume (delete) an imported strategy from localStorage */
export function consumeImportedStrategy(): ImportedStrategy | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  localStorage.removeItem(STORAGE_KEY);
  // Reject excessively large payloads (500KB)
  if (raw.length > 500_000) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isValidImportedStrategy(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}
