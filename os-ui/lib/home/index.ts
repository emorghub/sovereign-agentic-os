/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
/**
 * Home — the tab's PUBLIC API.
 *
 * VALUE exports here are `server-only` (feed + assistant). TYPE exports are
 * erased at compile time, so any component can take them from this barrel.
 *
 * The PURE modules `launcher.ts` and `scope.ts` are type-only here on purpose.
 * Their VALUE surfaces (launcherFor, cockpitOrder) stay deep-path so a future
 * CLIENT component can use them without importing a server-only barrel.
 * `intents.ts` has no external consumer.
 *
 * `stubs.ts` (server-only) stays internal: it is the documented consolidation
 * seam (domainPulse -> @/lib/strategy, healthCost -> @/lib/monitoring).
 */

// Per-viewer home + cockpit feed aggregators (server-only).
export { homeFeed, cockpitFeed } from './feed.ts';
export type { HomeFeed } from './feed.ts';

// The two-mode governed Home assistant: answer / scaffold (server-only).
export { ask } from './assistant.ts';

// Pure shaper + launcher TYPES consumed by the Home client components.
export type { ModuleKey, TopGroup } from './scope.ts';
export type { PathId, LauncherCard } from './launcher.ts';
