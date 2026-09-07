/**
 * URL construction, authentication, and the filtering that decides which of the
 * site's patterns belong in the library.
 *
 * fetchManifest() gets particular attention: every failure it reports is one
 * that would otherwise produce a run's worth of plausible but wrong output.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
	previewUrl,
	authHeader,
	fetchManifest,
	filterPatterns,
	shotsFor,
} from '../../src/manifest.mjs';

/**
 * A resolved-configuration stub, with only the keys these functions read.
 *
 * @param {Object} overrides Values to layer over the base stub.
 * @return {Object} Config stub.
 */
const config = ( overrides = {} ) => ( {
	siteUrl: 'https://example.com',
	username: 'bot',
	appPassword: 'abcd efgh',
	namespaces: [],
	exclude: { inserterHidden: true, postTypes: [], patterns: [] },
	variants: [],
	extraHeaders: {},
	placeholderImages: true,
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
	categories: [ 'banner' ],
	keywords: [],
	blockTypes: [],
	postTypes: [],
	viewportWidth: 0,
	inserter: true,
	...overrides,
} );

/**
 * Replace global fetch with one that answers every request identically.
 *
 * @param {Object} response             What every request is answered with.
 * @param {number} response.status      HTTP status code.
 * @param {string} response.body        Response body.
 * @param {string} response.contentType Content-Type header value.
 * @return {Function} The installed fetch stub, carrying the calls it received.
 */
function stubFetch( { status = 200, body = '', contentType = 'application/json' } ) {
	const calls = [];
	const stub = ( url, options ) => {
		calls.push( { url, options } );
		return Promise.resolve( {
			status,
			ok: status >= 200 && status < 300,
			text: () => Promise.resolve( body ),
			headers: { get: () => contentType },
		} );
	};
	stub.calls = calls;
	globalThis.fetch = stub;
	return stub;
}

const realFetch = globalThis.fetch;
afterEach( () => {
	globalThis.fetch = realFetch;
} );

describe( 'previewUrl', () => {
	test( 'targets index.php, so a rewrite on / cannot intercept the route', () => {
		const url = new URL( previewUrl( config(), 'hero' ) );

		assert.equal( url.origin + url.pathname, 'https://example.com/index.php' );
		assert.equal( url.searchParams.get( 'pattern-library-preview' ), 'hero' );
	} );

	test( 'asks for a placeholder featured image on a pattern, but not on the manifest', () => {
		const withPattern = new URL( previewUrl( config(), 'hero' ) );
		const withManifest = new URL( previewUrl( config(), '__manifest' ) );

		assert.equal( withPattern.searchParams.get( 'pattern-library-placeholder' ), '1' );
		assert.equal( withManifest.searchParams.get( 'pattern-library-placeholder' ), null );
	} );

	test( 'omits the placeholder when the project turned it off', () => {
		const url = new URL( previewUrl( config( { placeholderImages: false } ), 'hero' ) );

		assert.equal( url.searchParams.get( 'pattern-library-placeholder' ), null );
	} );

	test( 'carries post type and wrapper only when asked for', () => {
		const bare = new URL( previewUrl( config(), 'hero' ) );

		assert.equal( bare.searchParams.get( 'pattern-library-post-type' ), null );
		assert.equal( bare.searchParams.get( 'pattern-library-wrapper' ), null );

		const full = new URL(
			previewUrl( config(), 'person-card', 'person', { className: 'is-style-dark' } ),
		);

		assert.equal( full.searchParams.get( 'pattern-library-post-type' ), 'person' );
		// Data, not markup: the site rebuilds the group block from this JSON.
		assert.deepEqual( JSON.parse( full.searchParams.get( 'pattern-library-wrapper' ) ), {
			className: 'is-style-dark',
		} );
	} );
} );

describe( 'authHeader', () => {
	test( 'encodes the application password as HTTP Basic credentials', () => {
		const value = authHeader( config() );

		assert.match( value, /^Basic / );
		assert.equal(
			Buffer.from( value.slice( 6 ), 'base64' ).toString(),
			'bot:abcd efgh',
		);
	} );
} );

describe( 'fetchManifest', () => {
	const manifest = {
		manifestVersion: 1,
		features: [ 'variants' ],
		site: { name: 'Example', url: 'https://example.com/' },
		categories: [],
		patterns: [],
	};

	test( 'returns the parsed manifest, sending credentials and any extra headers', async () => {
		const fetchStub = stubFetch( { body: JSON.stringify( manifest ) } );

		const result = await fetchManifest(
			config( { extraHeaders: { 'CF-Access-Client-Id': 'abc.access' } } ),
		);

		assert.equal( result.manifestVersion, 1 );
		assert.equal( fetchStub.calls.length, 1 );
		assert.match( fetchStub.calls[ 0 ].options.headers.Authorization, /^Basic / );
		assert.equal(
			fetchStub.calls[ 0 ].options.headers[ 'CF-Access-Client-Id' ],
			'abc.access',
		);
	} );

	test( 'explains a 401 in terms of the capability and per-site roles', async () => {
		stubFetch( { status: 401, body: 'Authentication required.' } );

		await assert.rejects( fetchManifest( config() ), ( error ) => {
			assert.match( error.message, /Authentication failed \(HTTP 401\)/ );
			assert.match( error.message, /view_pattern_library/ );
			assert.match( error.message, /multisite/ );
			return true;
		} );
	} );

	test( 'points at an access proxy when HTML arrives instead of JSON', async () => {
		stubFetch( { body: '<!DOCTYPE html><title>Sign in</title>', contentType: 'text/html' } );

		await assert.rejects( fetchManifest( config() ), ( error ) => {
			assert.match( error.message, /Expected JSON/ );
			assert.match( error.message, /extraHeaders/ );
			return true;
		} );
	} );

	test( 'refuses a manifest version it does not understand', async () => {
		stubFetch( { body: JSON.stringify( { ...manifest, manifestVersion: 2 } ) } );

		await assert.rejects( fetchManifest( config() ), /Manifest version 2 is not supported/ );
	} );

	test( 'refuses to capture variants against a site too old to render them', async () => {
		stubFetch( { body: JSON.stringify( { ...manifest, features: [] } ) } );

		await assert.rejects(
			fetchManifest(
				config( {
					variants: [ { slug: 'dark', wrapper: {}, appliesTo: () => true } ],
				} ),
			),
			/does not support them/,
		);
	} );

	test( 'reports any other failing status with its URL', async () => {
		stubFetch( { status: 500, body: 'boom' } );

		await assert.rejects( fetchManifest( config() ), /HTTP 500/ );
	} );
} );

describe( 'filterPatterns', () => {
	/**
	 * Run the filter over a list of patterns.
	 *
	 * @param {Array}  patterns  Manifest pattern entries.
	 * @param {Object} overrides Config overrides.
	 * @return {Object} Kept and skipped patterns.
	 */
	const run = ( patterns, overrides = {} ) =>
		filterPatterns( { patterns }, config( overrides ) );

	test( 'keeps everything when nothing is configured to exclude it', () => {
		const { patterns, skipped } = run( [ pattern() ] );

		assert.equal( patterns.length, 1 );
		assert.equal( skipped.length, 0 );
	} );

	test( 'drops patterns outside the configured namespaces', () => {
		const { patterns, skipped } = run(
			[ pattern(), pattern( { name: 'core/banner', basename: 'banner' } ) ],
			{ namespaces: [ 'my-theme/' ] },
		);

		assert.deepEqual(
			patterns.map( ( item ) => item.name ),
			[ 'my-theme/hero' ],
		);
		assert.equal( skipped[ 0 ].reason, 'outside configured namespaces' );
	} );

	test( 'drops patterns hidden from the inserter, unless that is turned off', () => {
		const hidden = [ pattern( { inserter: false } ) ];

		assert.equal( run( hidden ).skipped[ 0 ].reason, 'hidden from the inserter' );
		assert.equal(
			run( hidden, { exclude: { inserterHidden: false, postTypes: [], patterns: [] } } )
				.patterns.length,
			1,
		);
	} );

	test( 'names the post types that got a pattern excluded', () => {
		const { skipped } = run( [ pattern( { postTypes: [ 'wp_template' ] } ) ], {
			exclude: {
				inserterHidden: true,
				postTypes: [ 'wp_template', 'wp_template_part' ],
				patterns: [],
			},
		} );

		assert.equal( skipped[ 0 ].reason, 'scoped to wp_template' );
	} );

	test( 'drops patterns named explicitly, by full name', () => {
		const { skipped } = run( [ pattern() ], {
			exclude: { inserterHidden: true, postTypes: [], patterns: [ 'my-theme/hero' ] },
		} );

		assert.equal( skipped[ 0 ].reason, 'explicitly excluded' );
	} );

	test( 'keeps the pattern entry intact on the skipped list, adding only a reason', () => {
		const { skipped } = run( [ pattern( { inserter: false } ) ] );

		assert.equal( skipped[ 0 ].name, 'my-theme/hero' );
		assert.equal( skipped[ 0 ].title, 'Hero' );
		assert.ok( skipped[ 0 ].reason );
	} );
} );

describe( 'shotsFor', () => {
	const dark = { slug: 'dark', label: 'Dark section', wrapper: {}, appliesTo: () => true };

	test( 'is just the pattern itself when no variants are configured', () => {
		assert.deepEqual( shotsFor( pattern(), config() ), [
			{ basename: 'hero', variant: null },
		] );
	} );

	test( 'puts the plain capture first, then one per applicable variant', () => {
		const shots = shotsFor( pattern(), config( { variants: [ dark ] } ) );

		assert.deepEqual(
			shots.map( ( shot ) => shot.basename ),
			[ 'hero', 'hero--dark' ],
		);
		assert.equal( shots[ 0 ].variant, null );
		assert.equal( shots[ 1 ].variant, dark );
	} );

	test( 'honours appliesTo, so a variant costs captures only where it means something', () => {
		const pages = {
			...dark,
			appliesTo: ( item ) => ! item.categories.includes( 'my-theme/pages' ),
		};

		assert.equal( shotsFor( pattern(), config( { variants: [ pages ] } ) ).length, 2 );
		assert.equal(
			shotsFor(
				pattern( { categories: [ 'my-theme/pages' ] } ),
				config( { variants: [ pages ] } ),
			).length,
			1,
		);
	} );
} );
