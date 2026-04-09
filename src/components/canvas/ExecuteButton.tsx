// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

"use client";

import { useMemo, useState, useCallback, useRef } from "react";
import Image from "next/image";
import type { Edge } from "@xyflow/react";
import { useAccount, useSendTransaction, useSwitchChain } from "wagmi";
import { readContract, waitForTransactionReceipt, estimateGas } from "wagmi/actions";
import { useChain } from "@/lib/context/ChainContext";
import { validateGraph } from "@/lib/canvas/validation";
import {
  buildExecutionBundle,
  getRequiredApprovals,
  buildApprovalTxs,
  getSwapDetails,
  buildPreSwapBundle,
  buildPostSwapBundle,
  getPreSwapApprovals,
  strategyNeedsMorphoAuthorization,
  buildMorphoAuthorizationTx,
} from "@/lib/canvas/executor";
import {
  getCowQuote,
  signAndSubmitOrder,
  pollOrderUntilFilled,
  getOrderStatus,
  COW_VAULT_RELAYER,
} from "@/lib/cowswap/order";
import { formatApy } from "@/lib/utils/format";
import type { CanvasNode, CanvasNodeData } from "@/lib/canvas/types";
import { CHAIN_CONFIGS, type SupportedChainId } from "@/lib/web3/chains";
import { GENERAL_ADAPTER1, MORPHO_BLUE, morphoBlueAbi } from "@/lib/constants/contracts";
import { erc20Abi } from "viem";
import { encodeFunctionData } from "viem";
import { wagmiConfig } from "@/lib/web3/config";
import SimulationPreview from "./SimulationPreview";
import BundleInspector from "./BundleInspector";
import { useBundlePreflight } from "@/lib/hooks/useBundlePreflight";

interface ExecuteButtonProps {
  nodes: CanvasNode[];
  edges: Edge[];
}

interface BundleStep {
  label: string;
  detail: string;
  type: "approve" | "withdraw" | "supply" | "borrow" | "deposit" | "swap" | "repay";
  icon: string;
}

const typeColors: Record<string, string> = {
  approve: "text-yellow-400 border-yellow-400/20 bg-yellow-400/5",
  withdraw: "text-orange-400 border-orange-400/20 bg-orange-400/5",
  supply: "text-brand border-brand/20 bg-brand/5",
  borrow: "text-success border-success/20 bg-success/5",
  deposit: "text-purple-400 border-purple-400/20 bg-purple-400/5",
  swap: "text-amber-400 border-amber-400/20 bg-amber-400/5",
  repay: "text-red-400 border-red-400/20 bg-red-400/5",
};

const typeLabels: Record<string, string> = {
  approve: "APPROVE",
  withdraw: "WITHDRAW",
  supply: "SUPPLY",
  borrow: "BORROW",
  deposit: "DEPOSIT",
  swap: "SWAP",
  repay: "REPAY",
};

const EXPLORER_BASE: Record<number, string> = {
  1: "https://etherscan.io",
  8453: "https://basescan.org",
};

/** Safe parseFloat */
function safeFloat(val: string | undefined): number {
  if (!val) return 0;
  const n = parseFloat(val);
  return isFinite(n) ? n : 0;
}

/** Format number with . for decimal, , for thousands */
function fmtNum(val: number, decimals = 4): string {
  return val.toLocaleString("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
}

function topologicalSort(nodes: CanvasNode[], edges: Edge[]): CanvasNode[] {
  const adjList = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const node of nodes) {
    adjList.set(node.id, []);
    inDegree.set(node.id, 0);
  }
  for (const edge of edges) {
    if (!adjList.has(edge.source) || !adjList.has(edge.target)) continue;
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

export default function ExecuteButton({ nodes, edges }: ExecuteButtonProps) {
  const { address, isConnected, chainId: walletChainId } = useAccount();
  const { chainId } = useChain();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransaction, isPending } = useSendTransaction();
  // Pre-execution preflight runs only while the panel is expanded — debounced
  // inside useBundlePreflight so rapid graph edits don't spam estimateGas.
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [approvalStep, setApprovalStep] = useState<number>(0); // 0 = not started
  const [totalApprovals, setTotalApprovals] = useState(0);
  const [swapStatus, setSwapStatus] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  // Run preflight only while the panel is expanded AND we're not currently executing
  const preflight = useBundlePreflight(nodes, edges, expanded && !isExecuting);

  const wrongChain = isConnected && walletChainId !== chainId;
  const expectedChainLabel = CHAIN_CONFIGS.find((c) => c.chainId === chainId)?.label ?? `Chain ${chainId}`;
  const [isSwitching, setIsSwitching] = useState(false);

  const handleSwitchChain = useCallback(async () => {
    setIsSwitching(true);
    try {
      await switchChainAsync({ chainId: chainId as SupportedChainId });
    } catch {
      setError(`Failed to switch to ${expectedChainLabel}. Please switch manually in your wallet.`);
    } finally {
      setIsSwitching(false);
    }
  }, [chainId, expectedChainLabel, switchChainAsync]);

  // Track wallet address via ref for reliable detection during async flow
  const addressRef = useRef(address);
  addressRef.current = address;
  // Track pending CowSwap orders to avoid duplicate submissions
  const pendingOrdersRef = useRef<Map<string, string>>(new Map()); // nodeId → orderUid
  const isExecutingRef = useRef(false);

  /** Check on-chain allowance and filter out approvals that are already sufficient. */
  const filterNeededApprovals = useCallback(
    async (
      approvals: { token: `0x${string}`; amount: bigint }[],
      owner: `0x${string}`,
      spender: `0x${string}`
    ) => {
      const needed: { token: `0x${string}`; amount: bigint }[] = [];
      for (const a of approvals) {
        try {
          const allowance = await readContract(wagmiConfig, {
            address: a.token,
            abi: erc20Abi,
            functionName: "allowance",
            args: [owner, spender],
          });
          if ((allowance as bigint) < a.amount) {
            needed.push(a);
          }
        } catch {
          // RPC error — include approval to be safe
          needed.push(a);
        }
      }
      return needed;
    },
    []
  );

  // Build visual steps from graph
  const steps = useMemo(() => {
    const sorted = topologicalSort(nodes, edges);
    const s: BundleStep[] = [];

    for (const node of sorted) {
      const d = node.data as CanvasNodeData;

      switch (d.type) {
        case "vaultWithdraw": {
          if (!d.position || safeFloat(d.amount) <= 0) break;
          s.push({
            label: `Withdraw from ${d.position.vault.name}`,
            detail: `${fmtNum(safeFloat(d.amount))} ${d.position.vault.asset.symbol}`,
            type: "withdraw",
            icon: d.position.vault.asset.logoURI,
          });
          break;
        }
        case "supplyCollateral": {
          if (!d.asset || safeFloat(d.amount) <= 0) break;
          s.push({
            label: `Approve ${d.asset.symbol}`,
            detail: `${fmtNum(safeFloat(d.amount))} ${d.asset.symbol} to Bundler`,
            type: "approve",
            icon: d.asset.logoURI,
          });
          s.push({
            label: `Supply ${d.asset.symbol} collateral`,
            detail: `${fmtNum(safeFloat(d.amount))} ${d.asset.symbol}`,
            type: "supply",
            icon: d.asset.logoURI,
          });
          break;
        }
        case "borrow": {
          if (!d.market || !isFinite(d.borrowAmount) || d.borrowAmount <= 0) break;
          s.push({
            label: `Borrow ${d.market.loanAsset.symbol}`,
            detail: `${fmtNum(d.borrowAmount, 6)} ${d.market.loanAsset.symbol} ($${fmtNum(d.borrowAmountUsd, 2)}) — ${formatApy(d.market.state.netBorrowApy)}`,
            type: "borrow",
            icon: d.market.loanAsset.logoURI,
          });
          break;
        }
        case "swap": {
          if (!d.tokenIn || !d.tokenOut) break;
          s.push({
            label: `Swap ${d.tokenIn.symbol} → ${d.tokenOut.symbol}`,
            detail: d.amountIn ? `${fmtNum(safeFloat(d.amountIn))} ${d.tokenIn.symbol}` : "Pending quote",
            type: "swap",
            icon: d.tokenIn.logoURI,
          });
          break;
        }
        case "vaultDeposit": {
          if (!d.vault) break;
          // When depositAll is true, amount comes from upstream swap at execution time
          if (!d.depositAll && safeFloat(d.amount) <= 0) break;

          // Show approval step when the tokens are pulled from the user's wallet.
          // Skip when the upstream is a swap (CowSwap output lands on the adapter
          // already) or a borrow (the adapter holds the borrowed tokens directly).
          const upEdge = edges.find((e) => e.target === node.id);
          const upNode = upEdge ? sorted.find((n) => n.id === upEdge.source) : null;
          const upType = upNode ? (upNode.data as { type?: string }).type : null;
          const tokensComeFromUser =
            upType === undefined ||
            upType === "wallet" ||
            upType === "vaultWithdraw";

          if (tokensComeFromUser && !d.depositAll) {
            s.push({
              label: `Approve ${d.vault.asset.symbol}`,
              detail: `${fmtNum(safeFloat(d.amount))} ${d.vault.asset.symbol} to Bundler`,
              type: "approve",
              icon: d.vault.asset.logoURI,
            });
          }

          const depositDetail = d.depositAll
            ? `All swap output → ${d.vault.asset.symbol} — ${formatApy(d.vault.state.netApy)}`
            : `${fmtNum(safeFloat(d.amount))} ${d.vault.asset.symbol} — ${formatApy(d.vault.state.netApy)}`;
          s.push({
            label: `Deposit into ${d.vault.name}`,
            detail: depositDetail,
            type: "deposit",
            icon: d.vault.asset.logoURI,
          });
          break;
        }
        case "repay": {
          if (!d.market || safeFloat(d.amount) <= 0) break;
          // Repay needs an approval on the loan token (transferFrom from user)
          s.push({
            label: `Approve ${d.market.loanAsset.symbol}`,
            detail: `${fmtNum(safeFloat(d.amount))} ${d.market.loanAsset.symbol} to Bundler`,
            type: "approve",
            icon: d.market.loanAsset.logoURI,
          });
          s.push({
            label: `Repay ${d.market.loanAsset.symbol}`,
            detail: `${fmtNum(safeFloat(d.amount))} ${d.market.loanAsset.symbol} — ${formatApy(d.market.state.netBorrowApy)}`,
            type: "repay",
            icon: d.market.loanAsset.logoURI,
          });
          // Optional: withdraw collateral right after the repay
          if (d.withdrawCollateralAfterRepay && d.collateralToWithdraw && d.market.collateralAsset) {
            const decimals = d.market.collateralAsset.decimals ?? 18;
            const collAmount = Number(d.collateralToWithdraw) / 10 ** decimals;
            s.push({
              label: `Withdraw ${d.market.collateralAsset.symbol} collateral`,
              detail: `${fmtNum(collAmount)} ${d.market.collateralAsset.symbol} → your wallet`,
              type: "withdraw",
              icon: d.market.collateralAsset.logoURI ?? d.market.loanAsset.logoURI,
            });
          }
          break;
        }
      }
    }
    return s;
  }, [nodes, edges]);

  // Handle approval + execution flow
  const handleExecute = useCallback(async () => {
    if (!address || !isConnected) return;
    setError(null);
    setTxHash(null);
    setApprovalStep(0);

    // 1. Validate current graph
    const errors = validateGraph(nodes, edges);
    setValidationErrors(errors);
    if (errors.length > 0) {
      setShowConfirm(false);
      return;
    }

    // 2. If not confirmed yet, show confirmation dialog
    if (!showConfirm) {
      setShowConfirm(true);
      return;
    }

    // H1 fix: Guard + lock IMMEDIATELY before any async work
    if (isExecutingRef.current) return;
    isExecutingRef.current = true;
    setIsExecuting(true);
    setExpanded(true);

    // C2 fix: Always use current graph state (not stale first-click snapshot)
    const execNodes = JSON.parse(JSON.stringify(nodes)) as CanvasNode[];
    const execEdges = JSON.parse(JSON.stringify(edges)) as Edge[];
    try {
      const cid = chainId as SupportedChainId;

      // Hard block: refuse to execute on wrong chain
      if (walletChainId !== chainId) {
        setError(`Wrong network — switch to ${expectedChainLabel} before executing`);
        isExecutingRef.current = false;
        setIsExecuting(false);
        return;
      }

      const adapter = GENERAL_ADAPTER1[cid];
      if (!adapter) {
        setError("Chain not supported");
        return;
      }

      const currentAddress = addressRef.current;
      if (!currentAddress) {
        setError("Wallet disconnected during execution");
        return;
      }

      // Helper: abort if chain changed mid-execution
      const assertChain = () => {
        if (walletChainId !== chainId) {
          throw new Error(`Network changed during execution — expected ${expectedChainLabel}`);
        }
      };

      // Retry wrapper for waitForTransactionReceipt (RPC can be flaky)
      const waitWithRetry = async (hash: `0x${string}`, retries = 3) => {
        for (let attempt = 0; attempt < retries; attempt++) {
          try {
            return await waitForTransactionReceipt(wagmiConfig, {
              hash,
              confirmations: 1,
              timeout: 60_000,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : "";
            const isNetwork = msg.includes("Failed to fetch") || msg.includes("HTTP request failed");
            if (!isNetwork || attempt === retries - 1) throw err;
            // Wait before retry
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
        throw new Error("Receipt check failed after retries");
      };

      // Helper: send approval txs and wait for confirmation
      const sendApprovals = async (
        approveTxs: { to: `0x${string}`; data: `0x${string}` }[]
      ) => {
        setTotalApprovals(approveTxs.length);
        for (let i = 0; i < approveTxs.length; i++) {
          setApprovalStep(i + 1);
          const hash = await new Promise<`0x${string}`>((resolve, reject) => {
            sendTransaction(
              { to: approveTxs[i].to, data: approveTxs[i].data, value: 0n },
              { onSuccess: (h) => resolve(h), onError: (err) => reject(err) }
            );
          });
          try {
            const receipt = await waitWithRetry(hash);
            if (receipt.status === "reverted") {
              throw new Error(`Approval ${i + 1}/${approveTxs.length} reverted on-chain`);
            }
          } catch (err) {
            // If receipt check fails but tx was mined, the allowance check
            // on retry will skip this approval. Safe to continue.
            const msg = err instanceof Error ? err.message : "";
            if (msg.includes("reverted")) throw err;
            console.warn(`Receipt check failed for approval tx ${hash}, continuing...`);
          }
        }
        setApprovalStep(0);
      };

      // Helper: send bundler multicall and wait for confirmation
      const sendBundle = async (
        bundle: { to: `0x${string}`; data: `0x${string}`; calls: { to: string }[] }
      ) => {
        if (bundle.calls.length === 0) return;

        // Simulate first to avoid wasting gas on reverts
        try {
          await estimateGas(wagmiConfig, {
            to: bundle.to,
            data: bundle.data,
            value: 0n,
            account: currentAddress,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[ExecuteButton] estimateGas failed:", msg);
          // Show the actual revert reason — truncate for display but keep it real
          const clean = msg
            .replace(/EstimateGasExecutionError:?\s*/i, "")
            .replace(/Details:?\s*/i, "")
            .slice(0, 200);
          throw new Error(`Simulation failed — tx would revert: ${clean}`);
        }

        const bundleHash = await new Promise<`0x${string}`>((resolve, reject) => {
          sendTransaction(
            { to: bundle.to, data: bundle.data, value: 0n },
            { onSuccess: (h) => resolve(h), onError: (err) => reject(err) }
          );
        });
        setTxHash(bundleHash);
        const receipt = await waitWithRetry(bundleHash);
        if (receipt.status === "reverted") {
          setTxHash(null);
          throw new Error("Bundle transaction reverted on-chain");
        }
      };

      // ─── Morpho Blue authorization preflight ───────────────────────────────
      // The bundler executes morpho.borrow on behalf of the user via the
      // GeneralAdapter1 contract. Morpho Blue requires the user to have
      // explicitly authorized that adapter via setAuthorization. Without it,
      // first-time borrowers see "Unauthorized()" reverts.
      //
      // We check isAuthorized once before the bundle. If false, we submit a
      // separate setAuthorization tx (one extra signature for the user). This
      // is a one-time setup per (user, adapter) pair.
      //
      // FUTURE: replace with setAuthorizationWithSig embedded in the bundle
      // (saves one signature). Requires EIP-712 signing flow.
      if (strategyNeedsMorphoAuthorization(execNodes)) {
        let isAuth = false;
        try {
          isAuth = (await readContract(wagmiConfig, {
            address: MORPHO_BLUE,
            abi: morphoBlueAbi,
            functionName: "isAuthorized",
            args: [currentAddress, adapter],
          })) as boolean;
        } catch (err) {
          // RPC failure — fall through and try the auth tx anyway. If the
          // user is already authorized the tx is a no-op (cheap).
          console.warn("[ExecuteButton] isAuthorized check failed, will attempt setAuthorization:", err);
        }

        if (!isAuth) {
          const authTx = buildMorphoAuthorizationTx(cid);
          if (!authTx) {
            setError("Cannot build authorization tx for this chain");
            return;
          }
          assertChain();
          setSwapStatus("Authorizing Morpho adapter (one-time setup)…");
          const authHash = await new Promise<`0x${string}`>((resolve, reject) => {
            sendTransaction(
              { to: authTx.to, data: authTx.data, value: 0n },
              { onSuccess: (h) => resolve(h), onError: (err) => reject(err) }
            );
          });
          try {
            const receipt = await waitWithRetry(authHash);
            if (receipt.status === "reverted") {
              throw new Error("Authorization tx reverted on-chain");
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`Authorization failed: ${msg}`);
          }
          setSwapStatus(null);
          if (addressRef.current !== currentAddress) {
            setError("Wallet address changed during execution. Aborting.");
            return;
          }
        }
      }

      // Detect if graph contains swaps
      const swaps = getSwapDetails(execNodes, execEdges);

      if (swaps.length === 0) {
        // ---- No swaps: single-phase execution (original flow) ----
        const approvals = getRequiredApprovals(execNodes, execEdges, cid);
        if (approvals.length > 0) {
          const needed = await filterNeededApprovals(
            approvals.map((a) => ({ token: a.token, amount: a.amount })),
            currentAddress,
            adapter
          );
          if (needed.length > 0) {
            assertChain();
            await sendApprovals(buildApprovalTxs(needed, adapter, cid));
          }
        }

        if (addressRef.current !== currentAddress) {
          setError("Wallet address changed during execution. Aborting.");
          return;
        }

        const bundle = buildExecutionBundle(execNodes, execEdges, currentAddress, cid);
        if (bundle.calls.length === 0) {
          setError("No executable actions in graph");
          return;
        }
        assertChain();
        await sendBundle(bundle);
      } else {
        // ---- Two-phase execution: pre-swap → CowSwap → post-swap ----
        const vaultRelayer = COW_VAULT_RELAYER[cid];
        if (!vaultRelayer) {
          setError("CowSwap not supported on this chain");
          return;
        }

        // Phase 1: Pre-swap bundler operations (supply, borrow, etc.)
        const preSwapBundle = buildPreSwapBundle(execNodes, execEdges, currentAddress, cid);
        if (preSwapBundle.calls.length > 0) {
          // Only approve tokens needed for pre-swap operations (not post-swap vault deposits)
          const preApprovals = getPreSwapApprovals(execNodes, execEdges, cid);
          if (preApprovals.length > 0) {
            const needed = await filterNeededApprovals(
              preApprovals.map((a) => ({ token: a.token, amount: a.amount })),
              currentAddress,
              adapter
            );
            if (needed.length > 0) {
              assertChain();
              await sendApprovals(buildApprovalTxs(needed, adapter, cid));
            }
          }
          // C1 fix: Verify wallet hasn't changed after approvals
          if (addressRef.current !== currentAddress) {
            setError("Wallet address changed during execution. Aborting.");
            return;
          }
          setSwapStatus("Executing pre-swap operations...");
          assertChain();
          await sendBundle(preSwapBundle);
        }

        // Phase 2: CowSwap orders
        const swapResults = new Map<string, bigint>();

        // C1 fix: Verify wallet before CowSwap phase
        if (addressRef.current !== currentAddress) {
          setError("Wallet address changed during execution. Aborting.");
          return;
        }

        for (let i = 0; i < swaps.length; i++) {
          const swap = swaps[i];

          // Check if a previous order for this swap node is still active
          const existingUid = pendingOrdersRef.current.get(swap.nodeId);
          if (existingUid) {
            setSwapStatus(`Checking existing order for ${swap.sellSymbol} → ${swap.buySymbol}...`);
            const existing = await getOrderStatus(cid, existingUid);
            if (existing) {
              if (existing.status === "fulfilled") {
                // Already filled — use the result directly
                swapResults.set(swap.nodeId, BigInt(existing.executedBuyAmount));
                pendingOrdersRef.current.delete(swap.nodeId);
                continue;
              }
              if (existing.status === "open" || existing.status === "presignaturePending") {
                // Still pending — resume polling instead of creating a duplicate
                setSwapStatus(`Resuming poll for ${swap.sellSymbol} → ${swap.buySymbol}...`);
                const result = await pollOrderUntilFilled(cid, existingUid, (status) => {
                  setSwapStatus(`CowSwap: ${status} (${swap.sellSymbol} → ${swap.buySymbol})`);
                });
                swapResults.set(swap.nodeId, BigInt(result.executedBuyAmount));
                pendingOrdersRef.current.delete(swap.nodeId);
                continue;
              }
              // cancelled/expired — clear and create a new order
              pendingOrdersRef.current.delete(swap.nodeId);
            }
          }

          // 2a + 2b: Approve sell token & fetch quote in parallel
          setSwapStatus(`Preparing ${swap.sellSymbol} → ${swap.buySymbol}...`);

          const MAX_APPROVAL = 2n ** 256n - 1n;
          const approvalPromise = (async () => {
            const sellNeeded = await filterNeededApprovals(
              [{ token: swap.sellToken, amount: BigInt(swap.sellAmountWei) }],
              currentAddress,
              vaultRelayer
            );
            if (sellNeeded.length > 0) {
              assertChain();
              setSwapStatus(`Approving ${swap.sellSymbol} for CowSwap...`);
              const approveData = encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [vaultRelayer, MAX_APPROVAL],
              });
              await sendApprovals([{ to: swap.sellToken, data: approveData }]);
            }
          })();

          const quotePromise = getCowQuote(
            cid,
            swap.sellToken,
            swap.buyToken,
            swap.sellAmountWei,
            currentAddress
          );

          const [, quote] = await Promise.all([approvalPromise, quotePromise]);

          // 2c. Sign and submit order
          setSwapStatus(`Sign CowSwap order: ${swap.sellSymbol} → ${swap.buySymbol}...`);
          const orderUid = await signAndSubmitOrder(cid, quote, currentAddress);
          pendingOrdersRef.current.set(swap.nodeId, orderUid);

          // 2d. Poll until filled
          setSwapStatus(`Waiting for CowSwap fill (${swap.sellSymbol} → ${swap.buySymbol})...`);
          const result = await pollOrderUntilFilled(cid, orderUid, (status) => {
            setSwapStatus(`CowSwap: ${status} (${swap.sellSymbol} → ${swap.buySymbol})`);
          });

          pendingOrdersRef.current.delete(swap.nodeId);
          swapResults.set(swap.nodeId, BigInt(result.executedBuyAmount));
        }

        // Phase 3: Post-swap bundler operations (vault deposits with actual amounts)
        if (addressRef.current !== currentAddress) {
          setError("Wallet address changed during execution. Aborting.");
          return;
        }

        const postBundle = buildPostSwapBundle(
          execNodes,
          execEdges,
          currentAddress,
          cid,
          swapResults
        );

        if (postBundle.calls.length > 0) {
          // Approve received tokens to bundler adapter (skip already approved)
          if (postBundle.approvals.length > 0) {
            const postNeeded = await filterNeededApprovals(
              postBundle.approvals.map((a) => ({ token: a.token, amount: a.amount })),
              currentAddress,
              adapter
            );
            if (postNeeded.length > 0) {
              assertChain();
              setSwapStatus("Approving received tokens for deposit...");
              await sendApprovals(buildApprovalTxs(postNeeded, adapter, cid));
            }
          }

          assertChain();
          setSwapStatus("Depositing into vault...");
          await sendBundle(postBundle);
        }

        setSwapStatus(null);
      }

      setShowConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build bundle");
    } finally {
      setApprovalStep(0);
      isExecutingRef.current = false;
      setIsExecuting(false);
    }
  }, [address, isConnected, nodes, edges, chainId, walletChainId, showConfirm, sendTransaction, switchChainAsync, filterNeededApprovals]);

  const actionCount = nodes.filter((n) => {
    const t = (n.data as { type: string }).type;
    return t !== "wallet" && t !== "position";
  }).length;

  // Check for blocking errors across all nodes
  const blockingError = useMemo(() => {
    for (const node of nodes) {
      const d = node.data as Record<string, unknown>;
      if (d.exceedsBalance) {
        const symbol = (d.asset as { symbol?: string })?.symbol
          ?? (d.tokenIn as { symbol?: string })?.symbol
          ?? "";
        return `Insufficient ${symbol} balance`;
      }
      if (d.exceedsLiquidity) {
        const market = d.market as { loanAsset?: { symbol?: string } } | null;
        return `Insufficient ${market?.loanAsset?.symbol ?? ""} market liquidity`;
      }
    }
    return null;
  }, [nodes]);

  if (actionCount === 0) return null;

  const explorerUrl = txHash
    ? `${EXPLORER_BASE[chainId] ?? "https://etherscan.io"}/tx/${txHash}`
    : null;

  return (
    <>
      {/* Backdrop overlay during execution */}
      {isExecuting && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity" />
      )}
      <div
        className={`absolute bottom-0 left-1/2 -translate-x-1/2 ${
          isExecuting ? "z-50" : expanded ? "z-40" : "z-30"
        }`}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => { if (!isExecuting) { setExpanded(false); if (!showConfirm) setShowConfirm(false); } }}
      >
        <div
          className={`rounded-t-2xl border border-b-0 border-border bg-bg-card/95 shadow-2xl backdrop-blur-md transition-all duration-300 ${
            expanded || isExecuting ? "w-[520px]" : "w-[320px]"
          }`}
        >
        {/* Tab handle */}
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-brand/15">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6h8M6 2v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-brand" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-text-primary">
              Execute Strategy
            </span>
          </div>
          {wrongChain ? (
            <span className="flex items-center gap-1 rounded-full bg-orange-400/10 px-2 py-0.5 text-[10px] font-medium text-orange-400">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                <path d="M8 1l7 13H1L8 1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M8 6v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="8" cy="11.5" r="0.6" fill="currentColor" />
              </svg>
              Wrong network
            </span>
          ) : (
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand">
              {steps.length} step{steps.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Expandable content — scrollable when open so the user can reach the
            simulation preview, inspector, warnings, and Execute button even
            on shorter viewports. */}
        <div
          className={`transition-all duration-300 ${
            expanded || isExecuting
              ? "max-h-[85vh] overflow-y-auto opacity-100 scrollbar-thin"
              : "max-h-0 overflow-hidden opacity-0"
          }`}
        >
          <div className="border-t border-border px-5 py-4">
            {/* Steps timeline */}
            {steps.length > 0 ? (
              <div className="relative max-h-[280px] overflow-y-auto pr-1 scrollbar-thin">
                <div className="space-y-0">
                  {steps.map((step, i) => {
                    const done = !!txHash;
                    const isLast = i === steps.length - 1;

                    return (
                      <div key={i} className="relative flex items-start gap-3">
                        {/* Vertical connector — between circles, not through them */}
                        {!isLast && (
                          <div
                            className={`absolute left-[11px] top-6 w-[2px] ${
                              done ? "bg-success/40" : "border-l-2 border-dashed border-border bg-transparent"
                            }`}
                            style={{ height: "calc(100% - 4px)" }}
                          />
                        )}
                        {/* Circle */}
                        <div
                          className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                            done
                              ? "border border-success/40 bg-success/10 text-success"
                              : isExecuting
                                ? "border border-border bg-bg-secondary text-text-tertiary"
                                : "border border-border bg-bg-secondary text-text-tertiary"
                          }`}
                        >
                          {done ? (
                            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ) : isExecuting ? (
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="animate-spin text-text-tertiary">
                              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.2" />
                              <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          ) : (
                            i + 1
                          )}
                        </div>
                        {/* Step card */}
                        <div className={`mb-2 flex flex-1 items-center justify-between rounded-lg border px-3 py-2 ${
                          done ? "border-success/20 bg-success/5" : "border-border bg-bg-secondary"
                        }`}>
                          <div className="flex items-center gap-2">
                            <Image
                              src={step.icon}
                              alt=""
                              width={16}
                              height={16}
                              className="rounded-full"
                              unoptimized
                            />
                            <div>
                              <p className={`text-xs font-medium ${done ? "text-success" : "text-text-primary"}`}>
                                {step.label}
                              </p>
                              <p className="text-[10px] text-text-tertiary">
                                {step.detail}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`ml-2 shrink-0 rounded-md px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider ${
                              done
                                ? "border-success/20 bg-success/5 text-success"
                                : "border-border bg-bg-primary text-text-tertiary"
                            }`}
                          >
                            {typeLabels[step.type]}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-xs text-text-tertiary">
                Configure your nodes to see the execution plan
              </p>
            )}

            {/* Errors */}
            {validationErrors.length > 0 && (
              <div className="mt-3 rounded-lg border border-error/20 bg-error/5 px-3 py-2">
                {validationErrors.map((err, i) => (
                  <p key={i} className="text-[10px] text-error">{err}</p>
                ))}
              </div>
            )}
            {error && (
              <div className="mt-3 rounded-lg border border-error/20 bg-error/5 px-3 py-2 text-[10px] text-error">
                {error}
              </div>
            )}
            {txHash && (
              <div className="mt-3 rounded-lg border border-success/20 bg-success/5 px-3 py-2">
                <a
                  href={explorerUrl ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-[10px] font-medium text-success transition-colors hover:text-success/80"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Transaction confirmed
                  <span className="text-success/60">
                    {txHash.slice(0, 10)}...{txHash.slice(-6)}
                  </span>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className="ml-auto">
                    <path d="M3.5 8.5l5-5M4.5 3.5h4v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
              </div>
            )}

            {/* Confirmation warning */}
            {showConfirm && !txHash && (
              <div className="mt-3 rounded-lg border border-yellow-400/20 bg-yellow-400/5 px-3 py-2">
                <p className="text-[10px] font-medium text-yellow-400">
                  Review the steps above carefully. Click Execute again to sign.
                </p>
                <p className="mt-0.5 text-[9px] text-yellow-400/70">
                  {steps.filter((s) => s.type === "approve").length} approval(s) + 1 bundled tx
                </p>
              </div>
            )}

            {/* Approval progress */}
            {approvalStep > 0 && (
              <div className="mt-3 rounded-lg border border-yellow-400/20 bg-yellow-400/5 px-3 py-2 text-[10px] text-yellow-400">
                Approving token {approvalStep}/{totalApprovals}...
              </div>
            )}

            {/* Swap status */}
            {swapStatus && (
              <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[10px] text-amber-400">
                {swapStatus}
              </div>
            )}

            {/* Summary bar */}
            <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-bg-secondary px-3 py-2 text-[10px] text-text-tertiary">
              <span>{steps.length} action{steps.length !== 1 ? "s" : ""}</span>
              <span>1 bundled transaction</span>
            </div>

            {/* Pre-execution simulation — gas, HF, totals, warnings + opt-in MCP analysis */}
            {steps.length > 0 && (
              <SimulationPreview result={preflight} nodes={nodes} edges={edges} />
            )}

            {/* Power-user inspector — collapsible decoded bundle calls */}
            {steps.length > 0 && <BundleInspector nodes={nodes} edges={edges} />}

            {/* Blocking error */}
            {blockingError && (
              <div className="mt-3 rounded-lg border border-error/20 bg-error/5 px-3 py-2 text-[10px] text-error">
                {blockingError} — fix the issue above before executing
              </div>
            )}

            {/* Wrong chain warning + switch button */}
            {wrongChain && (
              <div className="mt-3 rounded-lg border border-orange-400/30 bg-orange-400/5 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-orange-400">
                    <path d="M8 1l7 13H1L8 1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    <path d="M8 6v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <circle cx="8" cy="12" r="0.75" fill="currentColor" />
                  </svg>
                  <p className="text-[10px] font-medium text-orange-400">
                    Wrong network — your wallet is on a different chain
                  </p>
                </div>
                <button
                  onClick={handleSwitchChain}
                  disabled={isSwitching}
                  className="mt-2 w-full rounded-lg bg-orange-400 py-2 text-xs font-semibold text-black transition-colors hover:bg-orange-300 disabled:opacity-50"
                >
                  {isSwitching ? "Switching..." : `Switch to ${expectedChainLabel}`}
                </button>
              </div>
            )}

            {/* Execute button */}
            <button
              onClick={handleExecute}
              disabled={!isConnected || isPending || steps.length === 0 || !!blockingError || wrongChain}
              className={`mt-3 w-full rounded-xl py-3 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                blockingError || wrongChain
                  ? "bg-text-tertiary"
                  : "bg-brand hover:bg-brand-hover"
              }`}
            >
              {!isConnected
                ? "Connect Wallet"
                : wrongChain
                  ? `Switch to ${expectedChainLabel}`
                  : blockingError
                    ? "Cannot Execute"
                    : isPending
                      ? approvalStep > 0
                        ? `Approving (${approvalStep}/${totalApprovals})...`
                        : "Confirming..."
                      : showConfirm
                        ? `Confirm & Execute (${steps.length} actions)`
                        : `Execute Bundle (${steps.length} actions)`}
            </button>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}