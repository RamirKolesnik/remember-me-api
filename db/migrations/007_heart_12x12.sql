-- The heart grows to a 12x12 block (cells 495..506) and the wall to
-- 1002x1002 cells: an even side keeps the heart exactly in the middle, and
-- the wall still holds over a million frames (1,003,860) around it.
--
-- The wall starts over: before launch it only holds test purchases, some of
-- them on cells the bigger heart now covers.
delete from frames;      -- cells, reports and story cards go with them
delete from photos;      -- test uploads
alter sequence frames_id_seq restart;
select setval('frame_number_seq', 1, false);  -- the first real frame is #1

-- Old bounds (0..999, x + size <= 1000) from 001.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'frames'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) like '%999%' or pg_get_constraintdef(oid) like '%1000%')
  loop
    execute format('alter table frames drop constraint %I', c.conname);
  end loop;
end $$;

alter table frames
  drop constraint frames_size,
  drop constraint frames_heart,
  drop constraint frames_off_heart;

alter table frames
  add constraint frames_on_wall check (x >= 0 and y >= 0 and x + size <= 1002 and y + size <= 1002),
  add constraint frames_size check (size = 1 or (zone = 0 and size = 12)),
  -- Zone 0 is the heart and nothing else.
  add constraint frames_heart check ((zone = 0) = (x = 495 and y = 495 and size = 12)),
  -- Ordinary frames never touch the heart's cells.
  add constraint frames_off_heart check (
    zone = 0 or x + size - 1 < 495 or x > 506 or y + size - 1 < 495 or y > 506
  );

-- Same as in 005, for the 12x12 heart. p_price is in whole dollars, as
-- written in the deal (from 10000), and is stored in cents.
--   select place_heart('Name', 'Note', '<photo key>', 10000, 'deal-001');
create or replace function place_heart(p_name text, p_note text, p_photo text, p_price int, p_deal_ref text)
returns bigint language plpgsql as $$
declare fid bigint;
begin
  begin
    insert into frames (x, y, size, zone, price_cents, name, note, photo_key, status, payment_ref, paid_at)
    values (495, 495, 12, 0, p_price::bigint * 100, p_name, coalesce(p_note, ''), p_photo, 'active', p_deal_ref, now())
    returning id into fid;

    insert into cells (x, y, frame_id)
    select 495 + i, 495 + j, fid
    from generate_series(0, 11) i, generate_series(0, 11) j;
  exception when unique_violation then
    raise exception 'heart_sold' using errcode = 'P0001';
  end;
  return fid;
end $$;
