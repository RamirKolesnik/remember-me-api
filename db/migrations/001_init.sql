-- Frames, the cells they occupy, holds and reports.

create table frames (
  id          bigserial primary key,
  x           int not null check (x between 0 and 999),
  y           int not null check (y between 0 and 999),
  size        smallint not null check (size in (1, 2, 3)),
  zone        smallint not null check (zone between 0 and 4), -- 0 = the heart
  price_usd   int not null check (price_usd > 0),
  name        text not null check (char_length(name) between 1 and 40),
  note        text not null default '' check (char_length(note) <= 280),
  photo_key   text,
  status      text not null check (status in ('reserved', 'active', 'hidden', 'expired')),
  holder      text,                -- who holds the reservation (client IP)
  expires_at  timestamptz,
  payment_ref text unique,
  created_at  timestamptz not null default now(),
  paid_at     timestamptz,
  check (x + size <= 1000 and y + size <= 1000),
  -- Only a 1x1 frame may cover the heart at (500, 500).
  check (size = 1 or not (500 between x and x + size - 1 and 500 between y and y + size - 1))
);

create index frames_visible on frames (y, x) where status = 'active';
create index frames_expiring on frames (expires_at) where status = 'reserved';
-- One live hold per client.
create unique index frames_one_hold_per_holder on frames (holder) where status = 'reserved';

-- Every taken cell. The primary key is what makes double-selling impossible.
create table cells (
  x        smallint not null,
  y        smallint not null,
  frame_id bigint not null references frames (id) on delete cascade,
  primary key (x, y)
);
create index cells_frame on cells (frame_id);

create table reports (
  id         bigserial primary key,
  frame_id   bigint not null references frames (id) on delete cascade,
  reason     text not null default '' check (char_length(reason) <= 500),
  reporter   text,
  created_at timestamptz not null default now()
);
create index reports_frame on reports (frame_id);

-- Release holds whose time ran out. A short grace period leaves room for a
-- payment webhook that arrives a little late.
create function expire_reservations(grace interval default interval '2 minutes')
returns int language plpgsql as $$
declare n int;
begin
  with gone as (
    update frames set status = 'expired'
    where status = 'reserved' and expires_at < now() - grace
    returning id
  ), freed as (
    delete from cells using gone where cells.frame_id = gone.id returning 1
  )
  -- Data-modifying CTEs always run in full, so "freed" runs even unread.
  select count(*) into n from gone;
  return n;
end $$;

-- Hold a spot. Raises 'spot_taken' or 'hold_exists' (SQLSTATE P0001) on conflict.
create function reserve_frame(
  p_x int, p_y int, p_size int, p_zone int, p_price int,
  p_name text, p_note text, p_photo text, p_holder text, p_minutes int
) returns bigint language plpgsql as $$
declare
  fid bigint;
  c text;
begin
  perform expire_reservations();
  begin
    insert into frames (x, y, size, zone, price_usd, name, note, photo_key, status, holder, expires_at)
    values (p_x, p_y, p_size, p_zone, p_price, p_name, coalesce(p_note, ''), p_photo, 'reserved', p_holder,
            now() + make_interval(mins => p_minutes))
    returning id into fid;

    insert into cells (x, y, frame_id)
    select p_x + i, p_y + j, fid
    from generate_series(0, p_size - 1) i, generate_series(0, p_size - 1) j;
  exception when unique_violation then
    get stacked diagnostics c = constraint_name;
    if c = 'cells_pkey' then
      raise exception 'spot_taken' using errcode = 'P0001';
    elsif c = 'frames_one_hold_per_holder' then
      raise exception 'hold_exists' using errcode = 'P0001';
    end if;
    raise;
  end;
  return fid;
end $$;

-- Turn a paid hold into a frame on the wall. False if the hold is gone.
create function activate_frame(p_id bigint, p_payment_ref text)
returns boolean language plpgsql as $$
begin
  update frames
  set status = 'active', paid_at = now(), payment_ref = p_payment_ref, holder = null, expires_at = null
  where id = p_id and status = 'reserved';
  return found;
end $$;
