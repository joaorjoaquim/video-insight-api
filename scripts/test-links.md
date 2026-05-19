# Pipeline validation matrix

Replace URLs with stable public videos before running `npm run validate:pipeline`.

| ID | Platform | Type | Notes |
|----|----------|------|-------|
| T1 | YouTube | Short < 60s, PT | Primary happy path |
| T2 | YouTube | Long 30min+ | Async Supadata job / long poll |
| T3 | TikTok | Public reel | Supadata fallback |
| T4 | Instagram | Public reel | Supadata fallback |
| T5 | YouTube | Private/unlisted | Expect `VIDEO_INACCESSIBLE` |

Example placeholders (update before live runs):

- T1: `https://www.youtube.com/watch?v=jNQXAC9IVRw`
- T3: public TikTok URL
- T4: public Instagram reel URL
