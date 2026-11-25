-- Every frame on sale is now one cell (80 px, the size of the old 2x2), with
-- one price per zone that is not a whole dollar ($4.99 ... $99), so prices are
-- kept in cents. The heart stays the 4x4 block at the center.
--
-- The wall starts over: before launch it only holds test purchases and demo
-- frames bought under the old sizes and prices.
delete from frames;      -- cells, reports and story cards go with them
delete from photos;      -- test uploads
alter sequence frames_id_seq restart;
select setval('frame_number_seq', 1, false);  -- the first real frame is #1

alter table frames rename column price_usd to price_cents;

alter table frames drop constraint frames_size;
alter table frames add constraint frames_size check (size = 1 or (zone = 0 and size = 4));

-- Same as in 001, writing price_cents. p_price is in cents; p_size must be 1.
create or replace function reserve_frame(
  p_x int, p_y int, p_size int, p_zone int, p_price int,
  p_name text, p_note text, p_photo text, p_holder text, p_minutes int
) returns bigint language plpgsql as $$
declare
  fid bigint;
  c text;
begin
  perform expire_reservations();
  begin
    insert into frames (x, y, size, zone, price_cents, name, note, photo_key, status, holder, expires_at)
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

-- Same as in 004. p_price stays in whole dollars, as written in the deal
-- (from 10000), and is stored in cents.
--   select place_heart('Name', 'Note', '<photo key>', 10000, 'deal-001');
create or replace function place_heart(p_name text, p_note text, p_photo text, p_price int, p_deal_ref text)
returns bigint language plpgsql as $$
declare fid bigint;
begin
  begin
    insert into frames (x, y, size, zone, price_cents, name, note, photo_key, status, payment_ref, paid_at)
    values (498, 498, 4, 0, p_price::bigint * 100, p_name, coalesce(p_note, ''), p_photo, 'active', p_deal_ref, now())
    returning id into fid;

    insert into cells (x, y, frame_id)
    select 498 + i, 498 + j, fid
    from generate_series(0, 3) i, generate_series(0, 3) j;
  exception when unique_violation then
    raise exception 'heart_sold' using errcode = 'P0001';
  end;
  return fid;
end $$;
