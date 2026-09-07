#!/usr/bin/env node
/**
 * Generate a Markdown pattern library from a WordPress site's block patterns.
 *
 *   pattern-library build      Fetch, capture, and write Markdown.
 *   pattern-library manifest   Print the filtered manifest as JSON.
 *   pattern-library capture    Screenshots only.
 *   pattern-library generate   Markdown only, from existing screenshots.
 *
 * Credentials come from PATTERN_LIBRARY_WP_USER and
 * PATTERN_LIBRARY_WP_APP_PASSWORD; the site from --site or PATTERN_LIBRARY_SITE.
 */

import { loadConfig, requireConfig } from '../src/config.mjs';
import { fetchManifest, filterPatterns, shotsFor } from '../src/manifest.mjs';
import { captureAll } from '../src/capture.mjs';
import { generate } from '../src/markdown.mjs';

const COMMANDS = [ 'build', 'manifest', 'capture', 'generate' ];

/**
 * Parse `--flag value` and `--flag=value` arguments.
 *
 * @param {string[]} argv Raw arguments after the command.
 * @return {{options: Object, filters: string[]}} Parsed flags and bare filters.
 */
function parseArgs( argv ) {
	const options = {};
	const filters = [];

	for ( let index = 0; index < argv.length; index++ ) {
		const arg = argv[ index ];

		if ( ! arg.startsWith( '--' ) ) {
			filters.push( arg );
			continue;
		}

		const [ key, inline ] = arg.slice( 2 ).split( '=' );
		const camel = key.replace( /-([a-z])/g, ( _, letter ) => letter.toUpperCase() );

		if ( inline !== undefined ) {
			options[ camel ] = inline;
		} else if ( argv[ index + 1 ] && ! argv[ index + 1 ].startsWith( '--' ) ) {
			options[ camel ] = argv[ ++index ];
		} else {
			options[ camel ] = true;
		}
	}

	return { options, filters };
}

const log = ( message ) => process.stdout.write( `${ message }\n` );

/**
 * Run the CLI.
 */
async function main() {
	const [ command = 'build', ...rest ] = process.argv.slice( 2 );

	if ( ! COMMANDS.includes( command ) ) {
		throw new Error(
			`Unknown command "${ command }". Expected one of: ${ COMMANDS.join( ', ' ) }.`,
		);
	}

	const { options, filters } = parseArgs( rest );
	const { site, dryRun, ...overrides } = options;
	const config = await loadConfig( process.cwd(), { ...overrides, siteUrl: site } );

	requireConfig( config, [ 'siteUrl', 'username', 'appPassword' ] );

	const manifest = await fetchManifest( config );
	const { patterns, skipped } = filterPatterns( manifest, config );

	if ( command === 'manifest' ) {
		log( JSON.stringify( { ...manifest, patterns }, null, '\t' ) );
		return;
	}

	const matches = ( pattern ) =>
		filters.some( ( filter ) => pattern.basename.includes( filter ) );
	const targets = filters.length ? patterns.filter( matches ) : patterns;

	log( `${ manifest.site.name } — ${ config.siteUrl }` );
	log(
		`${ patterns.length } patterns in the library, ${ skipped.length } skipped, ${ targets.length } targeted.`,
	);

	if ( config.variants.length ) {
		const shots = targets.reduce(
			( total, pattern ) => total + shotsFor( pattern, config ).length,
			0,
		);
		log(
			`${ config.variants
				.map( ( variant ) => variant.label )
				.join( ', ' ) } variant(s) configured — ${ shots } captures for ${ targets.length } patterns.`,
		);
	}

	if ( skipped.length ) {
		const reasons = skipped.reduce( ( counts, pattern ) => {
			counts[ pattern.reason ] = ( counts[ pattern.reason ] ?? 0 ) + 1;
			return counts;
		}, {} );
		log(
			`Skipped: ${ Object.entries( reasons )
				.map( ( [ reason, count ] ) => `${ count } ${ reason }` )
				.join( ', ' ) }.`,
		);
	}

	if ( dryRun ) {
		log( '\nDry run — nothing written.' );
		return;
	}

	if ( command === 'build' || command === 'capture' ) {
		log( `\nCapturing to ${ config.screenshotsDir }` );
		const summary = await captureAll( targets, config, log );

		log(
			`\n${ summary.written } written, ${ summary.unchanged } unchanged, ` +
				`${ summary.empty.length } empty, ${ summary.failed.length } failed.`,
		);

		if ( summary.empty.length ) {
			log(
				`Rendered empty (need post context or a live query): ${ summary.empty.join( ', ' ) }`,
			);
		}

		if ( summary.broken.length ) {
			log( '\nMissing resources (referenced but failed to load):' );
			for ( const item of summary.broken ) {
				log( `  ${ item.basename }` );
				item.resources.forEach( ( resource ) => log( `    - ${ resource }` ) );
			}
		}

		if ( summary.failed.length ) {
			log( `Failed: ${ summary.failed.map( ( item ) => item.basename ).join( ', ' ) }` );
			process.exitCode = 1;
		}
	}

	if ( command === 'build' || command === 'generate' ) {
		const result = await generate( manifest, patterns, config, skipped );
		log( `\nWrote ${ result.index } and ${ result.pages } category pages.` );
	}
}

main().catch( ( error ) => {
	process.stderr.write( `\n${ error.message }\n` );
	process.exit( 1 );
} );
