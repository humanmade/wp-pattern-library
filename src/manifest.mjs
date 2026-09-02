/**
 * Fetch and filter the site's pattern manifest.
 */

const SUPPORTED_MANIFEST_VERSION = 1;

/**
 * Build the URL of a preview route.
 *
 * Targets `/index.php` rather than `/`, because a site may have proxy or rewrite
 * rules that intercept the root path before WordPress sees the query var.
 *
 * @param {Object} config   Resolved configuration.
 * @param {string} slug     Pattern name, or `__manifest`.
 * @param {string} postType Optional post type to give the pattern query context.
 * @param {Object} wrapper  Optional group block attributes to wrap the pattern in.
 * @return {string} Absolute URL.
 */
export function previewUrl( config, slug, postType = '', wrapper = null ) {
	const params = new URLSearchParams( { 'pattern-library-preview': slug } );

	if ( postType ) {
		params.set( 'pattern-library-post-type', postType );
	}

	if ( wrapper ) {
		params.set( 'pattern-library-wrapper', JSON.stringify( wrapper ) );
	}

	if ( '__manifest' !== slug && config.placeholderImages ) {
		params.set( 'pattern-library-placeholder', '1' );
	}

	return `${ config.siteUrl }/index.php?${ params.toString() }`;
}

/**
 * HTTP Basic credentials for the application password.
 *
 * @param {Object} config Resolved configuration.
 * @return {string} Value for an Authorization header.
 */
export function authHeader( config ) {
	const encoded = Buffer.from(
		`${ config.username }:${ config.appPassword }`
	).toString( 'base64' );

	return `Basic ${ encoded }`;
}

/**
 * Fetch the manifest, and fail loudly on the ways this usually goes wrong.
 *
 * @param {Object} config Resolved configuration.
 * @return {Promise<Object>} Parsed manifest.
 */
export async function fetchManifest( config ) {
	const url = previewUrl( config, '__manifest' );
	const response = await fetch( url, {
		headers: { ...config.extraHeaders, Authorization: authHeader( config ) },
		redirect: 'follow',
	} );

	const body = await response.text();

	if ( response.status === 401 || response.status === 403 ) {
		throw new Error(
			`Authentication failed (HTTP ${ response.status }) for ${ config.username } at ${ url }. ` +
				'Check the application password, and that the user holds the view_pattern_library capability ' +
				'on this site (roles are per-site on multisite).'
		);
	}

	if ( ! response.ok ) {
		throw new Error( `Manifest request failed: HTTP ${ response.status } from ${ url }` );
	}

	let manifest;
	try {
		manifest = JSON.parse( body );
	} catch {
		throw new Error(
			`Expected JSON from ${ url } but got ${ response.headers.get( 'content-type' ) ?? 'unknown' }. ` +
				`Response starts: ${ JSON.stringify( body.slice( 0, 200 ) ) }. ` +
				'Is the wp-pattern-library plugin active on this site? An HTML login page here ' +
				'usually means an access proxy answered instead of WordPress — see extraHeaders.'
		);
	}

	if ( manifest.manifestVersion !== SUPPORTED_MANIFEST_VERSION ) {
		throw new Error(
			`Manifest version ${ manifest.manifestVersion } is not supported (expected ` +
				`${ SUPPORTED_MANIFEST_VERSION }). Update the wp-pattern-library package on the site or in this project.`
		);
	}

	// Optional features are advertised rather than versioned, so this is the only
	// place a site too old for what the config asks for gets caught. Left
	// unchecked, the site would ignore the wrapper query var and every variant
	// would capture as a duplicate of the pattern it varies.
	if ( config.variants.length && ! manifest.features?.includes( 'variants' ) ) {
		throw new Error(
			'This config declares `variants`, but the site does not support them. Update the ' +
				'wp-pattern-library plugin on the site to a version that advertises the "variants" feature.'
		);
	}

	return manifest;
}

/**
 * The viewport width a pattern is captured at.
 *
 * A pattern's declared Viewport Width wins when it is narrower — that is the
 * pattern saying it is designed for a small frame. `maxViewport` caps the other
 * direction, so one pattern declaring a wide viewport cannot force a capture
 * wider than the library's own frame.
 *
 * @param {Object} pattern Manifest pattern entry.
 * @param {Object} config  Resolved configuration.
 * @return {number} Width in CSS pixels.
 */
export function captureWidth( pattern, config ) {
	const declared = pattern.viewportWidth > 0 ? pattern.viewportWidth : config.defaultViewport;

	return config.maxViewport ? Math.min( declared, config.maxViewport ) : declared;
}

/**
 * The captures to take of one pattern: the pattern itself, then its variants.
 *
 * @param {Object} pattern Manifest pattern entry.
 * @param {Object} config  Resolved configuration.
 * @return {Array<{basename: string, variant: Object|null}>} Captures, plain one first.
 */
export function shotsFor( pattern, config ) {
	return [
		{ basename: pattern.basename, variant: null },
		...config.variants
			.filter( ( variant ) => variant.appliesTo( pattern ) )
			.map( ( variant ) => ( {
				basename: `${ pattern.basename }--${ variant.slug }`,
				variant,
			} ) ),
	];
}

/**
 * Apply namespace and exclusion rules to the manifest's patterns.
 *
 * Namespace filtering also happens server-side; repeating it here lets a project
 * narrow further without redeploying, and keeps the CLI honest when pointed at a
 * site configured differently.
 *
 * @param {Object} manifest Parsed manifest.
 * @param {Object} config   Resolved configuration.
 * @return {{patterns: Array, skipped: Array}} Kept and dropped patterns.
 */
export function filterPatterns( manifest, config ) {
	const { namespaces, exclude } = config;
	const patterns = [];
	const skipped = [];

	for ( const pattern of manifest.patterns ) {
		const reason = exclusionReason( pattern, namespaces, exclude );

		if ( reason ) {
			skipped.push( { ...pattern, reason } );
		} else {
			patterns.push( pattern );
		}
	}

	return { patterns, skipped };
}

/**
 * Why a pattern should be left out of the library, if it should.
 *
 * @param {Object}   pattern    Manifest pattern entry.
 * @param {string[]} namespaces Allowed name prefixes; empty allows all.
 * @param {Object}   exclude    Exclusion rules.
 * @return {string|null} Human-readable reason, or null to keep the pattern.
 */
function exclusionReason( pattern, namespaces, exclude ) {
	if (
		namespaces.length &&
		! namespaces.some( ( namespace ) => pattern.name.startsWith( namespace ) )
	) {
		return 'outside configured namespaces';
	}

	if ( exclude.patterns?.includes( pattern.name ) ) {
		return 'explicitly excluded';
	}

	if ( exclude.inserterHidden && pattern.inserter === false ) {
		return 'hidden from the inserter';
	}

	const blockedPostTypes = ( exclude.postTypes ?? [] ).filter( ( postType ) =>
		pattern.postTypes?.includes( postType )
	);
	if ( blockedPostTypes.length ) {
		return `scoped to ${ blockedPostTypes.join( ', ' ) }`;
	}

	return null;
}
