-- Prices and waves follow how many frames each zone has sold
-- (GET /wall/pricing and every reservation count them).
create index frames_sold_by_zone on frames (zone) where status in ('active', 'hidden');
