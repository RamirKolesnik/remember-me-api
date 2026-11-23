-- The heart becomes a 4x4 block at the center (cells 498..501). It is not
-- sold on the site: the owner closes the deal in person and the frame is
-- placed with place_heart(). Every other frame must stay off its cells.

-- Old rules: sizes 1..3 only, and "only a 1x1 frame may cover (500, 500)".
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'frames'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) like '%500%' or pg_get_constraintdef(oid) like '%size = ANY%')
  loop
    execute format('alter table frames drop constraint %I', c.conname);
  end loop;
end $$;

-- Free the heart's cells. Before launch only the test wall has frames there
-- (demo frames, or a test purchase of the old 1x1 heart).
delete from frames
where x <= 501 and x + size - 1 >= 498 and y <= 501 and y + size - 1 >= 498;

alter table frames
  add constraint frames_size check (size in (1, 2, 3) or (zone = 0 and size = 4)),
  -- Zone 0 is the heart and nothing else.
  add constraint frames_heart check ((zone = 0) = (x = 498 and y = 498 and size = 4)),
  -- Ordinary frames never touch the heart's cells.
  add constraint frames_off_heart check (
    zone = 0 or x + size - 1 < 498 or x > 501 or y + size - 1 < 498 or y > 501
  );

-- Put the heart's owner on the wall once the deal is closed. p_price is what
-- they actually paid (from $10,000). Raises 'heart_sold' if it is taken.
--   select place_heart('Name', 'Note', '<photo key>', 10000, 'deal-001');
create function place_heart(p_name text, p_note text, p_photo text, p_price int, p_deal_ref text)
returns bigint language plpgsql as $$
declare fid bigint;
begin
  begin
    insert into frames (x, y, size, zone, price_usd, name, note, photo_key, status, payment_ref, paid_at)
    values (498, 498, 4, 0, p_price, p_name, coalesce(p_note, ''), p_photo, 'active', p_deal_ref, now())
    returning id into fid;

    insert into cells (x, y, frame_id)
    select 498 + i, 498 + j, fid
    from generate_series(0, 3) i, generate_series(0, 3) j;
  exception when unique_violation then
    raise exception 'heart_sold' using errcode = 'P0001';
  end;
  return fid;
end $$;
