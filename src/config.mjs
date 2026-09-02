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
	// Upper bound on capture width. A pattern declaring a wider `Viewport Width`
	// is captured at this instead; null leaves every declared width alone.
	maxViewport: null,
	captureTimeout: 30000,
	exclude: {
		inserterHidden: true,
		postTypes: [ 'wp_template', 'wp_template_part' ],
		patterns: [],
	},
	postTypeContext: {},
	classify: flatClassify,
	// Animation libraries whose finished state is forced before capture: built-in
	// names or custom { css, settle } objects. See src/animations.mjs.
	animations: [ 'aos' ],
	// Extra metadata lines per pattern: { label, value }, where value is a
	// manifest property name or a function receiving the pattern.
	extraFields: [],
	// Additional captures of each pattern, taken inside a group-block wrapper:
	// { slug, label, wrapper, appliesTo }. See normalizeVariants().
	variants: [],
	// Caption shown above a pattern's plain capture when it also has variants.
	baseLabel: 'Default rendering',
	// List configuration-skipped patterns on the index page.
	includeSkipped: true,
	// Ask the site to substitute a placeholder featured image for posts without one.
	placeholderImages: true,
	// Headers sent with every request to the site, for origins behind an access
	// proxy such as Cloudflare Access. Secrets belong in the environment; see
	// PATTERN_LIBRARY_EXTRA_HEADERS.
	extraHeaders: {},
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
		// Merged rather than replaced: a project may name non-secret headers in its
		// config file while the values that are secret arrive from the environment.
		extraHeaders: {
			...( fileConfig.extraHeaders ?? {} ),
			...parseHeaders( process.env.PATTERN_LIBRARY_EXTRA_HEADERS ),
		},
		configPath,
	};

	config.variants = normalizeVariants( config.variants );

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
 * Validate and complete the configured variants.
 *
 * A variant is one extra capture of every pattern it applies to, taken inside a
 * group block carrying `wrapper`'s attributes — the way a project's section
 * styles are applied to a pattern in real use. The site builds that wrapper; see
 * WRAPPER_ATTRIBUTES in the plugin for the attributes it accepts.
 *
 * `appliesTo` is what keeps a variant affordable. Every variant doubles the
 * captures — and the committed images — for the patterns it covers, and some
 * patterns have no meaningful variant to show: a whole-page reference already
 * carries its own sections.
 *
 * @param {Array} variants Configured variants.
 * @return {Array} Variants with defaults applied.
 */
function normalizeVariants( variants ) {
	if ( ! Array.isArray( variants ) ) {
		throw new Error( 'Configuration error: `variants` must be an array.' );
	}

	const seen = new Set();

	return variants.map( ( variant, index ) => {
		const where = `variants[${ index }]`;

		// The slug becomes a filename suffix, so it has to survive a round trip
		// through the filesystem and a Markdown link unaltered.
		if ( ! /^[a-z0-9]+(-[a-z0-9]+)*$/.test( variant?.slug ?? '' ) ) {
			throw new Error(
				`Configuration error: ${ where }.slug must be a lowercase kebab-case string; got ${ JSON.stringify(
					variant?.slug
				) }.`
			);
		}

		if ( seen.has( variant.slug ) ) {
			throw new Error( `Configuration error: duplicate variant slug "${ variant.slug }".` );
		}
		seen.add( variant.slug );

		if (
			! variant.wrapper ||
			typeof variant.wrapper !== 'object' ||
			Array.isArray( variant.wrapper ) ||
			! Object.keys( variant.wrapper ).length
		) {
			throw new Error(
				`Configuration error: ${ where }.wrapper must be a non-empty object of group block attributes.`
			);
		}

		if ( variant.appliesTo !== undefined && typeof variant.appliesTo !== 'function' ) {
			throw new Error( `Configuration error: ${ where }.appliesTo must be a function.` );
		}

		return {
			slug: variant.slug,
			label: variant.label ?? titleCase( variant.slug ),
			wrapper: variant.wrapper,
			appliesTo: variant.appliesTo ?? ( () => true ),
		};
	} );
}

/**
 * Turn a kebab-case slug into a display label.
 *
 * @param {string} slug Variant slug.
 * @return {string} Label.
 */
const titleCase = ( slug ) =>
	slug.replace( /(^|-)([a-z])/g, ( _, separator, letter ) =>
		( separator ? ' ' : '' ) + letter.toUpperCase()
	);

/**
 * Parse newline-delimited `Name: value` header lines.
 *
 * The environment carries headers as text because that is what a CI secret is:
 * one string, often several headers long. Values may contain colons, so only the
 * first one separates the name.
 *
 * @param {string|undefined} value Raw header block.
 * @return {Object} Header name to value.
 */
function parseHeaders( value ) {
	const headers = {};

	for ( const line of ( value ?? '' ).split( '\n' ) ) {
		const trimmed = line.trim();

		if ( ! trimmed ) {
			continue;
		}

		const separator = trimmed.indexOf( ':' );

		if ( separator < 1 ) {
			throw new Error(
				`PATTERN_LIBRARY_EXTRA_HEADERS lines must read "Name: value"; got ${ JSON.stringify(
					trimmed.slice( 0, 40 )
				) }.`
			);
		}

		const headerValue = trimmed.slice( separator + 1 ).trim();

		// A workflow composing this block from CI secrets leaves a bare "Name:"
		// behind when a secret is unset. Treat that as "no header" rather than
		// sending an empty one.
		if ( headerValue ) {
			headers[ trimmed.slice( 0, separator ).trim() ] = headerValue;
		}
	}

	return headers;
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
