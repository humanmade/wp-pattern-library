/**
 * Configuration loading and defaults.
 */

import { pathToFileURL } from 'node:url';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, isAbsolute, join } from 'node:path';

const CONFIG_FILENAMES = [
	'pattern-library.config.js',
	'pattern-library.config.mjs',
];

/**
 * Default classifier: every category is its own page, in the output root.
 *
 * Projects with a multi-kind taxonomy override this in their config. See the
 * README for an example that splits categories by label prefix.
 *
 * @param {{slug: string, label: string}} category Registered pattern category.
 * @return {{kind: string, dir: string, label: string}} Placement for the category.
 */
export const flatClassify = ( { label } ) => ( {
	kind: 'category',
	dir: '.',
	label,
} );

const DEFAULTS = {
	siteUrl: '',
	username: '',
	appPassword: '',
	namespaces: [],
	title: 'Pattern Library',
	outputDir: 'docs/pattern-library',
	indexFile: null, // Defaults to <outputDir>/README.md.
	screenshotsDir: null, // Defaults to <outputDir>/screenshots.
	imageFormat: 'webp',
	imageQuality: 80,
	defaultViewport: 1440,
	captureTimeout: 30000,
	exclude: {
		inserterHidden: true,
		postTypes: [ 'wp_template', 'wp_template_part' ],
		patterns: [],
	},
	postTypeContext: {},
	classify: flatClassify,
};

const exists = ( path ) =>
	access( path, constants.F_OK )
		.then( () => true )
		.catch( () => false );

const absolute = ( path, cwd ) => ( isAbsolute( path ) ? path : resolve( cwd, path ) );

/**
 * Load `pattern-library.config.js`, layered over defaults and environment.
 *
 * Precedence, lowest first: defaults, config file, environment, CLI overrides.
 * Credentials come from the environment only — they should never be committed to
 * a config file.
 *
 * @param {string} cwd       Directory to resolve the config and output paths from.
 * @param {Object} overrides Values from CLI flags.
 * @return {Promise<Object>} Resolved configuration.
 */
export async function loadConfig( cwd = process.cwd(), overrides = {} ) {
	let fileConfig = {};
	let configPath = null;

	for ( const filename of CONFIG_FILENAMES ) {
		const candidate = resolve( cwd, filename );
		if ( await exists( candidate ) ) {
			configPath = candidate;
			const loaded = await import( pathToFileURL( candidate ).href );
			fileConfig = loaded.default ?? loaded;
			break;
		}
	}

	const fromEnv = clean( {
		siteUrl: process.env.PATTERN_LIBRARY_SITE,
		username: process.env.PATTERN_LIBRARY_WP_USER,
		appPassword: process.env.PATTERN_LIBRARY_WP_APP_PASSWORD,
	} );

	const config = {
		...DEFAULTS,
		...fileConfig,
		exclude: { ...DEFAULTS.exclude, ...( fileConfig.exclude ?? {} ) },
		...fromEnv,
		...clean( overrides ),
		configPath,
	};

	config.siteUrl = config.siteUrl.replace( /\/$/, '' );
	config.outputDir = absolute( config.outputDir, cwd );
	config.screenshotsDir = config.screenshotsDir
		? absolute( config.screenshotsDir, cwd )
		: join( config.outputDir, 'screenshots' );
	config.indexFile = config.indexFile
		? absolute( config.indexFile, cwd )
		: join( config.outputDir, 'README.md' );

	return config;
}

/**
 * Drop keys whose value is undefined or empty, so they do not mask a lower layer.
 *
 * @param {Object} object Candidate overrides.
 * @return {Object} Only the keys that carry a value.
 */
function clean( object ) {
	return Object.fromEntries(
		Object.entries( object ).filter(
			( [ , value ] ) => value !== undefined && value !== null && value !== ''
		)
	);
}

/**
 * Throw a helpful error when required configuration is missing.
 *
 * @param {Object}   config Resolved configuration.
 * @param {string[]} keys   Required config keys.
 */
export function requireConfig( config, keys ) {
	const missing = keys.filter( ( key ) => ! config[ key ] );

	if ( missing.length ) {
		const hints = {
			siteUrl: '--site or PATTERN_LIBRARY_SITE',
			username: 'PATTERN_LIBRARY_WP_USER',
			appPassword: 'PATTERN_LIBRARY_WP_APP_PASSWORD',
		};
		throw new Error(
			`Missing required configuration: ${ missing
				.map( ( key ) => `${ key } (set via ${ hints[ key ] ?? key })` )
				.join( ', ' ) }`
		);
	}
}
