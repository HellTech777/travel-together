# Travel Together

Working slices so far: accounts (sign up / sign in), rooms (create or join a
trip by code), a shared map with pins and voting, real-time chat, and a
drag-and-drop itinerary with route optimization — all wired end-to-end
(React → Express + Socket.io → PostgreSQL), following the Level 1 DFD and
data dictionary.

## Prerequisites
- Node.js 18+
- A PostgreSQL database — local, or a free one from Railway, Render, or Supabase

## If you're upgrading from an earlier version of this project
Re-run the schema (it's additive — safe to run again) and reinstall both
sides if either `package.json` changed since your last pull:
```bash
psql travel_together -f server/db/schema.sql   # adds any new tables only
cd server && npm install
cd ../client && npm install
```

## 1. Set up the database
Create a database, then run the schema against it:

```bash
createdb travel_together
psql travel_together -f server/db/schema.sql
```

(If you're using a hosted Postgres instance instead, just point `psql` at its
connection string rather than a local database name.)

## 2. Set up the server
```bash
cd server
cp .env.example .env
```
Open `.env` and set:
- `DATABASE_URL` — your Postgres connection string
- `JWT_SECRET` — any long random string (used to sign session tokens)

Then:
```bash
npm install
npm run dev
```
The API runs on `http://localhost:4000`.

## 3. Set up the client
```bash
cd client
cp .env.example .env
npm install
npm run dev
```
Open `http://localhost:5173` — you'll land on the sign-in page.

## Deploying to Render (one web service + one database)

In production the server also serves the built React app, so the whole project
runs as a **single** Render web service plus a Render Postgres database. One
address for everything means the sign-in cookie just works (no cross-site cookie
problems) and there is no CORS to configure.

1. **Database** — Render dashboard → **New → PostgreSQL**. Note its region. When
   it's ready, copy its **Internal Database URL**.
2. **Web service** — **New → Web Service**, connect your GitHub repo, and pick
   the **same region** as the database.

   | Setting | Value |
   |---|---|
   | Language | Node |
   | Root Directory | leave blank (or the folder that contains `client/` and `server/`) |
   | Build Command | `npm run build` |
   | Start Command | `npm start` |
   | Health Check Path (optional) | `/api/health` |

3. **Environment variables** (Environment tab of the web service):
   - `DATABASE_URL` — the Internal Database URL from step 1
   - `JWT_SECRET` — a long random string; generate one with
     `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

   Render sets `PORT` and `NODE_ENV=production` itself, and `CLIENT_URL` isn't
   needed because the app and the API share one address.
4. **Deploy.** `npm run build` installs both sides and builds the client;
   `npm start` first runs `server/db/schema.sql` against the database (every
   statement is `IF NOT EXISTS`, so repeating it on each start is harmless and
   keeps existing data), then boots the server. There's no manual `psql` step.

Things to know on the free plans: a free web service sleeps after 15 minutes
without traffic and takes about a minute to wake on the next visit, and a free
Postgres database expires 30 days after it's created (Render gives a 14-day
grace period to upgrade). Render recommends the **Internal** Database URL for
anything running on Render; the External one is for connecting from your own
computer. If you ever use a public database URL that doesn't already end in
`?sslmode=require`, add `DATABASE_SSL=true` as well.

To try the same single-server setup locally: from the project root run
`npm run build`, then `cd server && npm start`, and open `http://localhost:4000`.

## What's implemented

**Accounts**
- `POST /api/auth/register` — validates input, rejects a duplicate email, hashes
  the password with bcrypt, creates the user, and signs them in.
- `POST /api/auth/login` — looks up the user by email, compares the password
  hash, and issues a session. This matches the login flowchart exactly: one
  `SELECT` to check credentials, one `UPDATE` to store the new session token.
- `POST /api/auth/logout` — clears the session.
- `GET /api/auth/me` — returns the signed-in user; used to keep someone logged
  in across page refreshes.

**Rooms** (a "room" is one trip a group plans together — everything after
this belongs to a room, not just a user)
- `POST /api/rooms` — creates a room with a random 6-character join code and
  makes the creator its first member.
- `POST /api/rooms/join` — looks up a room by its join code and adds the
  signed-in member to it.
- `GET /api/rooms/mine` — lists every room the signed-in member belongs to.
- `GET /api/rooms/:roomId` — one room's details, only returned if the member
  actually belongs to it (this doubles as the access check for the room
  board).

**Pins & votes** (nested under a room; every route below checks the
signed-in member actually belongs to that room first)
- `GET /api/rooms/:roomId/pins` — every pin in the room, each with its live
  vote count and whether you've voted for it.
- `POST /api/rooms/:roomId/pins` — pins a new place (name, category,
  description, location).
- `POST /api/rooms/:roomId/pins/:pinId/vote` — toggles your vote: casts it
  if you hadn't voted, retracts it if you had.

**Chat** (real-time via Socket.io, history via REST)
- `GET /api/rooms/:roomId/messages` — the last 50 messages in the room,
  oldest first, with each sender's name already joined in.
- Socket event `join_room` (client emits `roomId`) — verifies membership and
  moves the connection into that room's channel; re-emitted automatically
  after any reconnect.
- Socket event `send_message` (client emits `{ roomId, text }`) — saves the
  message to D3 Chat log and broadcasts `new_message` to everyone in the
  room, including the sender.
- Socket event `typing` (client emits `{ roomId }`) — broadcasts
  `user_typing` to everyone else in the room for a lightweight "so-and-so is
  typing…" indicator. Nothing here is persisted.

The Socket.io connection authenticates itself with the exact same session
cookie as the REST API — there's no separate login step for chat. A shared
`verifySessionToken` helper (`server/auth/verifySession.js`) does the actual
check so the logic can't drift between the two.

**Itinerary** (drag voted pins into a day-by-day plan)
- `GET /api/rooms/:roomId/itinerary` — every scheduled stop across all days,
  with pin details already joined in.
- `PUT /api/rooms/:roomId/itinerary/stops/:pinId` — places a pin at
  `{ dayNumber, beforePinId }`. The same endpoint handles three cases:
  scheduling a pin for the first time, reordering it within a day, and
  moving it to a different day — all via one `UPSERT` keyed on
  `(room_id, pin_id)`, since a pin can only have one stop at a time.
- `DELETE /api/rooms/:roomId/itinerary/stops/:pinId` — unschedules a pin (it
  stays on the map and in the vote list, just not on any day).

**Why `stop_order` is a decimal, not an integer:** moving a pin between two
existing stops sets its order to the midpoint of its new neighbors (e.g.
between `1` and `2` → `1.5`). That means placing or reordering a stop is
always a single-row write — nothing else in that day ever needs to be
renumbered, which matters once several people can be dragging things around
in the same room at once.

**Route optimization** (P5 — completes D4 Itinerary)
- `POST /api/rooms/:roomId/itinerary/days/:dayNumber/optimize` — reorders
  that day's stops with a nearest-neighbor pass (starting from a hotel stop
  if the day has one), estimates total distance and walking time, and
  stores both.

**Keeping distance/time honest:** a day's stored distance/duration is
deleted the moment any stop in that day is added, removed, moved, or
reordered — so if the summary bar shows a number, it's guaranteed to
describe the day's *current* stop list, never a stale one from before the
last edit. If it's been invalidated, the bar just says "not yet optimized"
until someone clicks the button again.

After signing in, a member lands on **Create a room / Join a room**. Creating
one drops them straight into that room; joining one takes a code a
roommate shares with them. Inside a room: click the map to drop a pin, vote
on it, chat about it, drag it into a day, then hit **Optimize route** once
a day has 2+ stops to get a suggested order and an estimated distance/time.

**A note on the map itself:** there's no Google Maps/Places integration —
this was tried and deliberately rolled back (see below) — so "the map" is a
plain grid and a click just records where on that grid you clicked (stored
in the same `latitude`/`longitude` columns real coordinates would use if
that ever changes). Distance/duration estimates use a placeholder scale on
top of that grid, so treat them as illustrative, not real walking times.
Pins, votes, and the itinerary are still polled every 5 seconds; only chat
is push-based so far.

## Project layout
```
package.json                     Root scripts for deployment: `build` and `start` (see "Deploying to Render")
server/
  index.js                     HTTP server + Express app + Socket.io, route mounting; also serves client/dist when it exists
  db/schema.sql                 Creates users, rooms, room_members, pins, votes, messages, itinerary_stops, itinerary_days
  db/init.js                     Applies schema.sql (npm run db:init) — safe to repeat; runs automatically on `npm start` in production
  db/pool.js                     PostgreSQL connection pool
  auth/verifySession.js          Shared session check (HTTP cookie + socket handshake)
  routes/auth.js                 register / login / logout / me
  routes/rooms.js                 create / join / mine / :roomId
  routes/pins.js                  list / create pins, toggle votes
  routes/messages.js              chat history
  routes/itinerary.js             list / place (upsert) / remove stops, optimize a day
  sockets/chat.js                 join_room / send_message / typing
  middleware/requireAuth.js       Verifies the session cookie on protected routes
  middleware/requireRoomMembership.js   Confirms access to a specific room
client/
  src/socket.js                   Shared Socket.io client connection
  src/categoryMeta.js             Pin category labels/colors, shared by the map and itinerary
  src/pages/Login.jsx
  src/pages/Register.jsx
  src/pages/RoomChooser.jsx       Create a room or join one by code
  src/pages/RoomBoard.jsx         Room header + chat + map + itinerary layout
  src/components/PinBoard.jsx     The shared map, pin form, and voting UI
  src/components/ChatPanel.jsx    Real-time chat, backed by the socket
  src/components/ItineraryBoard.jsx   Day tabs, drag-and-drop scheduling, route optimization
  src/App.jsx                     Routing + auth state
  src/api.js                      Fetch wrapper for the backend
```

## A note on the original data dictionary
Rooms and room members weren't in the Level 1 DFD or data dictionary from
earlier — that version assumed one shared trip for everyone. This is a real
change to the data model (two new stores: **Rooms** and **Room members**),
so if you want, I can redraw the DFD and update the dictionary to match.
Separately, **D2 Pin votes** is implemented as two related tables (`pins`
and `votes`) rather than one, and **D3 Chat log** gained a `room_id` column
— both normal refinements from a logical DFD store into physical tables,
not changes to what the diagram says. **D4 Itinerary** is now fully built
as originally specified: `itinerary_stops` covers `day_number + {pin_id +
stop_order}`, and the `itinerary_days` table covers the
`distance_km`/`duration_min` fields that were always part of the
dictionary's definition of D4.

## On the Google Maps detour
A real Google Maps + Places integration was built and then rolled back in
the same session — worth recording why, since the reasoning still applies
if this comes up again later. It worked (real search, real coordinates,
real markers via `@vis.gl/react-google-maps`), and it was genuinely free
for this project's scale. But it added a real setup tax before the app
would even run: a Google Cloud project, two enabled APIs, a restricted key,
and a billing account on file — friction that doesn't pay for itself at
this stage, when the placeholder grid already exercises every actual
feature (pinning, voting, dragging into an itinerary, optimizing a route)
just as well. Revisiting it is still on the table later — closer to
shipping, when a setup step happens once rather than every time someone
new pulls the project.

## What's left
All five processes from the original Level 1 DFD are built (P1
Login/Register, P2 Vote, P3 Chat, P4 Plan, P5 Optimize). Natural next
steps, roughly in order of how much value they'd add: moving pins/votes/
itinerary from polling onto the same Socket.io connection chat already
uses so every feature updates instantly instead of within 5 seconds,
drawing the optimized route as a line on the map, and — if it's ever worth
the setup cost again — real Google Maps. Say the word on any of these
whenever you're ready.
