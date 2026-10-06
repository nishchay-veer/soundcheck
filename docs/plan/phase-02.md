# Phase 02 — Sign-in and channel connect

**Goal.** A creator clicks Connect YouTube, consents once, and their channel appears in Firestore with a KMS-encrypted refresh token. Every route handler and server component knows the user from the Auth.js session, and pipeline jobs can get fresh YouTube credentials for any connected channel.

**Depends on.** Phases 00 and 01. Day: Oct 2.

## Stack

- Auth.js v5 (`next-auth@5`, still beta) with the Google provider, JWT sessions, and the split config pattern (`auth.config.ts` for the proxy, `auth.ts` for the full config)
- Next.js route handlers and server components on the Node runtime
- `@google-cloud/kms`, `@google-cloud/firestore`, `@google-cloud/secret-manager`, `@google-cloud/bigquery`, `@google-cloud/storage`
- `@googleapis/youtube` (YouTube Data API v3; the single-API package rather than all of `googleapis`) and `google-auth-library` (`OAuth2Client`) for token refresh

## Build

1. `apps/web/src/auth.ts`: Google provider with authorization params `scope = "openid email profile https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly"`, `access_type = "offline"`, `prompt = "consent"`, `include_granted_scopes = "true"`. Env: `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET`, `AUTH_URL`.
2. In the `signIn` callback, call `connectChannel()` from `packages/core/src/data/channels.ts` directly: it is server code, so there is no HTTP hop. Only `signIn` can redirect, so known failures map to explanation pages there. In the `jwt` callback, on first sign-in only (when `account` is present), store only `userId` (the Google `sub`) and `channelIds` in the JWT; the `session` callback exposes them. Tokens never reach the browser.
3. `connectChannel({googleSub, email, accessToken, refreshToken, expiresAt, scope})`:
   - Throw `MissingScopesError` if either YouTube scope is absent (users can untick scopes on the consent screen); the sign-in flow redirects to `/connect/missing-scopes`.
   - Encrypt the refresh token with KMS, using `userId` as additional authenticated data.
   - Call `youtube.channels.list({part: ["snippet", "statistics", "contentDetails"], mine: true})` with the access token.
   - Upsert `users/{userId}` and `channels/{channelId}` with `{userId, title, thumbnailUrl, subscriberCount, videoCount, uploadsPlaylistId, status: "connected", tokenCiphertext, tokenScope, connectedAt, build: {state: "not_started"}}`.
   - Throw `NoChannelError` when the account has no channel (`/connect/no-channel`) and `ChannelOwnedError` when another user already connected it (`/connect/channel-taken`).
   - A reconnection replaces the token and profile but keeps `connectedAt` and `build`.
   - On a first connection only, call `startChannelBuild(channelId)`, a no-op until Phase 10 wires it to Workflows.
4. `packages/core/src/youtube/auth.ts`: `credentialsForChannel(channelId): Promise<OAuth2Client>`. It decrypts the token, reads the client ID and secret from Secret Manager, calls `setCredentials({refresh_token})` and forces a refresh with `getAccessToken()`. On `invalid_grant` it sets the channel's `status` to `reauth_required` and throws `ReauthRequiredError`. Pipeline jobs use this.
5. `packages/core/src/data/authz.ts`: `requireChannel(userId, channelId)` loads the channel and throws `NotFoundError` unless `userId` matches (404, not 403, so channel IDs cannot be probed). Every route handler and server component calls it with the session's user ID.
6. Route handlers (all `export const runtime = "nodejs"`): `GET /api/v1/me` returns the user and channels; `DELETE /api/v1/channels/[id]` revokes the token at `https://oauth2.googleapis.com/revoke`, deletes Firestore documents, runs BigQuery `DELETE` for that channel in every table that has `channel_id` (in parallel), and deletes the channel's `{channel_id}/` prefix in every bucket. Firestore is deleted last, so a failure part-way can be retried. `sa-web` needs `bigquery.jobUser`, `bigquery.dataEditor` on the dataset and `storage.objectAdmin` on all three buckets for this. That is the privacy guarantee you will state to judges.
7. `proxy.ts` (Next.js 16 renamed `middleware.ts` to `proxy.ts`, which always runs on Node; it uses `auth.config.ts`) protects `/app/**` and `/api/v1/**`, except `/api/healthz` and `/api/auth/**`: 401 JSON for API calls, a redirect for pages. It only checks the session; it never calls a Google SDK.
8. Pages: `/` with a Connect YouTube button calling `signIn("google")`; `/app` showing the connected channel card; `/reauth` explaining expired access with a reconnect button; `/connect/missing-scopes` explaining why both YouTube permissions are needed; `/connect/no-channel`, `/connect/channel-taken` and `/connect/error` for the other failures.
9. Tests (Vitest): `connectChannel` with mocked KMS and YouTube (recorded fixture); scope validation; `requireChannel` ownership; the `ReauthRequiredError` path; a pino redaction test proving tokens never appear in log output.

## Decisions and gotchas

- With the API inside Next.js there is no service-to-service trust boundary: identity comes from the Auth.js session, verified on the server, and every data function takes the user ID explicitly.
- Anything that touches a Google SDK runs on the Node runtime. The proxy also runs on Node in Next.js 16, but stays SDK-free so it stays fast.
- `prompt=consent` is required to receive a refresh token on every sign-in.
- One Google account maps to one channel through `mine: true`. Brand-account selection is out of scope.
- Refresh tokens are KMS-encrypted in Firestore rather than one Secret Manager secret per user: it scales and needs one decrypt permission.

## Do not

- Put access or refresh tokens in the session, cookies, logs or URLs.
- Request `youtube.force-ssl` or monetary scopes.

## Done when

- [ ] Signing in with a test-user account creates `channels/{id}` with ciphertext and no plaintext token anywhere
- [ ] `scripts/list-uploads.ts` using `credentialsForChannel` lists the channel's five latest uploads
- [ ] `DELETE /api/v1/channels/[id]` leaves no trace in Firestore, BigQuery or GCS
- [ ] Unauthenticated calls to `/api/v1/**` get 401
- [ ] `docs/notes/phase-02.md` written
