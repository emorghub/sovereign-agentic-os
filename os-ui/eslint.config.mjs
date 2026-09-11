/* SPDX-License-Identifier: Apache-2.0 */
// Next's recommended rules + two targeted overrides. Tighten by removing overrides.
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  { ignores: ['.next/**', 'node_modules/**', 'public/monaco/**', 'next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  // Test doubles use `any` freely; production code does not (0 hits outside tests).
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  // `useAs` / `useAsData` here are MCP tool clients, not React hooks — the rule fires
  // on the `use` prefix alone. Renaming them (and their callers) is the real fix.
  {
    files: ['components/files/FilePreview.tsx', 'lib/software/platform-mcp.ts'],
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
];
