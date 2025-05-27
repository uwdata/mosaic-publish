# mosaic-publish-benchmarks

Query performance benchmarks for Mosaic publish.

Loads DuckDB either in-process or via WASM, issues benchmark task queries against the database, and records the results.

Source data files to load should be placed in `data/`.

Recorded queries should be provided in JSON format in `tasks/`.
See the `tasks/` folder for examples.

## Running Instructions

_Note: for review purposes, this repo includes all example datasets as 100k row samples to keep the total file size down._

### Preliminaries

- Ensure you have node.js version 20 or higher installed.
- Run `npm i` to install dependencies.

### Mosaic Publisher Benchmarks

_For review purposes, this step can be skipped. Benchmark results are in the `results/` folder._

The publisher benchmarks test the performance of the [Mosaic Publisher](https://github.com/uwdata/mosaic/tree/main/packages/publish).

- Run `npm run dev` to start the development server.
- In a separate terminal, run `npm run server` to start the backend server.
- Navigate to the publisher endpoint on the website to access the publisher benchmarks interface.
- Use the interface to test publishing performance with different datasets and configurations by changing the "Specification", "Optimization Level", and "Data Size" dropdowns.

### Pre-Aggregated View Query Benchmark Generation

_For review purposes, this step can be skipped. Benchmark queries are already in the `tasks/` folder._

- With the development server running (`npm run dev`), navigate to the "Query" endpoint.
- Select a template using the "Specification" menu and click the `Run` button to load the example, simulate interactions, and generate benchmark queries. Resulting query logs will be downloaded as a JSON file. The "Optimize" checkbox controls whether or not pre-aggregated materialized views are created.

### Run Pre-Aggregated View Query Benchmarks

_For review purposes, this step can also be skipped. Benchmark results are in the `results/` folder._

- Ensure benchmark queries have been generated and reside in the `tasks/` folder.
- Download and prepare datasets as needed. The scripts in `prep` include download instructions and SQL queries for data prep. Prepared datasets must reside in the `data` folder.
- Run `node bin/upsample.js` to create upsampled datasets (up to 1 billion rows).
- Run benchmarks using the `bin/bench.js` script. For example:
  - `npm run bench flights node opt` - benchmark 'flights' example queries in standard DuckDB (loaded within node.js) with materialized view optimizations
  - `npm run bench airlines node std` - benchmark 'flights' example queries in DuckDB-WASM *without* materialized view optimizations
  - `npm run bench airlines wasm` - benchmark 'airlines' example queries in DuckDB-WASM with materialized view optimizations

### Analyze Results

- Upon completion of benchmarks, run the `prep/select/results.sql` script in DuckDB to consolidate all benchmark results. _You can safely skip this step if reviewing, `results/results.parquet` should already exist._
- With the development server running (`npm run dev`), navigate to the "Results" endpoint.
