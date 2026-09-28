/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
/**
 * OAuth — the module's PUBLIC API.
 *
 * The connection store, the OAuth/Notion route handlers and the Connections UI
 * import OAuth through THIS module, never through its internal files.
 *
 * The deep-path imports `@/lib/oauth/providers` and `@/lib/oauth/drive-status`
 * remain valid for client components that must avoid the `server-only` surfaces
 * (`connection-token`, `oauth-apps`, `client`, `notion-flow`, `notion-mcp`)
 * re-exported below.
 *
 * `_reset()` is exported by BOTH `notion-flow.ts` and `oauth-apps.ts` as a test
 * helper; the name collides, so neither is re-exported here.
 */

// Provider catalog + template mapping (pure, client-safe).
export {
  OAUTH_PROVIDERS,
  providerForTemplate,
  filesProviderFor,
  asOAuthProvider,
  providerConfig,
} from './providers.ts';
export type { OAuthProvider, OAuthProviderConfig } from './providers.ts';

// PKCE pair for the authorization-code flow (pure).
export { randomVerifier, challengeFor, createPkcePair } from './pkce.ts';
export type { PkcePair } from './pkce.ts';

// Signed state cookie + nonce — CSRF protection on the callback (pure).
export {
  newNonce,
  signState,
  verifyState,
  nonceMatches,
  OAUTH_STATE_COOKIE,
} from './state.ts';
export type { OAuthState } from './state.ts';

// Redirect URI construction (pure).
export { publicBaseUrl, callbackUri } from './redirect.ts';

// Token-set shape, expiry + the provider authorize URL (pure; no I/O).
export {
  tokenSetFromResponse,
  serializeTokenSet,
  parseTokenSet,
  isExpired,
  buildAuthorizeUrl,
  exchangeBody,
  refreshBody,
} from './token-set.ts';
export type { TokenSet, TokenResponse } from './token-set.ts';

// Drive connection status for the Connections UI (pure).
export { driveConnectionStatus, driveAuthorizePath } from './drive-status.ts';
export type { DriveConnectionStatus } from './drive-status.ts';

// Per-connection token lifecycle (server-only).
export { storeTokens, readTokens, resolveAccessToken } from './connection-token.ts';
export type { TokenResolution } from './connection-token.ts';

// Admin-registered OAuth apps — client credentials per provider (server-only).
export {
  ensureHydrated,
  registerOAuthApp,
  getOAuthApp,
  isConfigured,
  listOAuthApps,
  getClientCredentials,
  providerCatalog,
} from './oauth-apps.ts';
export type { OAuthApp } from './oauth-apps.ts';

// Token endpoint exchange + drive reachability probe (server-only).
export { exchangeCode, refreshTokens, probeDrive } from './client.ts';

// Notion OAuth pending-flow store (server-only).
export { putPendingFlow, takePendingFlow } from './notion-flow.ts';
export type { NotionPendingFlow } from './notion-flow.ts';

// Notion MCP client registration + token binding (server-only).
export {
  NOTION_MCP_ENDPOINT,
  discoverMetadata,
  registerClient,
  buildNotionAuthorizeUrl,
  exchangeNotionCode,
  refreshNotionToken,
  listNotionMcpTools,
  serializeClientReg,
  parseClientReg,
} from './notion-mcp.ts';
export type { FetchFn, NotionMcpMetadata, NotionClientReg, McpToolInfo } from './notion-mcp.ts';
