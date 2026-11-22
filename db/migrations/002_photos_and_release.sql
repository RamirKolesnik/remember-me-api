-- Photos uploaded with a frame. Stored in the database for now; they move to
-- object storage (S3-compatible + CDN) before launch.
create table photos (
  id         text primary key,
  mime       text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  data       bytea not null check (octet_length(data) <= 400000),
  created_at timestamptz not null default now()
);

-- The buyer gave up on a hold: free its cells right away.
create function release_hold(p_id bigint)
returns boolean language plpgsql as $$
begin
  update frames set status = 'expired' where id = p_id and status = 'reserved';
  if not found then return false; end if;
  delete from cells where frame_id = p_id;
  return true;
end $$;
