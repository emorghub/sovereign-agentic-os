<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
-->
# OAuth

Manages **OAuth 2.1 / PKCE flows** for personal Drive connections — Google Drive and
OneDrive. This module is the plumbing underneath `lib/connections`: it builds the
authorization URL, handles the callback, exchanges codes for tokens, and keeps
access/refresh token pairs alive. Secrets never leave — tokens are stored as
`secretRef` entries, not raw values. Scopes are read-only by design.

## Golden path

1. **Start** — `buildAuthorizationUrl(provider, state, codeChallenge)` assembles the
   provider's authorization endpoint URL from `OAUTH_PROVIDERS`.
2. **PKCE** — `pkce.ts` generates the `code_verifier` / `code_challenge` pair before
   the redirect; the verifier is stored in the session and never sent to the provider.
3. **CSRF** — `signState` / `verifyState` in `state.ts` protect the round-trip; the
   signed state parameter is validated on callback before any token exchange begins.
4. **Exchange** — `handleRedirect` in `redirect.ts` exchanges the authorization code
   for an access + refresh token via `client.ts`.
5. **Store** — `storeTokenSet` in `token-set.ts` persists the pair under a
   `secretRef` in the connections store; the raw values are discarded.
6. **Refresh** — `refreshAccessToken` in `token-set.ts` silently renews before
   expiry; `drive-status.ts` probes reachability without exposing the token.
7. **Revoke** — `revokeToken` in `connection-token.ts` cleans up on connection
   delete or rotation.

## Public API

Import via `@/lib/oauth` (the barrel):

**Pure (client-safe)**
- `providers.ts` — `OAUTH_PROVIDERS`, `providerForTemplate`, `filesProviderFor`,
  `asOAuthProvider`, `providerConfig`, `type OAuthProvider`, `type OAuthProviderConfig`
- `pkce.ts` — `randomVerifier`, `challengeFor`, `createPkcePair`, `type PkcePair`
- `state.ts` — `newNonce`, `signState`, `verifyState`, `nonceMatches`,
  `OAUTH_STATE_COOKIE`, `type OAuthState`
- `redirect.ts` — `publicBaseUrl`, `callbackUri`
- `token-set.ts` — `tokenSetFromResponse`, `serializeTokenSet`, `parseTokenSet`,
  `isExpired`, `buildAuthorizeUrl`, `exchangeBody`, `refreshBody`,
  `type TokenSet`, `type TokenResponse`
- `drive-status.ts` — `driveConnectionStatus`, `driveAuthorizePath`,
  `type DriveConnectionStatus`

**`server-only`**
- `connection-token.ts` — `storeTokens`, `readTokens`, `resolveAccessToken`,
  `type TokenResolution`
- `oauth-apps.ts` — `ensureHydrated`, `registerOAuthApp`, `getOAuthApp`,
  `isConfigured`, `listOAuthApps`, `getClientCredentials`, `providerCatalog`,
  `type OAuthApp`
- `client.ts` — `exchangeCode`, `refreshTokens`, `probeDrive`
- `notion-flow.ts` — `putPendingFlow`, `takePendingFlow`, `type NotionPendingFlow`
- `notion-mcp.ts` — `NOTION_MCP_ENDPOINT`, `discoverMetadata`, `registerClient`,
  `buildNotionAuthorizeUrl`, `exchangeNotionCode`, `refreshNotionToken`,
  `listNotionMcpTools`, `serializeClientReg`, `parseClientReg`, + its types

### Documented exceptions (deep-path, intentional)

- `components/connections/ConnectionBuilder.tsx:37,38` — a `'use client'`
  component importing `providers` + `drive-status` as VALUES. The barrel
  re-exports `server-only` surfaces, so it must stay deep-path.

### Internal

- `_reset()` — exported by both `notion-flow.ts` and `oauth-apps.ts` (test
  helpers). The name collides, so neither is re-exported.

NOTE: this section previously named `generatePkce`, `buildAuthorizationUrl`,
`handleRedirect`, `storeTokenSet`, `loadTokenSet`, `refreshAccessToken`,
`mintToken`, `refreshToken`, `revokeToken` and `tokenExchange` — none of which
exist. It placed `probeDrive` under `drive-status.ts` (it is in `client.ts`),
omitted `client.ts` entirely, and had `server-only` on `token-set.ts` (pure)
instead of `oauth-apps.ts` (server-only). Rewritten against the real exports.

## Invariants & Dependencies

**Invariants**

- **Read-only scopes.** `OAUTH_PROVIDERS` defines the minimal read-only scope list;
  no write scope may be requested via this module.
- **Secrets are references.** Raw access/refresh tokens are held in memory only for
  the exchange duration; persisted values are always `secretRef` objects.
- **PKCE required.** Every authorization code flow must carry a `code_challenge`;
  implicit flows are not supported.
- **CSRF on every round-trip.** The signed `state` parameter is verified before the
  code exchange begins; mismatches abort immediately.

**Dependencies**

- `lib/core` — identity, config, base types.
- `lib/connections` — schema (`Connection`, `secretRef`) + store (token persistence).
- `lib/files` — connector map (determines which connector handles a given provider).
