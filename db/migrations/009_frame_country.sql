-- Where a buyer is from: an ISO 3166-1 alpha-2 code worked out from the IP at
-- the hold (null when unknown). Only the country is kept, never the IP's place.
alter table frames add column country char(2)
  constraint frames_country check (country ~ '^[A-Z]{2}$');

-- Country stats count live frames per country.
create index frames_active_country on frames (country) where status = 'active';
