// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

/**
 * Server-safe helpers for the public canvas API.
 *
 * These functions must NOT depend on the browser, React, wagmi, or
 * @xyflow/react — they run in Edge runtime under /api routes.
 */

import type { ImportedStrategy } from "./importStrategy";

/** Public request shape for POST /api/canvas */
export interface CanvasApiRequest extends Partial<ImportedStrategy> {
  chain?: string;
}

const VALID_NODE_TYPES = new Set([
  "walletNode",
  "supplyCollateralNode",
  "borrowNode",
  "swapNode",
  "vaultDepositNode",
  "vaultWithdrawNode",
  "positionNode",
  "repayNode",
]);

const VALID_DATA_TYPES = new Set([
  "wallet",
  "supplyCollateral",
  "borrow",
  "swap",
  "vaultDeposit",
  "vaultWithdraw",
  "position",
  "repay",
]);

const MAX_NODES = 200;
const MAX_EDGES = 500;
const MAX_STRING_LEN = 500;

/**
 * Edge-runtime safe validator. Mirrors the schema check inside
 * `importStrategy.ts`'s `isValidImportedStrategy`, but kept separate so
 * the API routes can run in the Edge runtime without pulling in
 * @xyflow/react / browser-only deps.
 */
export function isValidImportedStrategyForApi(
  data: unknown
):
  | { ok: true; strategy: ImportedStrategy }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    return { ok: false, errors: ["Body must be a JSON object"] };
  }

  const obj = data as Record<string, unknown>;

  // Required: nodes (array), edges (array), sourceAddress (string)
  if (!Array.isArray(obj.nodes)) errors.push("`nodes` must be an array");
  if (!Array.isArray(obj.edges)) errors.push("`edges` must be an array");
  if (typeof obj.sourceAddress !== "string") {
    errors.push("`sourceAddress` must be a string");
  } else if (obj.sourceAddress.length > 100) {
    errors.push("`sourceAddress` exceeds 100 chars");
  }

  if (errors.length > 0) return { ok: false, errors };

  const nodes = obj.nodes as unknown[];
  const edges = obj.edges as unknown[];

  if (nodes.length > MAX_NODES) errors.push(`Too many nodes (max ${MAX_NODES})`);
  if (edges.length > MAX_EDGES) errors.push(`Too many edges (max ${MAX_EDGES})`);

  // Validate each node
  const nodeIds = new Set<string>();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node || typeof node !== "object") {
      errors.push(`nodes[${i}]: must be an object`);
      continue;
    }
    const n = node as Record<string, unknown>;
    if (typeof n.id !== "string" || n.id.length === 0 || n.id.length > MAX_STRING_LEN) {
      errors.push(`nodes[${i}].id: must be a non-empty string`);
      continue;
    }
    if (nodeIds.has(n.id)) {
      errors.push(`nodes[${i}].id: duplicate id "${n.id}"`);
    }
    nodeIds.add(n.id);
    if (typeof n.type !== "string" || !VALID_NODE_TYPES.has(n.type)) {
      errors.push(
        `nodes[${i}].type: must be one of ${Array.from(VALID_NODE_TYPES).join(", ")}`
      );
    }
    if (!n.position || typeof n.position !== "object") {
      errors.push(`nodes[${i}].position: must be an object with x, y`);
    } else {
      const pos = n.position as Record<string, unknown>;
      if (typeof pos.x !== "number" || typeof pos.y !== "number") {
        errors.push(`nodes[${i}].position: x and y must be numbers`);
      }
    }
    if (!n.data || typeof n.data !== "object") {
      errors.push(`nodes[${i}].data: must be an object`);
    } else {
      const d = n.data as Record<string, unknown>;
      if (typeof d.type !== "string" || !VALID_DATA_TYPES.has(d.type)) {
        errors.push(
          `nodes[${i}].data.type: must be one of ${Array.from(VALID_DATA_TYPES).join(", ")}`
        );
      }
    }
  }

  // Validate each edge
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (!edge || typeof edge !== "object") {
      errors.push(`edges[${i}]: must be an object`);
      continue;
    }
    const e = edge as Record<string, unknown>;
    if (typeof e.id !== "string" || e.id.length > MAX_STRING_LEN) {
      errors.push(`edges[${i}].id: must be a string`);
    }
    if (typeof e.source !== "string" || e.source.length > MAX_STRING_LEN) {
      errors.push(`edges[${i}].source: must be a string`);
    }
    if (typeof e.target !== "string" || e.target.length > MAX_STRING_LEN) {
      errors.push(`edges[${i}].target: must be a string`);
    }
    if (e.source === e.target) {
      errors.push(`edges[${i}]: self-loop (source == target)`);
    }
    if (typeof e.source === "string" && !nodeIds.has(e.source)) {
      errors.push(`edges[${i}].source: references unknown node "${e.source}"`);
    }
    if (typeof e.target === "string" && !nodeIds.has(e.target)) {
      errors.push(`edges[${i}].target: references unknown node "${e.target}"`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    strategy: obj as unknown as ImportedStrategy,
  };
}

/**
 * Encode an ImportedStrategy as a base64url payload, suitable for use as the
 * `?strategy=` deep link parameter. Edge-runtime safe (uses btoa, not Buffer).
 */
export function buildDeepLinkPayload(strategy: ImportedStrategy): string {
  const json = JSON.stringify(strategy);
  // Edge runtime exposes btoa
  if (typeof btoa !== "function") {
    throw new Error("btoa not available in this runtime");
  }
  // Encode UTF-8 → binary string for btoa
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
