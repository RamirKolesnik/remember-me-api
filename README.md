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
| GET | `/price?x&y&size` | price and zone, or a placement error |
| POST | `/reservations` | hold a spot for 15 min and get a checkout link |
| POST | `/webhooks/payments` | payment provider callback: hold → frame |
| GET | `/frames/:id` | one active frame, with its `number` and `storyUrl` |
| GET | `/frames/:id/story.jpg` | the frame's 9:16 story card (1080×1920 JPEG) |
| POST | `/frames/:id/reports` | report a frame |

Not wired yet: photo upload and moderation, the captcha provider, the payment provider. Until a payment provider is configured, `POST /reservations` answers `503 payments_unavailable`.

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
