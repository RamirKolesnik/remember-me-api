# remember.me — API

Backend of remember.me: frames on a 1000×1000 wall, holds while a buyer pays, payment webhooks and reports.

## Stack

- Node.js 22 running TypeScript directly (type stripping, no build step), Fastify 5
- PostgreSQL 16: a `cells` table with a `(x, y)` primary key makes selling one cell twice impossible; holds and expiry are SQL functions in `db/migrations/001_init.sql`
- Wall rules (zones, prices, the heart, link check): `src/domain/wall.ts`, identical to the web repo's copy

## Endpoints

| Method | Path | |
|---|---|---|
| GET | `/health` | liveness + DB |
| GET | `/wall/stats` | frames and cells left |
| GET | `/wall/frames?x0&y0&x1&y1` | active frames in a window (≤ 500×500) |
| GET | `/wall/recent?limit` | the newest active frames, newest first (default 12, up to 30); for the "Just immortalized" feed, shared for 3 s |
| GET | `/price?x&y` | price of the 1×1 frame on that cell (`priceCents`, `priceUsd`) and zone, or a placement error |
| POST | `/reservations` | hold a spot for 15 min and get a checkout link |
| POST | `/webhooks/payments` | payment provider callback: hold → frame |
| GET | `/frames/:id` | one active frame, with its `number` and `storyUrl` |
| GET | `/frames/by-number/:number` | the same, found by the number on its story card (`#4812` → `4812`) |
| GET | `/frames/:id/story.jpg` | the frame's 9:16 story card (1080×1920 JPEG) |
| POST | `/frames/:id/reports` | report a frame |

Not wired yet: photo upload and moderation, the captcha provider, the payment provider. Until a payment provider is configured, `POST /reservations` answers `503 payments_unavailable`.

## The heart

The heart is the 4×4 block at the center (cells 498–501). It is not sold on the site: `POST /reservations` refuses any spot that touches it (`heart_not_for_sale`), and the database enforces the same rule (`frames_off_heart` in `db/migrations/004_heart_4x4.sql`). The deal is closed in person, from $10,000.

To put the owner on the wall, upload their photo with `POST /photos` (it returns a `photoKey`), then run in the database:

```sql
select place_heart('Owner name', 'Their note', '<photoKey>', 12000, 'deal-001');
-- name, note, photo key (or null), price paid in whole USD (stored in cents), your reference for the deal
```

The frame goes live at once and gets its number and story card like any other. A second call raises `heart_sold`.

## Story cards

Every frame that goes live gets a number (`I'm #4,812 on the wall. Forever.`), handed out by a trigger in `db/migrations/003_frame_numbers_and_stories.sql` in the order frames are activated.

`src/domain/story.ts` draws the 9:16 card with sharp: the photo (or initials), name, caption, cell and zone. The heart has its own dark template. Text is set with the bundled Inter font (`assets/fonts`, SIL OFL), so cards look the same on every server.

After a payment the server renders the card in the background and keeps it in `frame_stories`. A card that isn't ready yet is rendered when someone asks for it. The queue is the database (paid frames with no card), so a restart loses nothing; it moves to BullMQ with Redis, and the pictures to object storage, before launch. `STORY_SITE_LABEL` sets the site name printed on the card (default: `FRONTEND_URL` without the scheme).

## Run locally

```bash
docker compose up            # Postgres + API on :8080
# or, with your own Postgres:
npm install
DATABASE_URL=postgres://... npm start   # applies migrations, then serves
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test
```

CI (`.github/workflows/ci.yml`) typechecks, runs the tests against Postgres, boots the server and builds the Docker image.

After a green push to `main`, CI redeploys the test API on Render through a deploy hook. Put the hook URL (Render → the service → Settings → Deploy Hook) in the repository secret `RENDER_DEPLOY_HOOK_URL`; without it the deploy step only warns.
