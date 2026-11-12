// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2025-2026 Alban Derouin. All rights reserved.

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next, at any depth: anchored to the
    // root they let `npm run lint` walk the build output of nested checkouts
    // (worktrees under .claude/) and report thousands of errors in generated
    // chunks.
    "**/.next/**",
    "**/out/**",
    "**/build/**",
    "next-env.d.ts",
    // Agent tooling: skills, plugin copies and worktrees, not app code.
    ".claude/**",
  ]),
]);

export default eslintConfig;