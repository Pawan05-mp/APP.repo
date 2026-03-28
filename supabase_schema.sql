-- 1. Clear Old Architecture
DROP FUNCTION IF EXISTS get_places_within_distance;
DROP TABLE IF EXISTS places CASCADE;
DROP TABLE IF EXISTS user_interactions CASCADE;

-- 2. Create the Places table (Strict flat architecture for ultra-high velocity reads)
CREATE TABLE places (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location geometry(Point, 4326),
  latitude float,
  longitude float,
  budget text,
  time_to_spend text,
  activities text[],
  whisper text,
  signals jsonb default '{}',
  urgency float, -- Exposing Core Scores as Floats
  effort float,
  energy float,
  popularity_score numeric default 0,
  created_at timestamptz default now()
);

-- 3. Required Performance Indexes
CREATE INDEX idx_places_location ON places USING GIST (location);
CREATE INDEX idx_places_scores ON places (urgency, effort, energy);

-- 4. Create Interaction Logging Table
CREATE TABLE user_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  place_id uuid references places(id),
  action text,
  created_at timestamptz default now()
);

-- 5. Updated PostGIS Pre-Filter Function (Limits to 60 for Pipeline processing)
CREATE OR REPLACE FUNCTION get_places_within_distance(
  user_lat float,
  user_lng float,
  max_distance_meters float,
  result_limit int default 60
)
RETURNS TABLE (
  id uuid,
  name text,
  latitude float,
  longitude float,
  budget text,
  time_to_spend text,
  activities text[],
  whisper text,
  signals jsonb,
  urgency float,
  effort float,
  energy float,
  popularity_score numeric,
  distance_meters float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id, p.name, p.latitude, p.longitude, p.budget, p.time_to_spend, 
    p.activities, p.whisper, p.signals, p.urgency, p.effort, p.energy, p.popularity_score,
    ST_Distance(p.location, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326), true) as distance_meters
  FROM places p
  WHERE ST_DWithin(
    p.location,
    ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326),
    max_distance_meters,
    true
  )
  ORDER BY distance_meters ASC
  LIMIT result_limit;
END;
$$;
