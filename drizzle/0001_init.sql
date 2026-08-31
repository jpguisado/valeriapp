-- Valeriapp initial schema.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SEQUENCE IF NOT EXISTS events_server_seq;

CREATE TABLE households (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  timezone_mode text NOT NULL DEFAULT 'device',
  timezone      text NOT NULL DEFAULT 'Europe/Madrid',
  backup_email  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  username      text NOT NULL,
  password_hash text NOT NULL,
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_key ON users (lower(username));

CREATE TABLE sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX sessions_token_key ON sessions (token_hash);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  code         text NOT NULL,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  used_by      uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX invites_code_key ON invites (code);

CREATE TABLE babies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name         text NOT NULL,
  birth_date   date NOT NULL,
  archived     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX babies_household_idx ON babies (household_id);

CREATE TABLE events (
  id           uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  baby_id      uuid NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
  type         text NOT NULL,
  occurred_at  timestamptz NOT NULL,
  ended_at     timestamptz,
  tz           text NOT NULL,
  running      boolean NOT NULL DEFAULT false,
  estimated    boolean NOT NULL DEFAULT false,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  note         text,
  created_by   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL,
  deleted_at   timestamptz,
  received_at  timestamptz NOT NULL DEFAULT now(),
  server_seq   bigint NOT NULL DEFAULT nextval('events_server_seq')
);
CREATE INDEX events_household_seq_idx ON events (household_id, server_seq);
CREATE INDEX events_baby_occurred_idx ON events (baby_id, occurred_at DESC);
CREATE INDEX events_running_idx ON events (household_id, running) WHERE running;

CREATE TABLE event_revisions (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  action   text NOT NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  at       timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL
);
CREATE INDEX event_revisions_event_idx ON event_revisions (event_id, at DESC);

CREATE TABLE reminder_settings (
  baby_id          uuid NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
  type             text NOT NULL,
  enabled          boolean NOT NULL DEFAULT false,
  threshold_minutes integer NOT NULL DEFAULT 0,
  at_time          text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (baby_id, type)
);

CREATE TABLE reminder_state (
  baby_id     uuid NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
  type        text NOT NULL,
  trigger_key text NOT NULL,
  fired_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (baby_id, type)
);

CREATE TABLE push_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint      text NOT NULL,
  p256dh        text NOT NULL,
  auth          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  failure_count integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX push_endpoint_key ON push_subscriptions (endpoint);
