import type { Edge } from "@xyflow/react";
import { encodeFunctionData } from "viem";
import type { CanvasNode } from "./types";
import type {
  SupplyCollateralNodeData,
  BorrowNodeData,
  VaultDepositNodeData,
  VaultWithdrawNodeData,
} from "./types";
import {
  BUNDLER3,
  GENERAL_ADAPTER1,
  bundler3Abi,
  generalAdapterAbi,
} from "@/lib/constants/contracts";
import type { SupportedChainId } from "@/lib/web3/chains";

interface BundlerCall {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  skipRevert: boolean;
  callbackHash: `0x${string}`;
}

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

/**
 * Topological sort of nodes based on edges.
 */
function topologicalSort(nodes: CanvasNode[], edges: Edge[]): CanvasNode[] {
  const adjList = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    adjList.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  for (const edge of edges) {
    adjList.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const neighbor of adjList.get(id) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  return sorted.map((id) => nodeMap.get(id)!).filter(Boolean);
}

/**
 * Build bundler multicall transaction from canvas graph.
 * Returns the tx data to send to the Bundler3 contract.
 */
export function buildExecutionBundle(
  nodes: CanvasNode[],
  edges: Edge[],
  userAddress: `0x${string}`,
  chainId: SupportedChainId
): {
  to: `0x${string}`;
  data: `0x${string}`;
  calls: BundlerCall[];
  hasSwap: boolean;
} {
  const adapter = GENERAL_ADAPTER1[chainId];
  const bundler = BUNDLER3[chainId];
  if (!adapter || !bundler) throw new Error("Chain not supported");

  const sorted = topologicalSort(nodes, edges);
  const calls: BundlerCall[] = [];
  let hasSwap = false;

  for (const node of sorted) {
    const data = node.data as { type: string };

    switch (data.type) {
      case "vaultWithdraw": {
        const d = node.data as unknown as VaultWithdrawNodeData;
        if (!d.position || !d.amount || parseFloat(d.amount) <= 0) break;
        const shares = BigInt(
          Math.floor(
            parseFloat(d.amount) * 10 ** d.position.vault.asset.decimals
          )
        );
        calls.push({
          to: adapter,
          data: encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "erc4626Redeem",
            args: [
              d.position.vault.address as `0x${string}`,
              shares,
              0n,
              userAddress,
              userAddress,
            ],
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: ZERO_HASH,
        });
        break;
      }

      case "supplyCollateral": {
        const d = node.data as unknown as SupplyCollateralNodeData;
        if (!d.asset || !d.amount || parseFloat(d.amount) <= 0) break;

        const rawAmount = BigInt(
          Math.floor(parseFloat(d.amount) * 10 ** d.asset.decimals)
        );

        // Transfer token to adapter
        calls.push({
          to: adapter,
          data: encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "erc20TransferFrom",
            args: [d.asset.address as `0x${string}`, adapter, rawAmount],
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: ZERO_HASH,
        });
        break;
      }

      case "borrow": {
        const d = node.data as unknown as BorrowNodeData;
        if (!d.market || d.borrowAmount <= 0) break;

        const rawAmount = BigInt(
          Math.floor(d.borrowAmount * 10 ** d.market.loanAsset.decimals)
        );

        const marketParams = {
          loanToken: d.market.loanAsset.address as `0x${string}`,
          collateralToken: d.market.collateralAsset.address as `0x${string}`,
          oracle: d.market.oracle.address as `0x${string}`,
          irm: d.market.irmAddress as `0x${string}`,
          lltv: BigInt(d.market.lltv),
        };

        // Supply collateral (from the node's connected supply)
        // Note: The actual supply call should come from SupplyCollateral nodes
        // Here we just encode the morphoSupplyCollateral + morphoBorrow

        calls.push({
          to: adapter,
          data: encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "morphoBorrow",
            args: [marketParams, rawAmount, 0n, 0n, userAddress],
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: ZERO_HASH,
        });
        break;
      }

      case "vaultDeposit": {
        const d = node.data as unknown as VaultDepositNodeData;
        if (!d.vault || !d.amount || parseFloat(d.amount) <= 0) break;

        const rawAmount = BigInt(
          Math.floor(parseFloat(d.amount) * 10 ** d.vault.asset.decimals)
        );

        calls.push({
          to: adapter,
          data: encodeFunctionData({
            abi: generalAdapterAbi,
            functionName: "erc4626Deposit",
            args: [
              d.vault.address as `0x${string}`,
              rawAmount,
              BigInt("1000000000000000000000000000"),
              userAddress,
            ],
          }),
          value: 0n,
          skipRevert: false,
          callbackHash: ZERO_HASH,
        });
        break;
      }

      case "swap": {
        hasSwap = true;
        // CowSwap orders are signed off-chain — not part of the bundler call
        break;
      }
    }
  }

  const txData = encodeFunctionData({
    abi: bundler3Abi,
    functionName: "multicall",
    args: [calls],
  });

  return { to: bundler, data: txData, calls, hasSwap };
}
