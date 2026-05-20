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
├── server.ts                       # Fastify app setup, plugins registration
├── api/index.ts                    # Vercel serverless handler
├── local.ts                        # Local dev entry point
├── config/
│   ├── db.config.ts                # TypeORM PostgreSQL (read/write replicas, pooling)
│   ├── redis.config.ts             # Redis/Upstash
│   ├── aws.config.ts               # AWS S3 (audio storage)
│   └── logger.ts                   # Pino logger
├── entities/
│   ├── User.ts                     # id, email, password?, credits, name, avatarUrl, provider, providerId
│   ├── Video.ts                    # id, url, status, summary, transcript, insights, mindMap, duration
│   ├── CreditTransaction.ts        # amount, type, status, referenceId, referenceType, tokensUsed
│   └── VideoProcessingLog.ts       # Processing audit trail
├── repositories/                   # TypeORM data access layer
├── services/
│   ├── user.service.ts             # User CRUD, OAuth user creation/update
│   ├── credit.service.ts           # Grant/deduct/refund, transaction history
│   ├── oauth.service.ts            # Google + Discord OAuth flows
│   ├── video.service.ts            # Video CRUD, status management
│   ├── video-pipeline.service.ts   # Orchestrate download → transcribe → analyze
│   └── video-ai.service.ts         # OpenAI integration
├── controllers/                    # Request handlers
├── routes/
│   └── index.ts                    # Route aggregator (all routes registered here)
├── schemas/                        # TypeBox request/response validation
├── plugins/
│   ├── auth.ts                     # JWT verification middleware
│   └── errorHandler.ts
└── migrations/                     # TypeORM migrations
```

---

## Existing Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/signup` | — | Register email/password → `{ user, token }` |
| POST | `/auth/login` | — | Login → `{ user, token }` |
| GET | `/auth/oauth/:provider` | — | Redirect to OAuth (google \| discord) |
| GET | `/auth/callback/:provider` | — | OAuth callback, redirects with token |
| GET | `/user/profile` | JWT | Current user data |
| GET | `/user/:id` | — | Get user by ID |
| POST | `/video` | JWT | Submit video URL for processing |
| GET | `/video` | JWT | List user's videos |
| GET | `/video/:id` | JWT | Get video details |
| GET | `/video/:id/status` | JWT | Poll processing status |
| GET | `/credits` | JWT | Balance + transaction history (limit, offset) |
| POST | `/credits/admin/grant` | X-Admin-Hash | Grant credits to user |
| POST | `/credits/admin/deduct` | X-Admin-Hash | Deduct credits from user |

---

## Auth

JWT expiry: 15 days. Token returned on signup/login/OAuth callback.

OAuth providers: `google`, `discord` (defined in `oauth.service.ts`). Adding `github` requires extending this service and adding `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` env vars.

---

## Credit System

- Default credits on signup: 100
- Credit cost: ~5 (short video), ~8 (medium), ~12–15 (long)
- `CreditTransaction.type`: `PURCHASE | SPEND | REFUND | ADMIN_GRANT | ADMIN_DEDUCT`
- `CreditTransaction.status`: `PENDING | COMPLETED | FAILED | CANCELLED`

---

## Development

```bash
npm install
npm run dev
npm run build
npm run migration:run
npm run migration:revert
```

See `.env.example` for required environment variables.

---

## Pending Features — Growth System

> **Status:** Frontend UI shells are already built in `video-insight-web/src/app/(private)/wallet/page.tsx`. These endpoints must be implemented before the frontend becomes functional. Once live, no frontend changes are needed.

---

### Feature 1: GitHub OAuth + Star/Fork Credit Claiming

**Goal:** Users connect GitHub (OAuth or manual username), claim credits for starring/forking the open-source repo. One-time per action per user.

#### 1a. Add GitHub OAuth provider

**File:** `src/services/oauth.service.ts`

- Add `github` to provider validation (currently `google | discord`)
- GitHub OAuth App credentials: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (add to `.env.example`)
- Authorization URL: `https://github.com/login/oauth/authorize?client_id=...&scope=read:user,user:email`
- Token exchange: `POST https://github.com/login/oauth/access_token`
- User info: `GET https://api.github.com/user` → returns `id`, `login`, `name`, `avatar_url`, `email`
- Store `provider: 'github'`, `providerId: String(githubId)` on User

#### 1b. New User entity fields

**File:** `src/entities/User.ts`

```typescript
@Column({ nullable: true })
githubUsername: string | null;

@Column({ nullable: true })
githubId: string | null;

@Column({ default: false })
githubStarClaimed: boolean;

@Column({ default: false })
githubForkClaimed: boolean;
```

Create a migration after adding these fields.

#### 1c. New endpoint: `POST /credits/claim/github`

**Auth:** JWT required

**Request body:**
```json
{ "githubUsername": "joaorjoaquim", "action": "star" }
```
`action`: `"star"` (awards 5 credits) | `"fork"` (awards 10 credits)

**Logic:**
1. If user has `githubUsername` stored, use it. Otherwise use body value.
2. Call GitHub API (authenticated with `GITHUB_API_TOKEN` to avoid rate limits):
   - Star: paginate `GET https://api.github.com/repos/{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}/stargazers` — check if `login` matches.
   - Fork: `GET https://api.github.com/repos/{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}/forks` — check if `owner.login` matches.
3. If not found → `404 { message: "GitHub username has not starred/forked the repository" }`.
4. Check `githubStarClaimed` / `githubForkClaimed` on user — if already claimed → `409`.
5. Grant credits: `credit.service.grantCredits(...)` with `type: ADMIN_GRANT`, `description: "GitHub star reward"`.
6. Update user: set `githubStarClaimed = true` (or `githubForkClaimed`).
7. Response: `{ credits: number, coinsAdded: number, message: string }`.

**Security:** Rate-limit 1 req/min per user. Use `GITHUB_API_TOKEN` for all GitHub API calls.

**Error responses:** `400` bad action | `404` not found | `409` already claimed

**New env vars:**
```env
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_API_TOKEN=
GITHUB_REPO_OWNER=joaorjoaquim
GITHUB_REPO_NAME=video-insight-web
```

---

### Feature 2: Referral System

**Goal:** Each user has a unique referral code. New signups via `?ref=CODE` earn 10 bonus credits. Referrer earns 5 credits when the referee completes their first video.

#### 2a. New User entity fields

**File:** `src/entities/User.ts`

```typescript
@Column({ unique: true, nullable: true })
referralCode: string | null;        // auto-generated on user creation (8-char hex)

@Column({ nullable: true })
referredByCode: string | null;      // code used at signup

@Column({ default: false })
referralRewardGranted: boolean;     // true after referrer was credited (idempotency)

@Column({ default: 0 })
referralCreditsEarned: number;      // total credits earned from referrals
```

Auto-generate `referralCode` in `user.service.createUser()`:
```typescript
import { randomBytes } from 'crypto';
referralCode: randomBytes(4).toString('hex'); // e.g. "a3f8c21b"
```

Also generate for existing users via migration or on-demand in `GET /user/referral`.

#### 2b. Modify `POST /auth/signup`

Accept optional `referralCode` in body:
```json
{ "email": "...", "password": "...", "referralCode": "a3f8c21b" }
```

On signup:
1. If `referralCode` provided, look up user by `referralCode`.
2. If found: store `referredByCode` on new user, grant new user 10 bonus credits (`ADMIN_GRANT`, description: `"Referral signup bonus"`).
3. If not found: ignore silently (do not fail signup).

#### 2c. Trigger referrer credit on first completed video

**File:** `src/services/video-pipeline.service.ts` (where video reaches `completed`)

When video reaches `completed`:
1. Count user's total completed videos.
2. If this is the first completed video AND `user.referredByCode` is set AND `user.referralRewardGranted === false`:
   - Find referrer by `referralCode = user.referredByCode`.
   - Grant referrer 5 credits (`ADMIN_GRANT`, description: `"Referral reward — ${user.email}"`).
   - Set `user.referralRewardGranted = true`, increment `referrer.referralCreditsEarned += 5`.
   - Save both users.

#### 2d. New endpoint: `GET /user/referral`

**Auth:** JWT required

**Logic:** Auto-generate `referralCode` if user doesn't have one yet.

**Response:**
```json
{
  "referralCode": "a3f8c21b",
  "referralUrl": "https://summaryvideos.com/?ref=a3f8c21b",
  "referralsCount": 3,
  "creditsEarned": 15
}
```

`referralsCount`: count of users where `referredByCode = user.referralCode`
`creditsEarned`: `user.referralCreditsEarned`

---

### Feature 3: Promo Code System

**Goal:** Admin creates credit codes for marketing campaigns. Users redeem them once for credits.

#### 3a. New entity: `src/entities/PromoCode.ts`

```typescript
@Entity('promo_codes')
export class PromoCodeEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  code: string;                 // stored as uppercase

  @Column()
  credits: number;              // credits awarded on redemption

  @Column({ nullable: true })
  maxUses: number | null;       // null = unlimited

  @Column({ default: 0 })
  usedCount: number;

  @Column({ nullable: true })
  expiresAt: Date | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true })
  description: string | null;   // internal label

  @CreateDateColumn()
  createdAt: Date;
}
```

#### 3b. New entity: `src/entities/PromoCodeRedemption.ts`

```typescript
@Entity('promo_code_redemptions')
export class PromoCodeRedemptionEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  promoCodeId: number;

  @Column()
  userId: number;

  @CreateDateColumn()
  redeemedAt: Date;
}
```

Add unique constraint on `(userId, promoCodeId)` — one redemption per user per code.

#### 3c. New endpoint: `POST /credits/redeem` (user)

**Auth:** JWT required

**Request body:** `{ "code": "LAUNCH50" }`

**Logic:**
1. Normalize: `code.trim().toUpperCase()`
2. Find `PromoCodeEntity` by code → `400` if not found.
3. Validate: `isActive === true` → `400`; `expiresAt` not passed → `400`; `usedCount < maxUses` (or unlimited) → `400`.
4. Check `PromoCodeRedemptionEntity` for `(userId, promoCodeId)` → `409` if exists.
5. Wrap in DB transaction:
   - Create `PromoCodeRedemptionEntity`.
   - Increment `promo.usedCount`.
   - Grant credits: `credit.service`, `type: PURCHASE`, `description: "Promo code: ${code}"`, `referenceType: 'promo_code'`, `referenceId: code`.
6. Response: `{ credits: number, coinsAdded: number, message: string }`.

**Error responses:** `400` invalid/expired/exhausted | `409` already redeemed

#### 3d. New endpoint: `POST /credits/admin/promo` (admin)

**Auth:** `X-Admin-Hash` header

**Request body:**
```json
{
  "code": "LAUNCH50",
  "credits": 25,
  "maxUses": 500,
  "expiresAt": "2026-12-31T23:59:59Z",
  "description": "Product Hunt launch"
}
```

**Response:** `{ promoCode: PromoCodeEntity }`

#### 3e. New endpoint: `GET /credits/admin/promos` (admin)

**Auth:** `X-Admin-Hash` header

**Response:** `{ promoCodes: PromoCodeEntity[], total: number }`

---

## Frontend Integration Map

All endpoints below are called from `video-insight-web/src/app/(private)/wallet/page.tsx` and `src/lib/api/authApi.ts`. The frontend sends the requests — they 404 until implemented here.

| Frontend action | Endpoint | Notes |
|---|---|---|
| Claim GitHub star | `POST /credits/claim/github` `{ action: "star" }` | Feature 1 |
| Claim GitHub fork | `POST /credits/claim/github` `{ action: "fork" }` | Feature 1 |
| Redeem promo code | `POST /credits/redeem` `{ code }` | Feature 3 |
| Get referral info | `GET /user/referral` | Feature 2 |
| Signup with referral | `POST /auth/signup` body `+ referralCode` | Feature 2 |
| GitHub OAuth | `GET /auth/oauth/github` | Feature 1a |

After implementing, run `npm run migration:run` to apply the new entity columns.
