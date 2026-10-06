# Phase 02: Sign-in and channel connect

Oct 6, 2026

A creator clicks Connect YouTube, consents once, and their channel appears in Firestore with a KMS-encrypted refresh token. Route handlers and server components know the user from the Auth.js session. Pipeline jobs get fresh YouTube credentials through `credentialsForChannel()`. A creator can delete a channel and every trace of its data.

Built in six reviewed commits:

1. `Update git rule to commit each reviewed part`
2. `Add user and channel schemas, typed errors and requireChannel`
3. `Connect a YouTube channel with a KMS-encrypted refresh token`
4. `Refresh channel credentials for pipeline jobs`
5. `Sign in with Google and show the connected channel`
6. `Delete a channel and every trace of its data`

The live checks, recorded fixtures and these notes make a seventh.

## Done when

| Item                                                                                                        | Status | Evidence                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signing in with a test-user account creates `channels/{id}` with ciphertext and no plaintext token anywhere | Done   | Signed in as `nishchayv.dev@gmail.com`; `channels/UC-BHlgFbFh3V76yth-XCmlw` held `tokenCiphertext` (248 base64 chars). No `1//` or `ya29.` pattern in any channel or user document, nor in the server log                                                                                                                                    |
| `scripts/list-uploads.ts` using `credentialsForChannel` lists the channel's five latest uploads             | Done   | Listed the channel's uploads newest first (it has 4). It decrypts the token, reads the OAuth client from Secret Manager and refreshes                                                                                                                                                                                                        |
| `DELETE /api/v1/channels/[id]` leaves no trace in Firestore, BigQuery or GCS                                | Done   | Seeded one row each in `videos` and `quality_reports` and one object in each bucket, then deleted from the UI. Summary: token revoked, 2 rows and 3 objects deleted. Afterwards: channel document NOT_FOUND with no subcollection documents, user `channelIds: []`, 0 rows in all 12 tables, 0 objects under the prefix in all three buckets |
| Unauthenticated calls to `/api/v1/**` get 401                                                               | Done   | In the production Docker image: `/api/v1/me` and `/api/v1/channels/…` gave 401 with no session and with a forged session cookie; `/app` redirected (307); `/api/healthz` stayed 200. Also covered by `proxy.test.ts` (real proxy, real Auth.js)                                                                                              |
| `docs/notes/phase-02.md` written                                                                            | Done   | This file                                                                                                                                                                                                                                                                                                                                    |

`pnpm check` passes all 20 tasks: core 99 tests, web 24, ui 4, plus the other packages. `pnpm build` and the web Docker image build pass.

## What exists

- **Core**
  - `schemas/`:
    - `users` and `channels` documents;
    - the YouTube `channels.list` and `playlistItems.list` responses;
    - `/api/v1/me` and the deletion summary (`api.ts`);
    - session claims;
    - the sign-in scope list.
  - `errors.ts`: `MissingScopesError`, `NoChannelError`, `ChannelOwnedError`, `NotFoundError`, `ReauthRequiredError`.
  - `crypto/tokens.ts`: KMS encrypt/decrypt with the owner's `userId` as additional authenticated data. Not exported from the package.
  - `data/`:
    - `requireChannel` (ownership; 404 for missing and foreign alike, and IDs are format-checked before any read);
    - `connectChannel` and the no-op `startChannelBuild`;
    - `loadChannel`, for jobs only;
    - `getMe` and `getUserChannelIds`;
    - `deleteChannel`.
  - `youtube/`: the API client, pure response parsers, and `credentialsForChannel`.
  - `secrets.ts`: Secret Manager reads, cached per process.
  - Test fakes for Firestore, KMS, Secret Manager, BigQuery and Storage.
- **Web**
  - Auth: `auth.config.ts` (shared, SDK-free), `auth.ts` (full), and `proxy.ts`.
  - API: `/api/auth/[...nextauth]`, `GET /api/v1/me`, `DELETE /api/v1/channels/[id]`.
  - Pages: `/`, `/app` (channel card with a delete button), `/reauth`, and `/connect/{missing-scopes,no-channel,channel-taken,error}`.
  - `Button` in `packages/ui`.
- **Scripts**
  - `list-uploads.ts`.
  - `record-fixtures.ts`: records anonymized YouTube responses into `tests/fixtures/youtube/`.
- **Infra**
  - `local-auth-env.sh`: fills the local sign-in values in `.env` from Secret Manager without printing them, and generates a local `AUTH_SECRET`.
  - New `sa-web` roles for channel deletion (applied).

## Changes from the spec

All are recorded in `docs/plan/phase-02.md`, and the `sa-web` roles in `phase-01.md`.

- **`proxy.ts`, not Edge `middleware.ts`.** Next.js 16 renamed middleware to proxy, and it always runs on Node. It still makes no SDK calls.
- **`connectChannel` runs in the `signIn` callback, not `jwt`.** Only `signIn` can redirect, which the explanation pages need.
- **Two extra error pages:** `/connect/no-channel` and `/connect/channel-taken`, for an account without a channel and a channel connected by someone else (refused, not taken over). There is also a generic `/connect/error`.
- **A reconnect keeps progress.** It replaces the token and profile but keeps `connectedAt` and `build`; only a first connect starts a build.
- **`@googleapis/youtube` instead of `googleapis`.** Same API, one package.
- **Deletion details:**
  - Tables are found through `INFORMATION_SCHEMA` (every table with `channel_id`) and deleted in parallel.
  - Firestore goes last, so a failure can be retried.
  - `sa-web` gained `bigquery.jobUser`, `bigquery.dataEditor` on the dataset and `storage.objectAdmin` on the raw and media buckets (decision B).
- **Env schema:** `IMAGEN_MODEL` and the `WORKFLOW_*` variables are optional until their phases. `AUTH_SECRET` must be at least 32 characters.
- **Google Cloud clients validate only the env they use**, so pipeline jobs don't need the web app's auth secrets.
- **Git rule 16:** commit each part after the human's review (decision A).

## Incidents and fixes

- **Proxy export.**
  - Symptom: the first production image answered every request with 500: "The Proxy file must export a function named `proxy` or a default function".
  - Cause: with a lazy config, Auth.js returns the wrapped handler as a Promise.
  - Fix: `proxy.ts` awaits it inside a plain function. `proxy.test.ts` now runs the real proxy and real Auth.js, which needed `next-auth` inlined in Vitest because it imports `next/server` without an extension.
- **Root `.env` not loaded.**
  - Symptom: the dev server saw none of the root values.
  - Cause: Next reads `.env` only from `apps/web`, and `@next/env` caches its first result, so calling `loadEnvConfig(root)` was a no-op.
  - Fix: `next.config.ts` merges the root file with Node's `util.parseEnv`; values already set win. `@next/env` was dropped again.
- **Placeholder `AUTH_SECRET`.**
  - Symptom: `AUTH_SECRET` in `.env` was 1 character, and the helper only generated one when the value was empty.
  - Fix: replaced with a random 44-character value. The env schema now requires 32 or more characters, and the helper treats anything shorter as unset.
- **Fixture leak.**
  - Symptom: the first recorded fixtures carried the real channel and video IDs inside base64 playlist item IDs.
  - Fix: the recorder now rewrites IDs inside base64 too, and a scan of plaintext and decoded base64 finds no identifying values.
- **Slow deletion.**
  - Symptom: the first live delete took 48 s, because 12 BigQuery DML jobs ran one after another.
  - Fix: they now run in parallel. 12 concurrent DELETEs took about 7 s.
- **A transient Turbopack Google Fonts error** failed one Docker build; the rebuild passed with no code change.

## Notes for later phases

- **Where per-channel data must live:**
  - Firestore data under `channels/{channelId}`;
  - every BigQuery table must have a `channel_id` column;
  - GCS objects under `{channel_id}/` in each bucket.
  - `deleteChannel` relies on all three; anything stored elsewhere survives a deletion.
- **BigQuery writes:** rows still in the streaming buffer cannot be `DELETE`d for about 90 minutes. Ingestion should write with load jobs (or DML), not `insertAll`.
- **Deleting during a build:** a channel deleted while a build is running could get rows written after the delete. Phase 10 should cancel a running build, or have jobs check that the channel still exists before writing.
- **Credentials:**
  - `credentialsForChannel` has no ownership check; it is for jobs.
  - Request paths must call `requireChannel(session.userId, id)` first.
  - On `invalid_grant` the channel becomes `reauth_required` and the UI links to `/reauth`.
- **Rule 6 scope.** Raw-response archiving to `gs://…-raw` starts with ingestion (Phase 03); `connectChannel`'s single `channels.list` call is not archived. `sa-web` could not write there before Phase 02 anyway.
- **OAuth Testing mode:**
  - Refresh tokens expire after 7 days.
  - At most 100 test users.
  - Every creator must be added as a test user before connecting.
- **Session staleness:**
  - The JWT's `channelIds` are set at sign-in and go stale after a delete. Screens should read Firestore (as `getMe` does) rather than trust the token's list.
  - The session cookie is SameSite=Lax (Auth.js default), which is what protects the DELETE route from cross-site requests.
- **Auth.js logging:** Auth.js logs its own errors (for example `JWTSessionError` for a forged cookie) in its own format, not through pino.
- **Leftover IAM binding:** `sa-web` still holds the original `objectViewer` binding on the raw bucket; `objectAdmin` supersedes it.
- **Local development:**
  1. `infra/local-auth-env.sh` (run by the human; it reads secrets);
  2. `pnpm dev`;
  3. sign in at http://localhost:3000.
- **Fixtures.** `pnpm --filter @soundcheck/scripts record-fixtures <CHANNEL_ID>` re-records them, anonymized.
