-- download data at http://cdn.gea.esac.esa.int/Gaia/gdr3/gaia_source/
-- save files under data/gaia

-- load original data
CREATE VIEW gaia AS
SELECT ra, dec, parallax, phot_g_mean_mag, bp_rp
FROM 'data/gaia/*.csv.gz';

-- write result to new parquet file
COPY gaia TO 'data/gaia_raw.parquet' (FORMAT PARQUET);
