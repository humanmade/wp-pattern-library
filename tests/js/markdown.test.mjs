/**
 * Markdown generation: how categories become pages, and what one pattern's
 * section says about it.
 *
 * These write into a temporary directory and read the result back, because the
 * output is the product — a unit test of the string builders would not catch a
 * page written to the wrong path or a link that does not resolve.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { anchor, buildPages, generate } from '../../src/markdown.mjs';
import { flatClassify } from '../../src/config.mjs';

let dir;

beforeEach( async () => {
	dir = await mkdtemp( join( tmpdir(), 'pattern-library-markdown-' ) );
} );

afterEach( async () => {
	await rm( dir, { recursive: true, force: true } );
} );

/**
 * A resolved-configuration stub rooted in the temporary directory.
 *
 * @param {Object} overrides Values to layer over the base stub.
 * @return {Object} Config stub.
 */
const config = ( overrides = {} ) => ( {
	title: 'Pattern Library',
	outputDir: join( dir, 'out' ),
	indexFile: join( dir, 'out', 'README.md' ),
	screenshotsDir: join( dir, 'out', 'screenshots' ),
	imageFormat: 'webp',
	classify: flatClassify,
	variants: [],
	extraFields: [],
	baseLabel: 'Default rendering',
	includeSkipped: true,
	...overrides,
} );

/**
 * A manifest pattern entry.
 *
 * @param {Object} overrides Values to layer over the base entry.
 * @return {Object} Pattern stub.
 */
const pattern = ( overrides = {} ) => ( {
	name: 'my-theme/hero',
	basename: 'hero',
	title: 'Hero',
	description: '',
	categories: [ 'banner' ],
	keywords: [],
	blockTypes: [],
	postTypes: [],
	viewportWidth: 0,
	inserter: true,
	source: 'theme',
	...overrides,
} );

/**
 * Place a screenshot file, so generation believes the capture happened.
 *
 * @param {string} basename Screenshot basename, without extension.
 */
async function placeShot( basename ) {
	await mkdir( join( dir, 'out', 'screenshots' ), { recursive: true } );
	await writeFile( join( dir, 'out', 'screenshots', `${ basename }.webp` ), 'not-really-webp' );
}

/**
 * Read a generated file relative to the output directory.
 *
 * @param {string} relativePath Path under outputDir.
 * @return {Promise<string>} File contents.
 */
const read = ( relativePath ) => readFile( join( dir, 'out', relativePath ), 'utf8' );

describe( 'anchor', () => {
	test( 'matches how GitHub slugs a heading', () => {
		assert.equal( anchor( 'Hero' ), 'hero' );
		assert.equal( anchor( 'Call to action' ), 'call-to-action' );
		assert.equal( anchor( 'Hero — with image' ), 'hero--with-image' );
		assert.equal( anchor( "Editor's picks (2026)" ), 'editors-picks-2026' );
	} );
} );

describe( 'buildPages', () => {
	const manifest = {
		categories: [
			{ slug: 'banner', label: 'Banners' },
			{ slug: 'text', label: 'Text' },
			{ slug: 'empty', label: 'Empty' },
		],
	};

	test( 'makes one page per category that has patterns, in registration order', () => {
		const pages = buildPages(
			manifest,
			[ pattern(), pattern( { name: 'my-theme/quote', basename: 'quote', title: 'Quote', categories: [ 'text' ] } ) ],
			config(),
		);

		assert.deepEqual(
			pages.map( ( page ) => page.slug ),
			[ 'banner', 'text' ],
		);
		// A category nothing is filed under gets no page at all.
		assert.equal( pages.some( ( page ) => page.slug === 'empty' ), false );
	} );

	test( 'files a pattern under every category it declares', () => {
		const pages = buildPages(
			manifest,
			[ pattern( { categories: [ 'banner', 'text' ] } ) ],
			config(),
		);

		assert.equal( pages.length, 2 );
		assert.equal( pages[ 0 ].patterns.length, 1 );
		assert.equal( pages[ 1 ].patterns.length, 1 );
	} );

	test( 'sorts patterns within a page by title', () => {
		const pages = buildPages(
			manifest,
			[
				pattern( { name: 'my-theme/z', basename: 'z', title: 'Zebra' } ),
				pattern( { name: 'my-theme/a', basename: 'a', title: 'Apple' } ),
			],
			config(),
		);

		assert.deepEqual(
			pages[ 0 ].patterns.map( ( item ) => item.title ),
			[ 'Apple', 'Zebra' ],
		);
	} );

	test( 'flattens a namespaced category slug so it cannot write into a subdirectory', () => {
		const pages = buildPages(
			{ categories: [ { slug: 'my-theme/hero', label: 'Hero' } ] },
			[ pattern( { categories: [ 'my-theme/hero' ] } ) ],
			config(),
		);

		assert.equal( pages[ 0 ].filename, 'my-theme-hero' );
	} );

	test( 'lets a classifier place, relabel, and drop categories', () => {
		const pages = buildPages(
			manifest,
			[ pattern(), pattern( { name: 'my-theme/quote', basename: 'quote', title: 'Quote', categories: [ 'text' ] } ) ],
			config( {
				classify: ( { slug, label } ) =>
					slug === 'text'
						? null
						: { kind: 'section', dir: 'sections', label: `${ label } (section)` },
			} ),
		);

		assert.equal( pages.length, 1 );
		assert.equal( pages[ 0 ].kind, 'section' );
		assert.equal( pages[ 0 ].dir, 'sections' );
		assert.equal( pages[ 0 ].label, 'Banners (section)' );
	} );
} );

describe( 'generate', () => {
	const manifest = { categories: [ { slug: 'banner', label: 'Banners' } ] };

	test( 'writes an index and one page per category, and reports what it wrote', async () => {
		const resolved = config();
		const result = await generate( manifest, [ pattern() ], resolved );

		assert.equal( result.pages, 1 );
		assert.equal( result.index, resolved.indexFile );

		const index = await read( 'README.md' );
		assert.match( index, /^# Pattern Library$/m );
		assert.match( index, /1 patterns across 1 categories\./ );
		assert.match( index, /- \[Banners\]\(banner\.md\) \(1\)/ );

		const page = await read( 'banner.md' );
		assert.match( page, /^# Banners$/m );
		assert.match( page, /\[← Pattern Library\]\(README\.md\)/ );
		assert.match( page, /^### Hero$/m );
		assert.match( page, /`my-theme\/hero`/ );
	} );

	test( 'links the index to a repository that exists', async () => {
		await generate( manifest, [ pattern() ], config() );

		const index = await read( 'README.md' );
		assert.match( index, /github\.com\/humanmade\/wp-pattern-library/ );
	} );

	test( 'says a preview is pending when no screenshot was captured', async () => {
		await generate( manifest, [ pattern() ], config() );

		assert.match( await read( 'banner.md' ), /_Preview pending\._/ );
	} );

	test( 'embeds the screenshot, uncaptioned, when a pattern has no variants', async () => {
		await placeShot( 'hero' );
		await generate( manifest, [ pattern() ], config() );

		const page = await read( 'banner.md' );
		assert.match( page, /!\[Hero\]\(screenshots\/hero\.webp\)/ );
		assert.doesNotMatch( page, /_Default rendering_/ );
	} );

	test( 'captions every image once a pattern has a variant to tell apart', async () => {
		await placeShot( 'hero' );
		await placeShot( 'hero--dark' );

		await generate(
			manifest,
			[ pattern() ],
			config( {
				variants: [
					{ slug: 'dark', label: 'Dark section', wrapper: {}, appliesTo: () => true },
				],
			} ),
		);

		const page = await read( 'banner.md' );
		assert.match( page, /_Default rendering_/ );
		assert.match( page, /!\[Hero — Default rendering\]\(screenshots\/hero\.webp\)/ );
		assert.match( page, /_Dark section_/ );
		assert.match( page, /!\[Hero — Dark section\]\(screenshots\/hero--dark\.webp\)/ );
		// Plain capture first.
		assert.ok( page.indexOf( 'hero.webp' ) < page.indexOf( 'hero--dark.webp' ) );
	} );

	test( 'renders the metadata a pattern declares, and omits what it does not', async () => {
		await generate(
			manifest,
			[
				pattern( {
					description: 'A big hero.',
					keywords: [ 'banner', 'masthead' ],
					blockTypes: [ 'core/group' ],
					viewportWidth: 1280,
				} ),
			],
			config(),
		);

		const page = await read( 'banner.md' );
		assert.match( page, /A big hero\./ );
		assert.match( page, /\*\*Categories:\*\* Banners/ );
		assert.match( page, /\*\*Keywords:\*\* banner, masthead/ );
		assert.match( page, /\*\*Block types:\*\* `core\/group`/ );
		assert.match( page, /\*\*Viewport:\*\* 1280px/ );
		assert.doesNotMatch( page, /\*\*Post types:\*\*/ );
	} );

	test( 'appends extraFields, from a property name or a function', async () => {
		await generate(
			manifest,
			[ pattern() ],
			config( {
				extraFields: [
					{ label: 'Source', value: 'source' },
					{ label: 'Namespace', value: ( item ) => item.name.split( '/' )[ 0 ] },
				],
			} ),
		);

		const page = await read( 'banner.md' );
		assert.match( page, /\*\*Source:\*\* theme/ );
		assert.match( page, /\*\*Namespace:\*\* my-theme/ );
	} );

	test( 'writes a page into the directory its classifier chose, with working links', async () => {
		await generate(
			manifest,
			[ pattern() ],
			config( {
				classify: ( { label } ) => ( { kind: 'section', dir: 'sections', label } ),
			} ),
		);

		const page = await read( 'sections/banner.md' );
		// Both links have to climb out of sections/ to resolve.
		assert.match( page, /\[← Pattern Library\]\(\.\.\/README\.md\)/ );
		assert.match( await read( 'README.md' ), /\(sections\/banner\.md\)/ );
	} );

	test( 'promotes a leadsIn category to the top of the pages it leads', async () => {
		const twoCategories = {
			categories: [
				{ slug: 'full-page', label: 'Full page' },
				{ slug: 'banner', label: 'Banners' },
			],
		};

		await generate(
			twoCategories,
			[
				pattern( {
					name: 'my-theme/homepage',
					basename: 'homepage',
					title: 'Homepage',
					categories: [ 'full-page', 'banner' ],
				} ),
				pattern(),
			],
			config( {
				classify: ( { slug, label } ) =>
					slug === 'full-page'
						? { kind: 'reference', dir: '.', label, leadsIn: 'section' }
						: { kind: 'section', dir: '.', label },
			} ),
		);

		const page = await read( 'banner.md' );
		assert.match( page, /## Full page references/ );
		assert.match( page, /## Sections/ );
		assert.ok( page.indexOf( '### Homepage' ) < page.indexOf( '### Hero' ) );
	} );

	test( 'lists patterns whose categories produced no page as uncategorized', async () => {
		await generate( manifest, [ pattern( { categories: [ 'nowhere' ] } ) ], config() );

		const index = await read( 'README.md' );
		assert.match( index, /## Uncategorized/ );
		assert.match( index, /- `my-theme\/hero`/ );
	} );

	test( 'reports skipped patterns with their reasons, unless asked not to', async () => {
		const skipped = [ { ...pattern(), reason: 'hidden from the inserter' } ];

		await generate( manifest, [], config(), skipped );
		const withSkipped = await read( 'README.md' );
		assert.match( withSkipped, /## Not included/ );
		assert.match( withSkipped, /- `my-theme\/hero` — hidden from the inserter/ );

		await generate( manifest, [], config( { includeSkipped: false } ), skipped );
		assert.doesNotMatch( await read( 'README.md' ), /## Not included/ );
	} );

	test( 'groups the index by kind only when there is more than one', async () => {
		const flat = await generate( manifest, [ pattern() ], config() );
		assert.equal( flat.pages, 1 );
		assert.doesNotMatch( await read( 'README.md' ), /^## Categorys/m );

		await generate(
			{
				categories: [
					{ slug: 'banner', label: 'Banners' },
					{ slug: 'text', label: 'Text' },
				],
			},
			[
				pattern(),
				pattern( { name: 'my-theme/quote', basename: 'quote', title: 'Quote', categories: [ 'text' ] } ),
			],
			config( {
				classify: ( { slug, label } ) =>
					slug === 'banner'
						? { kind: 'section', dir: '.', label }
						: { kind: 'component', dir: '.', label },
			} ),
		);

		const index = await read( 'README.md' );
		assert.match( index, /^## Sections$/m );
		assert.match( index, /^## Components$/m );
	} );
} );
