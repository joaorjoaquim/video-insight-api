# video-insight-api — Project Context for AI

## What This Is

Fastify v5 + TypeScript REST API for SummaryVideos. Handles auth, video processing pipeline (download → transcribe → AI analysis), and a credit-based billing system. Deployed on Vercel (serverless) and Docker.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Fastify v5.2.1 |
| Language | TypeScript |
| ORM | TypeORM v0.3.20 |
| Database | PostgreSQL |
| Cache | Redis (Upstash) |
| Auth | @fastify/jwt + bcrypt |
| Validation | @sinclair/typebox |
| AI | OpenAI GPT-4 |
| Deployment | Vercel serverless + Docker |

---

## Project Structure

```
src/
├── server.ts                             # Fastify app setup, plugins registration
├── api/index.ts                          # Vercel serverless handler
├── local.ts                              # Local dev entry point (+ node-cron jobs)
├── config/
│   ├── db.config.ts                      # TypeORM PostgreSQL (read/write replicas, pooling)
│   ├── redis.config.ts                   # Redis/Upstash
│   ├── aws.config.ts                     # AWS S3 (audio storage)
│   └── logger.ts                         # Pino logger
├── entities/
│   ├── User.ts                           # id, email, credits, GitHub fields, referral fields, ...
│   ├── Video.ts                          # id, url, status, summary, transcript, insights, mindMap, duration
│   ├── CreditTransaction.ts              # amount, type, status, referenceId, referenceType, tokensUsed
│   ├── VideoProcessingLog.ts             # Processing audit trail
│   ├── PromoCode.ts                      # code, credits, maxUses, usedCount, expiresAt, isActive
│   └── PromoCodeRedemption.ts            # promoCodeId, userId, redeemedAt (unique per user+code)
├── repositories/                         # TypeORM data access layer
│   ├── promo-code.repository.ts
│   └── promo-code-redemption.repository.ts
├── lib/
│   └── secure-compare.ts                 # crypto.timingSafeEqual wrapper (SHA-256 hashed)
├── services/
│   ├── user.service.ts                   # User CRUD, OAuth user creation/update, referral code generation
│   ├── credit.service.ts                 # grantCredits (admin), grantCreditsInternal, deduct, history
│   ├── oauth.service.ts                  # Google + Discord + GitHub OAuth flows
│   ├── video.service.ts                  # Video CRUD, status management
│   ├── video-pipeline.service.ts         # Orchestrate download → transcribe → analyze + referral trigger
│   ├── video-ai.service.ts               # OpenAI integration
│   ├── github.service.ts                 # GitHub API: verify star/fork, pagination, reward amounts
│   ├── promo.service.ts                  # Promo code redemption (DB transaction), admin create/list
│   └── cron.service.ts                   # runExpirePromoCodes, runWeeklyCreditRestore
├── controllers/                          # Request handlers
│   ├── auth.controller.ts
│   ├── credit.controller.ts
│   ├── github-claim.controller.ts        # POST /credits/claim/github
│   ├── promo.controller.ts               # POST /credits/redeem + admin promo routes
│   ├── referral.controller.ts            # GET /user/referral
│   └── cron.controller.ts               # GET /internal/cron/*
├── routes/
│   ├── index.ts                          # Route aggregator
│   ├── auth.routes.ts
│   ├── user.routes.ts                    # + GET /referral
│   ├── credit.routes.ts                  # + /redeem, /claim/github, /admin/promo, /admin/promos
│   ├── video.routes.ts
│   └── cron.routes.ts                    # /internal/cron/expire-promos, /restore-credits
├── schemas/                              # TypeBox request/response validation
├── plugins/
│   ├── auth.ts                           # JWT verification middleware
│   └── errorHandler.ts
└── migrations/
    └── GrowthSystemMigration.ts          # User columns + promo_codes + promo_code_redemptions tables
```

---

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/signup` | — | Register email/password → `{ user, token }`. Accepts optional `referralCode`. |
| POST | `/auth/login` | — | Login → `{ user, token }` |
| GET | `/auth/oauth/:provider` | — | Redirect to OAuth (`google` \| `discord` \| `github`) |
| GET | `/auth/callback/:provider` | — | OAuth callback, redirects with token |
| GET | `/auth/link/github` | JWT | Returns `{ url }` — frontend redirects to `url` to start GitHub OAuth link flow; on success callback redirects to /wallet?github_linked=1 |
| GET | `/user/profile` | JWT | Current user data |
| GET | `/user/:id` | — | Get user by ID |
| GET | `/user/referral` | JWT | Referral code + URL + stats; auto-generates code if missing |
| POST | `/video` | JWT | Submit video URL for processing |
| GET | `/video` | JWT | List user's videos |
| GET | `/video/:id` | JWT | Get video details |
| GET | `/video/:id/status` | JWT | Poll processing status |
| GET | `/credits` | JWT | Balance + transaction history (limit, offset) |
| POST | `/credits/redeem` | JWT | Redeem a promo code once per user |
| POST | `/credits/claim/github` | JWT | Claim credits for starring/forking a repo (once per action per repo) |
| POST | `/credits/admin/grant` | X-Admin-Hash | Grant credits to user |
| POST | `/credits/admin/deduct` | X-Admin-Hash | Deduct credits from user |
| POST | `/credits/admin/promo` | X-Admin-Hash | Create promo code |
| GET | `/credits/admin/promos` | X-Admin-Hash | List all promo codes |
| GET | `/internal/cron/expire-promos` | Bearer CRON_SECRET | Mark expired promo codes inactive |
| GET | `/internal/cron/restore-credits` | Bearer CRON_SECRET | Restore weekly credit floor (default 100) |

---

## Auth

JWT expiry: 15 days. Token returned on signup/login/OAuth callback.

OAuth providers: `google`, `discord`, `github`.

Admin routes: `X-Admin-Hash` header, compared with `ADMIN_CREDIT_HASH` env var using timing-safe compare (`crypto.timingSafeEqual` + SHA-256). Rate-limited 10 req/15 min per IP.

Cron routes: `Authorization: Bearer <CRON_SECRET>` header (Vercel injects automatically). Rate-limited 5 req/5 min per IP.

---

## Credit System

- Default credits on signup: 100
- Weekly restore floor: `WEEKLY_CREDIT_FLOOR` env var (default 100) — users below floor get topped up, users above are untouched
- Credit cost: ~5 (short video), ~8 (medium), ~12–15 (long)
- GitHub star reward: 5 credits per repo | fork reward: 10 credits per repo (4 claims max per user)
- Referral signup bonus: 10 credits for new user | referrer earns 5 credits after referee's first completed video
- `CreditTransaction.type`: `PURCHASE | SPEND | REFUND | ADMIN_GRANT | ADMIN_DEDUCT | REFERRAL_REWARD`
- `CreditTransaction.status`: `PENDING | COMPLETED | FAILED | CANCELLED`

---

## User Entity — Growth Fields

```typescript
// GitHub integration
githubUsername: string | null
githubId: string | null
githubStarClaimedWeb: boolean    // star on video-insight-web
githubForkClaimedWeb: boolean    // fork on video-insight-web
githubStarClaimedApi: boolean    // star on video-insight-api
githubForkClaimedApi: boolean    // fork on video-insight-api

// Referral system
referralCode: string | null      // 8-char hex, unique, auto-generated on signup
referredByCode: string | null    // referral code used at signup
referralRewardGranted: boolean   // true once referrer was credited (idempotency guard)
referralCreditsEarned: number    // running total of credits earned from referrals
```

---

## GitHub Claiming

`POST /credits/claim/github` body:
```json
{ "action": "star" | "fork", "repo": "web" | "api" }
```

`repo` defaults to `"web"` if omitted (frontend currently only targets the web repo).
`githubUsername` is resolved from `user.githubUsername` (set via GitHub OAuth link flow). Claim is rejected with 400 if the account is not linked.

Rate-limited 1 req/min per user (Redis). Checks GitHub API with `GITHUB_API_TOKEN` to avoid rate limits. Paginates stargazers/forks 100/page.

---

## Promo Codes

Redemption uses a DB transaction (QueryRunner) to atomically create the redemption record and increment `usedCount`, preventing race-condition double-spend.

Expiry is checked at redemption time (real-time) AND via daily cron that marks `isActive = false`.

---

## Cron Jobs

| Schedule | Vercel | Docker/local | What |
|---|---|---|---|
| `0 0 * * *` | ✅ (daily, Hobby-compatible) | `node-cron` | Expire promo codes past their `expiresAt` |
| `0 0 * * 0` | ✅ (weekly) | `node-cron` | Restore credits to weekly floor |

---

## Development

```bash
npm install
npm run dev
npm run build
npm run migration:run
npm run migration:revert
```

See `.env.example` for required environment variables. New vars added for growth system:

```env
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_API_TOKEN=
GITHUB_REPO_OWNER=joaorjoaquim
GITHUB_REPO_NAME_WEB=video-insight-web
GITHUB_REPO_NAME_API=video-insight-api
CRON_SECRET=
WEEKLY_CREDIT_FLOOR=100
```

---

## Known Bugs

### ✅ Fixed: Emoji corruption from missing UTF-8 charset header
**File:** `src/server.ts` line ~52  
**Issue:** Fastify omits `; charset=utf-8` from `Content-Type: application/json`. Clients misinterpret multi-byte emoji bytes as Latin-1, causing corruption.  
**Fix:** Added `onSend` hook in `server.ts` after `rateLimit` registration that injects `charset=utf-8` on all JSON responses.

### ✅ Fixed: Credit estimation is hardcoded at 5
**File:** `src/services/video-pipeline.service.ts` line ~36  
**Issue:** `const estimatedCredits = 5` — all videos cost 5 credits regardless of duration. CLAUDE.md documents 5 (short) / 8 (medium) / 12–15 (long). Long videos are underpriced; short videos may be overpriced.  
**Fix:** Added `estimateCreditsFromDuration()` helper function that computes credits dynamically: <10 min = 5, 10–30 min = 8, >30 min = 12. Replaces hardcoded line with call to helper. Duration is unavailable at submission time, so defaults to 5 credits initially; will be recalculated after transcription completes.

### ✅ Fixed: GitHub claim allows arbitrary username override
**File:** `src/controllers/github-claim.controller.ts`  
**Issue:** The `githubUsername` field in the request body could be any string — it was not validated against `user.githubUsername` (set during GitHub OAuth). A user who authenticated via GitHub could supply a different username and claim credits for another account's star/fork.  
**Fix:** Removed `githubUsername` from the request body validation. Now uses only `user.githubUsername` (from OAuth); if not linked, returns a clear error directing users to link their account first.

### ✅ Fixed: Referral transactions use `ADMIN_GRANT` type
**File:** `src/services/video-pipeline.service.ts` lines ~513–545  
**Issue:** Referral rewards are credited via `grantCreditsInternal()` with `type: ADMIN_GRANT`, making them indistinguishable from admin manual grants in the transaction ledger.  
**Fix:** Added `REFERRAL_REWARD = 'referral_reward'` to the `TransactionType` enum in `CreditTransaction.ts`. Updated `grantCreditsInternal()` in `credit.service.ts` to accept an optional `type` parameter with default value `ADMIN_GRANT` for backward compatibility. Updated both `triggerReferralRewardIfEligible()` in `video-pipeline.service.ts` (line ~543) and the signup referral bonus in `auth.controller.ts` (line ~45) to pass `TransactionType.REFERRAL_REWARD` when granting referral credits.

### ✅ Fixed: No dedicated rate limit on promo code redeem
**File:** `src/routes/credit.routes.ts` lines ~42–63  
**Issue:** `POST /credits/redeem` only benefits from the global rate limit (100 req/min per IP). Targeted brute-force of short promo codes is feasible if done from multiple IPs.  
**Fix:** Added `config: { rateLimit: { max: 5, timeWindow: '1 hour' } }` on the route, keyed by `userId`.

### ✅ Fixed: Email format not validated at signup/login
**File:** `src/server.ts` lines ~7, ~31–32  
**Issue:** TypeBox schema accepts any non-empty string as `email`. Malformed addresses are stored in the database.  
**Fix:** Imported `ajv-formats` and registered it as the first AJV plugin in the Fastify config. Now the `format: 'email'` keyword in `auth.schema.ts` is properly validated by AJV.

---

## Known Gaps / Future Work

- **GitHub OAuth button missing in frontend** — API supports `GET /auth/oauth/github` but AuthDialog in the web app has no GitHub button. Users can only link GitHub via the claim form (manual username entry).
- **Frontend only claims web repo** — wallet UI has no way to claim credits for the API repo. API supports `repo: "api"` but frontend always omits `repo` (defaults to `"web"`).
- **Payment integration** — wallet "Buy Credits" dialog is UI-only; no payment processor is wired (Stripe, etc.).
- **Admin UI** — promo code management is API-only (no dashboard).
- **No WebSocket / real-time push** — video status updates require client polling (`GET /video/:id/status` every 10s).
- **Low test coverage** — only `__tests__/video.test.ts` exists. Auth, credits, promo, referral, and GitHub claim flows have zero test coverage.
