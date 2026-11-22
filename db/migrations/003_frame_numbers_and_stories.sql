-- Frame numbers ("I'm #4,812 on the wall") and the 9:16 story cards.

-- Numbers follow the order in which frames went live. A trigger hands them
-- out, so every path that activates a frame (payment, seed, admin) gets one.
create sequence frame_number_seq;
alter table frames add column number int unique;

with ordered as (
  select id, row_number() over (order by paid_at nulls last, id) as n
  from frames where status in ('active', 'hidden')
)
update frames f set number = o.n from ordered o where f.id = o.id;
select setval('frame_number_seq', coalesce((select max(number) from frames), 0) + 1, false);

create function assign_frame_number() returns trigger language plpgsql as $$
begin
  if new.status = 'active' and new.number is null then
    new.number := nextval('frame_number_seq');
  end if;
  return new;
end $$;

create trigger frames_number before insert or update of status on frames
  for each row execute function assign_frame_number();

-- Rendered story cards. In the database for now, like photos; they move to
-- object storage + CDN before launch.
create table frame_stories (
  frame_id   bigint primary key references frames (id) on delete cascade,
  mime       text not null check (mime in ('image/jpeg', 'image/png')),
  data       bytea not null,
  created_at timestamptz not null default now()
);
