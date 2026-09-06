/**
 * Render the manifest as a Markdown pattern library.
 */

import { mkdir, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { shotsFor } from './manifest.mjs';

const exists = ( path ) =>
	access( path, constants.F_OK )
		.then( () => true )
		.catch( () => false );

/**
 * Build a GitHub-compatible heading anchor from heading text.
 *
 * @param {string} text Heading text.
 * @return {string} Anchor without the leading hash.
 */
export function anchor( text ) {
	return text
		.toLowerCase()
		.replace( /[^a-z0-9 -]+/g, '' )
		.trim()
		.replace( / /g, '-' );
}

/**
 * Pluralize a pattern count.
 *
 * @param {number} count Number of patterns.
 * @return {string} e.g. "1 pattern." or "12 patterns."
 */
const patternCount = ( count ) => `${ count } pattern${ count === 1 ? '' : 's' }.`;

/**
 * Group patterns into pages, one per registered category the classifier keeps.
 *
 * Categories keep the site's registration order, which is the order a project
 * chose to declare them in — more meaningful than alphabetical.
 *
 * @param {Object} manifest Parsed manifest.
 * @param {Array}  patterns Patterns that survived filtering.
 * @param {Object} config   Resolved configuration.
 * @return {Array} Page descriptors.
 */
export function buildPages( manifest, patterns, config ) {
	const byCategory = new Map();

	for ( const pattern of patterns ) {
		for ( const slug of pattern.categories ) {
			if ( ! byCategory.has( slug ) ) {
				byCategory.set( slug, [] );
			}
			byCategory.get( slug ).push( pattern );
		}
	}

	const pages = [];

	for ( const category of manifest.categories ) {
		const members = byCategory.get( category.slug );

		if ( ! members?.length ) {
			continue;
		}

		const placement = config.classify( category );

		if ( ! placement ) {
			continue; // A classifier may drop a category from the library entirely.
		}

		pages.push( {
			slug: category.slug,
			// Category slugs are commonly namespaced (`my-theme/hero`). Flatten the
			// separator so the slug cannot silently write into a subdirectory and
			// bypass the placement the classifier asked for.
			filename: category.slug.replace( /\//g, '-' ),
			label: placement.label ?? category.label,
			kind: placement.kind ?? 'category',
			dir: placement.dir ?? '.',
			leadsIn: placement.leadsIn ?? null,
			description: placement.description ?? '',
			patterns: [ ...members ].sort( ( a, b ) => a.title.localeCompare( b.title ) ),
		} );
	}

	return pages;
}

/**
 * Categories whose patterns lead the pages of another kind.
 *
 * A project may mark a cross-cutting category — say, whole-page references — as
 * leading the pages of a given kind, so those patterns appear in a highlighted
 * section at the top rather than mixed into the list.
 *
 * @param {Array} pages Page descriptors.
 * @return {Map<string, Set<string>>} Target kind to the pattern names that lead it.
 */
function buildLeaders( pages ) {
	const leaders = new Map();

	for ( const page of pages.filter( ( candidate ) => candidate.leadsIn ) ) {
		if ( ! leaders.has( page.leadsIn ) ) {
			leaders.set( page.leadsIn, new Set() );
		}
		const names = leaders.get( page.leadsIn );
		page.patterns.forEach( ( pattern ) => names.add( pattern.name ) );
	}

	return leaders;
}

/**
 * Render one pattern as a Markdown section.
 *
 * @param {Object} pattern      Manifest pattern entry.
 * @param {string} shotsRelPath Screenshot directory, relative to the page.
 * @param {Object} config       Resolved configuration.
 * @param {Set}    haveShots    Basenames with a screenshot on disk.
 * @param {Map}    labels       Category slug to display label.
 * @return {string} Markdown.
 */
function renderPattern( pattern, shotsRelPath, config, haveShots, labels ) {
	const lines = [ `### ${ pattern.title }`, '', `\`${ pattern.name }\``, '' ];

	// The plain capture leads; each variant that produced an image follows it
	// under its own label, so the treatments read as one pattern rather than as
	// unrelated entries. Captions appear only when there is something to tell
	// apart — a pattern with no variant needs no label on its only image.
	const shots = shotsFor( pattern, config ).filter( ( shot ) =>
		haveShots.has( shot.basename ),
	);
	const captioned = shots.length > 1;

	if ( ! shots.length ) {
		lines.push( '_Preview pending._', '' );
	}

	for ( const shot of shots ) {
		const file = `${ shot.basename }.${ config.imageFormat }`;
		const caption = shot.variant ? shot.variant.label : config.baseLabel;
		const alt = captioned ? `${ pattern.title } — ${ caption }` : pattern.title;

		if ( captioned ) {
			lines.push( `_${ caption }_`, '' );
		}

		lines.push( `![${ alt }](${ shotsRelPath }/${ file })`, '' );
	}

	if ( pattern.description ) {
		lines.push( pattern.description, '' );
	}

	const meta = [];
	const categories = pattern.categories
		.map( ( slug ) => labels.get( slug ) )
		.filter( Boolean );

	if ( categories.length ) {
		meta.push( `**Categories:** ${ categories.join( ', ' ) }` );
	}
	if ( pattern.keywords.length ) {
		meta.push( `**Keywords:** ${ pattern.keywords.join( ', ' ) }` );
	}
	if ( pattern.blockTypes?.length ) {
		meta.push( `**Block types:** ${ code( pattern.blockTypes ) }` );
	}
	if ( pattern.postTypes?.length ) {
		meta.push( `**Post types:** ${ code( pattern.postTypes ) }` );
	}
	if ( pattern.viewportWidth > 0 ) {
		meta.push( `**Viewport:** ${ pattern.viewportWidth }px` );
	}
	if ( pattern.inserter === false ) {
		meta.push( '**Inserter:** hidden' );
	}

	for ( const field of config.extraFields ) {
		const raw =
			typeof field.value === 'function' ? field.value( pattern ) : pattern[ field.value ];
		const value = Array.isArray( raw ) ? raw.join( ', ' ) : raw;

		if ( value ) {
			meta.push( `**${ field.label }:** ${ value }` );
		}
	}

	if ( meta.length ) {
		lines.push( meta.join( '  \n' ), '' );
	}

	return lines.join( '\n' );
}

/**
 * Render a list of technical identifiers as inline code.
 *
 * @param {string[]} values Identifiers, e.g. block or post type names.
 * @return {string} Comma-separated inline code.
 */
const code = ( values ) => values.map( ( value ) => `\`${ value }\`` ).join( ', ' );

/**
 * Write every category page and the index.
 *
 * @param {Object} manifest Parsed manifest.
 * @param {Array}  patterns Patterns that survived filtering.
 * @param {Object} config   Resolved configuration.
 * @param {Array}  skipped  Patterns dropped by filtering, with their reasons.
 * @return {Promise<{pages: number, index: string}>} Summary.
 */
export async function generate( manifest, patterns, config, skipped = [] ) {
	const pages = buildPages( manifest, patterns, config );
	const leaders = buildLeaders( pages );
	const labels = new Map( pages.map( ( page ) => [ page.slug, page.label ] ) );

	const haveShots = new Set();
	await Promise.all(
		patterns
			.flatMap( ( pattern ) => shotsFor( pattern, config ) )
			.map( async ( shot ) => {
				const file = join(
					config.screenshotsDir,
					`${ shot.basename }.${ config.imageFormat }`,
				);
				if ( await exists( file ) ) {
					haveShots.add( shot.basename );
				}
			} ),
	);

	for ( const page of pages ) {
		const path = resolve( config.outputDir, page.dir, `${ page.filename }.md` );
		await mkdir( dirname( path ), { recursive: true } );

		const shotsRelPath = toPosix(
			relative( dirname( path ), config.screenshotsDir ),
		);
		const indexRelPath = toPosix( relative( dirname( path ), config.indexFile ) );

		const leadNames = leaders.get( page.kind ) ?? new Set();
		const lead = page.patterns.filter( ( pattern ) => leadNames.has( pattern.name ) );
		const rest = page.patterns.filter( ( pattern ) => ! leadNames.has( pattern.name ) );

		const out = [
			`# ${ page.label }`,
			'',
			`[← ${ config.title }](${ indexRelPath })`,
			'',
			patternCount( page.patterns.length ),
			'',
		];

		if ( page.description ) {
			out.push( page.description, '' );
		}

		out.push( '## Contents', '' );
		out.push(
			...[ ...lead, ...rest ].map(
				( pattern ) => `- [${ pattern.title }](#${ anchor( pattern.title ) })`,
			),
			'',
		);

		const section = ( list ) =>
			list.flatMap( ( pattern, index ) => [
				...( index ? [ '---', '' ] : [] ),
				renderPattern( pattern, shotsRelPath, config, haveShots, labels ),
			] );

		if ( lead.length ) {
			out.push( '## Full page references', '' );
			out.push( ...section( lead ) );
			out.push( '## Sections', '' );
		}

		out.push( ...section( rest ) );

		await writeFile( path, `${ out.join( '\n' ).trimEnd() }\n` );
	}

	await writeIndex( pages, patterns, config, skipped );

	return { pages: pages.length, index: config.indexFile };
}

/**
 * Write the index page, grouping the category pages by kind.
 *
 * @param {Array}  pages    Page descriptors.
 * @param {Array}  patterns Patterns that survived filtering.
 * @param {Object} config   Resolved configuration.
 * @param {Array}  skipped  Patterns dropped by filtering, with their reasons.
 */
async function writeIndex( pages, patterns, config, skipped ) {
	await mkdir( dirname( config.indexFile ), { recursive: true } );

	const kinds = [ ...new Set( pages.map( ( page ) => page.kind ) ) ];
	const uncategorized = patterns.filter( ( pattern ) =>
		! pattern.categories.some( ( slug ) =>
			pages.some( ( page ) => page.slug === slug ),
		),
	);

	const out = [
		`# ${ config.title }`,
		'',
		'> Generated by [@humanmade/wp-pattern-library](https://github.com/humanmade/wp-pattern-library).',
		'> Do not edit by hand.',
		'',
		`${ patterns.length } patterns across ${ pages.length } categories.`,
		'',
	];

	for ( const kind of kinds ) {
		const group = pages.filter( ( page ) => page.kind === kind );

		if ( kinds.length > 1 ) {
			out.push( `## ${ titleCase( kind ) }`, '' );
		}

		for ( const page of group ) {
			const rel = toPosix(
				relative(
					dirname( config.indexFile ),
					resolve( config.outputDir, page.dir, `${ page.filename }.md` ),
				),
			);
			out.push( `- [${ page.label }](${ rel }) (${ page.patterns.length })` );
		}
		out.push( '' );
	}

	if ( uncategorized.length ) {
		out.push(
			'## Uncategorized',
			'',
			'_These patterns carry no category that appears above._',
			'',
		);
		out.push( ...uncategorized.map( ( pattern ) => `- \`${ pattern.name }\`` ), '' );
	}

	if ( config.includeSkipped && skipped.length ) {
		out.push(
			'## Not included',
			'',
			'_Registered on the site, but excluded from this library by configuration._',
			'',
		);
		out.push(
			...skipped.map( ( pattern ) => `- \`${ pattern.name }\` — ${ pattern.reason }` ),
			'',
		);
	}

	await writeFile( config.indexFile, `${ out.join( '\n' ).trimEnd() }\n` );
}

/**
 * Normalize a path for Markdown links on any platform.
 *
 * @param {string} path Relative path.
 * @return {string} Path with forward slashes.
 */
const toPosix = ( path ) => path.split( /[\\/]/ ).join( '/' );

/**
 * Capitalize a kind name for an index heading.
 *
 * @param {string} value Kind identifier.
 * @return {string} Display heading.
 */
const titleCase = ( value ) =>
	value.charAt( 0 ).toUpperCase() + value.slice( 1 ).replace( /-/g, ' ' ) + 's';
