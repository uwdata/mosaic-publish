import yaml from "yaml";
import fs from 'fs';
import { JSDOM } from 'jsdom';
import path from "path";
import { rollup } from "rollup";
import virtual from "@rollup/plugin-virtual";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";


// Mosaic modules
import {
  parseSpec, astToESM, astToDOM,
  SpecNode, DataNode, FileDataNode,
  ParquetDataNode, OptionsNode,
  CodegenContext,
  QueryDataNode,
} from '@uwdata/mosaic-spec';
import { MosaicClient, isActivatable } from '@uwdata/mosaic-core';

// Utility imports
import {
  preamble, PreambleOptions, htmlTemplate, templateCSS,
  publishConnector, PublishContext, mockCanvas,
  VGPLOT, FLECHETTE,
  LogLevel, Logger,
  clientsReady,
  OPTIMIZATION_LEVEL_TO_OPTIMIZATIONS, Optimizations,
} from './util/index.js';
import { binary, map, tableFromArrays, tableToIPC, utf8 } from "@uwdata/flechette";

/**
 * Error class for know publishing errors.
 * @param message Error message.
 */
export class PublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishError';
  }
}

export type MosaicPublisherOptions = {
  spec: string;
  outputPath?: string;
  title?: string;
  optimize?: 'none' | 'minimal' | 'more' | 'most';
  logger?: Logger;
  customScript?: string;
};

/**
 * Class to facilitate publishing a Mosaic specification.
 * @param options Options for configuring the MosaicPublisher instance.
 * @param options.spec Contents of JSON Mosaic specification file.
 * @param options.outputPath Path to the desired output directory.
 * @param options.title Optional title for the HTML file.
 * @param options.optimize Level of optimization for published visualization.
 * @param options.logger Optional logger instance to use for logging.
 * @param options.customScript Optional custom script to include in the output.
 * 
 * The `publish` method is the main entry point for the class
 */
export class MosaicPublisher {
  private spec: string;
  private outputPath: string;
  private title: string;
  private optimizations: Optimizations[];
  private logger: Logger;
  private customScript: string = '';

  // Internal references used throughout
  private ctx: PublishContext;
  private ast?: SpecNode;
  private data?: Record<string, DataNode>;

  constructor({
    spec,
    outputPath = 'out',
    title = 'Mosaic Visualization',
    optimize = 'minimal',
    logger = new Logger(LogLevel.INFO),
    customScript = '',
  }: MosaicPublisherOptions) {
    this.spec = spec;
    this.outputPath = outputPath;
    this.title = title;
    this.optimizations = OPTIMIZATION_LEVEL_TO_OPTIMIZATIONS[optimize];
    this.logger = logger;
    this.customScript = customScript;

    // Create PublishContext
    const connector = publishConnector();
    this.ctx = new PublishContext(connector);
  }

  /**
   * Main entry point for publishing a Mosaic specification.
   */
  public async publish() {
    this.logger.info('Parsing and processing spec...');

    // Parse specification
    try {
      this.ast = parseSpec(yaml.parse(this.spec));
    } catch (err) {
      throw new PublishError(`Failed to parse specification: ${err}`);
    }
    if (!this.ast) return;
    this.data = this.ast.data;

    // Setup jsdom
    const dom = new JSDOM(
      `<!DOCTYPE html><body></body>`,
      { pretendToBeVisual: true }
    );
    globalThis.window = dom.window as any;
    globalThis.document = dom.window.document;
    globalThis.navigator ??= dom.window.navigator;
    globalThis.requestAnimationFrame = window.requestAnimationFrame;
    mockCanvas(globalThis.window);

    // Load the visualization in the DOM and gather interactors/inputs
    const { element } = await astToDOM(this.ast, { api: this.ctx.api });
    document.body.appendChild(element);
    await clientsReady(this.ctx);

    const { interactors, inputs } = this.processClients();
    const isInteractive = interactors.size + inputs.size !== 0;

    // If spec is valid create relevant output directory
    if (fs.existsSync(this.outputPath)) {
      this.logger.warn(`Clearing output directory: ${this.outputPath}`);
      fs.rmSync(this.outputPath, { recursive: true });
      fs.mkdirSync(this.outputPath, { recursive: true });
    } else {
      this.logger.info(`Creating output directory: ${this.outputPath}`);
      fs.mkdirSync(this.outputPath, { recursive: true });
    }

    let postLoad;
    if (isInteractive) {
      // Activate interactors and inputs
      await this.activateInteractorsAndInputs(interactors, inputs);

      // Modify AST and process data (extensions, data definitions, etc.)
      const og = FileDataNode.prototype.codegenQuery;
      FileDataNode.prototype.codegenQuery = function (ctx: CodegenContext) {
        const code = og.call(this, ctx);
        const { file } = this;
        return code?.replace(`"${file}"`, `window.location.origin + "/${file}"`);
      };
      const tables = this.ctx.coordinator.databaseConnector().tables();
      postLoad = await this.updateDataNodes(tables);
      // Export relevant data from DuckDB to Parquet
      await this.exportDataFromDuckDB(tables);
    }

    await this.writeFiles(
      isInteractive,
      this.optimizations.includes(Optimizations.PRERENDER) ? element : undefined,
      postLoad,
    );
  }

  private processClients() {
    const interactors = new Set<any>();
    const inputs = new Set<MosaicClient>();
    if (!this.ctx.coordinator.clients) return { interactors, inputs };

    for (const client of this.ctx.coordinator.clients) {
      if (client instanceof MosaicClient && isActivatable(client)) {
        inputs.add(client);
      }
      if (client.plot) {
        for (const interactor of client.plot.interactors) {
          interactors.add(interactor);
        }
      }
    }
    return { interactors, inputs };
  }

  /**
   * Activate the Interactors and Inputs, waiting 
   * for queries to finish.
   */
  private async activateInteractorsAndInputs(interactors: Set<any>, inputs: Set<MosaicClient>) {
    // await this.ctx.coordinator.exec('CREATE SCHEMA IF NOT EXISTS mosaic');
    for (const interactor of interactors) {
      if (isActivatable(interactor)) interactor.activate();
      await this.waitForQueryToFinish();
    }

    for (const input of inputs) {
      if (isActivatable(input)) input.activate();
      await this.waitForQueryToFinish();
    }
  }

  private async waitForQueryToFinish() {
    while (this.ctx.coordinator.manager.pendingExec) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Process data definitions (DataNodes) and converts them to ParquetDataNode
   * objects based on specified tables.
   */
  private async updateDataNodes(tables: Record<string, Set<string> | null>): Promise<string | undefined> {
    // process data definitions
    for (const node of Object.values(this.data!)) {
      if (!(node.name in tables)) {
        delete this.ast!.data[node.name];
        continue;
      }
      const name = node.name;
      const file = `data/${name}.parquet`;
      this.ast!.data[name] = new ParquetDataNode(name, file, new OptionsNode({}));
    }

    // process tables from DuckDB
    const db_tables = await this.ctx.coordinator.query('SHOW ALL TABLES', { cache: false, type: 'json' });
    if (this.optimizations.includes(Optimizations.PREAGREGATE)
      && db_tables.some((table: any) => table.name.startsWith('preagg_'))) {
      let postLoad = "getVgInstance().coordinator().exec([\n\t'CREATE SCHEMA IF NOT EXISTS mosaic;',\n";
      const genCtx = new CodegenContext({
        namespace: 'getVgInstance()'
      });

      for (const table of db_tables) {
        if (table.name.startsWith('preagg_')) {
          const name = `${table.schema}.${table.name}`;
          tables[name] = null;
          const file = `data/.mosaic/${table.name}.parquet`;
          this.ast!.data[name] = new ParquetDataNode(name, file, new OptionsNode({}));
          postLoad += `\t${this.ast!.data[name].codegenQuery(genCtx)},\n`;
        } else if (table.name in tables && tables[table.name] == new Set(table.column_names)) {
          tables[table.name] = null;
        }
      }
      postLoad += "], {priority: 2})";
      return postLoad;
    }
    return undefined;
  }

  /**
   * Write out the index.js, index.html, and create data/ directory as needed.
   */
  private async writeFiles(isInteractive: boolean, element?: HTMLElement | SVGElement, postLoad?: string) {
    let preambleOptions: PreambleOptions = { cacheFile: undefined }
    if (this.optimizations.includes(Optimizations.LOAD_CACHE)) {
      const cache = this.ctx.coordinator.manager.cache().export();
      const cacheFile = '.cache.arrow';
      if (cache) {
        const cacheBytes = tableToIPC(tableFromArrays({ cache: [cache] }, {
          types: {
            cache: map(utf8(), binary())
          }
        }), {})!;
        fs.writeFileSync(path.join(this.outputPath, cacheFile), cacheBytes);
        preambleOptions.cacheFile = cacheFile;
      }
    }

    const code = astToESM(this.ast!, {
      connector: 'wasm',
      imports: new Map([[VGPLOT, '* as vg'], [FLECHETTE, '{ tableFromIPC }']]),
      preamble: preamble(preambleOptions),
    });
    const html = htmlTemplate({
      title: this.title,
      css: templateCSS,
      postLoad,
      isInteractive,
      element,
      customScript: this.customScript,
    });

    fs.writeFileSync(path.join(this.outputPath, 'index.html'), html);
    if (isInteractive) {
      const bundle = await rollup({
        input: 'entry.js',
        plugins: [  // We ts-ignore these because they use cjs default exports
          // @ts-ignore
          virtual({ 'entry.js': code }),
          // @ts-ignore
          resolve({ browser: true }),
          // @ts-ignore
          commonjs({ defaultIsModuleExports: true }),
        ],
        output: {
          manualChunks: {
            vgplot: ['@uwdata/vgplot'],
            flechette: ['@uwdata/flechette'],
          },
          minifyInternalExports: true,
        },
        logLevel: 'silent',
        treeshake: true,
      });

      await bundle.write({
        dir: this.outputPath,
        format: 'esm',
        entryFileNames: 'index.js',
      });
    }
  }

  /**
   * Export relevant data from DuckDB to local Parquet
   */
  private async exportDataFromDuckDB(tables: Record<string, Set<string> | null>) {
    const table_copy_queries: string[] = [];
    const materialized_view_copy_queries: string[] = [];
    for (const node of Object.values(this.data!)) {
      if (!(node instanceof ParquetDataNode)) continue;
      const table = node.name;
      const file = node.file;
      const relevant_columns = tables[table];
      if (relevant_columns?.size === 0 && this.optimizations.includes(Optimizations.DATASHAKE)) {
        this.logger.warn(`Skipping export of table: ${table}`);
        this.logger.warn(`No columns are being used from this table.`);
        continue;
      }

      let query: string;
      if (this.optimizations.includes(Optimizations.PROJECTION) && relevant_columns) {
        this.logger.warn(`Partially exporting table: ${table}`);
        query = `COPY (SELECT ${Array.from(relevant_columns).join(', ')} FROM ${table}) TO '${this.outputPath}/${file}' (FORMAT PARQUET)`;
      } else {
        query = `COPY (SELECT * FROM ${table}) TO '${this.outputPath}/${file}' (FORMAT PARQUET)`;
      }

      if (table.startsWith('mosaic.preagg_')) {
        materialized_view_copy_queries.push(query);
        delete this.ast!.data[table];
      } else {
        table_copy_queries.push(query);
      }
    }

    if (table_copy_queries.length > 0 || materialized_view_copy_queries.length > 0) {
      this.logger.info('Exporting data tables to Parquet...');
      fs.mkdirSync(path.join(this.outputPath, 'data'), { recursive: true });
      await this.ctx.coordinator.exec(table_copy_queries);

      if (materialized_view_copy_queries.length > 0) {
        this.logger.info('Exporting materialized views to Parquet...');
        fs.mkdirSync(path.join(this.outputPath, 'data/.mosaic'), { recursive: true });
        await this.ctx.coordinator.exec(materialized_view_copy_queries);
      }
    }
  }
}

// then(() => {
//     getVgInstance().coordinator().exec(['CREATE SCHEMA IF NOT EXISTS mosaic;'], {priority: 2}).then(() => {
//       getVgInstance().coordinator().exec([
//         getVgInstance().loadParquet("mosaic.preagg_6bbe25ef", window.location.origin + "/data/.mosaic/preagg_6bbe25ef.parquet"),
//         getVgInstance().loadParquet("mosaic.preagg_6e8516e9", window.location.origin + "/data/.mosaic/preagg_6e8516e9.parquet"),
//         getVgInstance().loadParquet("mosaic.preagg_758b378c", window.location.origin + "/data/.mosaic/preagg_758b378c.parquet"),
//         getVgInstance().loadParquet("mosaic.preagg_e9243c45", window.location.origin + "/data/.mosaic/preagg_e9243c45.parquet")
//       ], {priority: 2});
//     })
//   })