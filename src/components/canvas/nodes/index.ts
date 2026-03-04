import type { NodeTypes } from "@xyflow/react";
import WalletNode from "./WalletNode";
import SupplyCollateralNode from "./SupplyCollateralNode";
import BorrowNode from "./BorrowNode";
import SwapNode from "./SwapNode";
import VaultDepositNode from "./VaultDepositNode";
import VaultWithdrawNode from "./VaultWithdrawNode";
import PositionNode from "./PositionNode";

// MUST be defined outside any component to avoid React Flow re-renders
export const nodeTypes: NodeTypes = {
  walletNode: WalletNode,
  supplyCollateralNode: SupplyCollateralNode,
  borrowNode: BorrowNode,
  swapNode: SwapNode,
  vaultDepositNode: VaultDepositNode,
  vaultWithdrawNode: VaultWithdrawNode,
  positionNode: PositionNode,
};
