-- Data store D1: Users
-- Matches the composition from the data dictionary:
-- user_id + name + email + password_hash + created_at + session_token

CREATE TABLE IF NOT EXISTS users (
  user_id        SERIAL PRIMARY KEY,
  name           VARCHAR(50)  NOT NULL,
  email          VARCHAR(100) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  session_token  VARCHAR(512),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Fast lookups by email, since P1 (Login) queries by email on every sign-in
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);


-- A "room" is one trip a group plans together. Everything that comes next
-- (pins, votes, chat, itinerary) will belong to a room, not just a user.
CREATE TABLE IF NOT EXISTS rooms (
  room_id     SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  join_code   VARCHAR(8)   NOT NULL UNIQUE,
  created_by  INTEGER      NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rooms_join_code ON rooms (join_code);

-- Which members belong to which rooms (many-to-many: a room has many
-- members, a member can belong to many rooms/trips over time).
CREATE TABLE IF NOT EXISTS room_members (
  room_id    INTEGER     NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  user_id    INTEGER     NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);


-- Data store D2: Pin votes (split into two normalized tables: a pin's own
-- details, and one row per vote cast on it — the DFD's single "D2 Pin votes"
-- store is the logical grouping of both).
CREATE TABLE IF NOT EXISTS pins (
  pin_id       SERIAL PRIMARY KEY,
  room_id      INTEGER      NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  name         VARCHAR(100) NOT NULL,
  category     VARCHAR(20)  NOT NULL CHECK (category IN ('food', 'hotel', 'attraction')),
  latitude     DECIMAL(9,6) NOT NULL,
  longitude    DECIMAL(9,6) NOT NULL,
  description  TEXT,
  created_by   INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pins_room ON pins (room_id);

CREATE TABLE IF NOT EXISTS votes (
  pin_id     INTEGER     NOT NULL REFERENCES pins(pin_id) ON DELETE CASCADE,
  user_id    INTEGER     NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pin_id, user_id)
);


-- Data store D3: Chat log
CREATE TABLE IF NOT EXISTS messages (
  message_id    SERIAL PRIMARY KEY,
  room_id       INTEGER      NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  user_id       INTEGER      NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  message_text  VARCHAR(500) NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Loading the last N messages for a room, in order, is the main query shape
CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages (room_id, created_at);


-- Data store D4: Itinerary
-- stop_order is fractional (NUMERIC, not INTEGER) so a drag-and-drop move
-- only ever needs to write the ONE row being moved — its new position is
-- the midpoint between its new neighbors, never a renumbering of the rest.
-- UNIQUE(room_id, pin_id) means a pin has at most one stop in the whole
-- room's itinerary at a time; moving it to a new day/position is an UPSERT.
CREATE TABLE IF NOT EXISTS itinerary_stops (
  stop_id     SERIAL PRIMARY KEY,
  room_id     INTEGER     NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  pin_id      INTEGER     NOT NULL REFERENCES pins(pin_id) ON DELETE CASCADE,
  day_number  INTEGER     NOT NULL CHECK (day_number >= 1),
  stop_order  NUMERIC     NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, pin_id)
);

CREATE INDEX IF NOT EXISTS idx_itinerary_room_day ON itinerary_stops (room_id, day_number, stop_order);

-- Day-level summary produced by P5 (Optimize) — completes D4 Itinerary's
-- distance_km/duration_min fields from the original data dictionary, which
-- weren't built until now. A row only exists for a day once it's been
-- optimized. Adding, removing, or moving a stop deletes the row for any
-- day it touches (see routes/itinerary.js), so a distance/time shown here
-- is always accurate for that day's *current* stop list, never stale.
CREATE TABLE IF NOT EXISTS itinerary_days (
  room_id      INTEGER     NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  day_number   INTEGER     NOT NULL CHECK (day_number >= 1),
  distance_km  NUMERIC     NOT NULL,
  duration_min INTEGER     NOT NULL,
  optimized_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, day_number)
);
