import type { CanvasNode } from "./types";
import type {
  UserMarketPosition,
  UserVaultPosition,
} from "@/lib/graphql/types";

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
    (p) => p.state && p.state.borrowAssets && BigInt(p.state.borrowAssets) > 0n
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
      BigInt(p.state.supplyAssets) > 0n &&
      !(p.state.borrowAssets && BigInt(p.state.borrowAssets) > 0n)
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
