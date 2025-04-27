-- first download taxi data files from
-- https://datasets-documentation.s3.eu-west-3.amazonaws.com/nyc-taxi/trips_{0..19}.gz
-- gunzip files locally under data/trips
-- strip non-unicode characters using iconv, write as clean_trips_0, etc.

-- load taxi data from constituent csv files
CREATE VIEW rides AS SELECT * FROM read_csv('data/trips/clean_trips_*', delim='\t');

-- filter rows where {pickup/dropoff}_{longitude/latitude} are invalid longitude/latitude values
CREATE VIEW rides_clean AS 
SELECT * 
FROM './data/rides.parquet' 
WHERE pickup_latitude IS NOT NULL 
  AND pickup_longitude IS NOT NULL 
  AND dropoff_latitude IS NOT NULL 
  AND dropoff_longitude IS NOT NULL 
  AND pickup_latitude BETWEEN -90 AND 90 
  AND pickup_longitude BETWEEN -180 AND 180 
  AND dropoff_latitude BETWEEN -90 AND 90 
  AND dropoff_longitude BETWEEN -180 AND 180;

-- write result to new parquet file
COPY rides_clean TO 'data/rides-clean.parquet' (FORMAT PARQUET);
