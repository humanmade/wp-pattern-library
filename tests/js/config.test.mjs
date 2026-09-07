/**
 * Configuration loading: defaults, layering, and the validation that turns a
 * config-file typo into an error rather than a surprising capture run.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';

import { loadConfig, requireConfig, flatClassify } from '../../src/config.mjs';

const ENV_KEYS = [
	'PATTERN_LIBRARY_SITE',
	'PATTERN_LIBRARY_WP_USER',
	'PATTERN_LIBRARY_WP_APP_PASSWORD',
	'PATTERN_LIBRARY_EXTRA_HEADERS',
];

let cwd;
let savedEnv;

beforeEach( async () => {
	cwd = await mkdtemp( join( tmpdir(), 'pattern-library-config-' ) );
	savedEnv = Object.fromEntries( ENV_KEYS.map( ( key ) => [ key, process.env[ key ] ] ) );
	ENV_KEYS.forEach( ( key ) => delete process.env[ key ] );
} );

afterEach( async () => {
	await rm( cwd, { recursive: true, force: true } );
	for ( const [ key, value ] of Object.entries( savedEnv ) ) {
		if ( value === undefined ) {
			delete process.env[ key ];
		} else {
			process.env[ key ] = value;
		}
	}
} );

/**
 * Write a config file into the temporary project directory.
 *
 * Each file gets a unique name so Node's module cache cannot serve a previous
 * test's config back to a later one.
 *
 * @param {string} source Module source for the config file.
 * @return {Promise<string>} The directory the config was written into.
 */
async function writeConfig( source ) {
	const dir = await mkdtemp( join( cwd, 'project-' ) );
	await writeFile( join( dir, 'pattern-library.config.js' ), source );
	return dir;
}

describe( 'loadConfig', () => {
	test( 'applies defaults when there is no config file', async () => {
		const config = await loadConfig( cwd );

		assert.equal( config.title, 'Pattern Library' );
		assert.equal( config.imageFormat, 'webp' );
		assert.equal( config.defaultViewport, 1440 );
		assert.deepEqual( config.namespaces, [] );
		assert.equal( config.configPath, null );
		assert.equal( config.exclude.inserterHidden, true );
		assert.deepEqual( config.exclude.postTypes, [ 'wp_template', 'wp_template_part' ] );
	} );

	test( 'resolves output paths to absolute paths under the working directory', async () => {
		const config = await loadConfig( cwd );

		assert.ok( isAbsolute( config.outputDir ) );
		assert.equal( config.outputDir, join( cwd, 'docs/pattern-library' ) );
		assert.equal( config.screenshotsDir, join( cwd, 'docs/pattern-library/screenshots' ) );
		assert.equal( config.indexFile, join( cwd, 'docs/pattern-library/README.md' ) );
	} );

	test( 'reads a config file and records its path', async () => {
		const dir = await writeConfig(
			'export default { title: "My Library", namespaces: [ "my-theme/" ] };',
		);
		const config = await loadConfig( dir );

		assert.equal( config.title, 'My Library' );
		assert.deepEqual( config.namespaces, [ 'my-theme/' ] );
		assert.equal( config.configPath, join( dir, 'pattern-library.config.js' ) );
	} );

	test( 'merges `exclude` with the defaults rather than replacing it', async () => {
		const dir = await writeConfig(
			'export default { exclude: { patterns: [ "my-theme/wip" ] } };',
		);
		const config = await loadConfig( dir );

		assert.deepEqual( config.exclude.patterns, [ 'my-theme/wip' ] );
		// Not clobbered by the partial override.
		assert.equal( config.exclude.inserterHidden, true );
		assert.deepEqual( config.exclude.postTypes, [ 'wp_template', 'wp_template_part' ] );
	} );

	test( 'takes credentials from the environment, and trims a trailing slash', async () => {
		process.env.PATTERN_LIBRARY_SITE = 'https://example.com/';
		process.env.PATTERN_LIBRARY_WP_USER = 'bot';
		process.env.PATTERN_LIBRARY_WP_APP_PASSWORD = 'abcd efgh';

		const config = await loadConfig( cwd );

		assert.equal( config.siteUrl, 'https://example.com' );
		assert.equal( config.username, 'bot' );
		assert.equal( config.appPassword, 'abcd efgh' );
	} );

	test( 'lets the environment win over the config file, and CLI flags over both', async () => {
		process.env.PATTERN_LIBRARY_SITE = 'https://from-env.example';
		const dir = await writeConfig( 'export default { siteUrl: "https://from-file.example" };' );

		assert.equal( ( await loadConfig( dir ) ).siteUrl, 'https://from-env.example' );
		assert.equal(
			( await loadConfig( dir, { siteUrl: 'https://from-flag.example' } ) ).siteUrl,
			'https://from-flag.example',
		);
	} );

	test( 'ignores empty overrides so they cannot mask a lower layer', async () => {
		const dir = await writeConfig( 'export default { title: "Kept" };' );
		const config = await loadConfig( dir, { title: '', outputDir: undefined } );

		assert.equal( config.title, 'Kept' );
	} );

	test( 'defaults `classify` to one page per category in the output root', async () => {
		const config = await loadConfig( cwd );

		assert.equal( config.classify, flatClassify );
		assert.deepEqual( config.classify( { slug: 'hero', label: 'Hero' } ), {
			kind: 'category',
			dir: '.',
			label: 'Hero',
		} );
	} );
} );

describe( 'extraHeaders', () => {
	test( 'parses newline-delimited "Name: value" lines from the environment', async () => {
		process.env.PATTERN_LIBRARY_EXTRA_HEADERS =
			'CF-Access-Client-Id: abc.access\nCF-Access-Client-Secret: shhh';

		const config = await loadConfig( cwd );

		assert.deepEqual( config.extraHeaders, {
			'CF-Access-Client-Id': 'abc.access',
			'CF-Access-Client-Secret': 'shhh',
		} );
	} );

	test( 'keeps colons in the value, splitting only on the first one', async () => {
		process.env.PATTERN_LIBRARY_EXTRA_HEADERS = 'X-Origin: https://example.com:8443';

		const config = await loadConfig( cwd );

		assert.equal( config.extraHeaders[ 'X-Origin' ], 'https://example.com:8443' );
	} );

	test( 'drops a bare "Name:" left behind by an unset CI secret', async () => {
		process.env.PATTERN_LIBRARY_EXTRA_HEADERS = 'X-Set: yes\nX-Unset:\n\n';

		const config = await loadConfig( cwd );

		assert.deepEqual( config.extraHeaders, { 'X-Set': 'yes' } );
	} );

	test( 'merges environment headers over non-secret ones from the config file', async () => {
		process.env.PATTERN_LIBRARY_EXTRA_HEADERS = 'X-Token: secret';
		const dir = await writeConfig(
			'export default { extraHeaders: { "X-Environment": "production", "X-Token": "placeholder" } };',
		);

		const config = await loadConfig( dir );

		assert.deepEqual( config.extraHeaders, {
			'X-Environment': 'production',
			'X-Token': 'secret',
		} );
	} );

	test( 'rejects a line that is not a header', async () => {
		process.env.PATTERN_LIBRARY_EXTRA_HEADERS = 'not a header line';

		await assert.rejects( loadConfig( cwd ), /must read "Name: value"/ );
	} );
} );

describe( 'variants', () => {
	test( 'defaults the label to a title-cased slug and applies to every pattern', async () => {
		const dir = await writeConfig(
			'export default { variants: [ { slug: "dark-section", wrapper: { className: "is-style-dark" } } ] };',
		);

		const [ variant ] = ( await loadConfig( dir ) ).variants;

		assert.equal( variant.slug, 'dark-section' );
		assert.equal( variant.label, 'Dark Section' );
		assert.equal( variant.appliesTo( { name: 'my-theme/anything' } ), true );
	} );

	test( 'keeps an explicit label and predicate', async () => {
		const dir = await writeConfig(
			`export default { variants: [ {
				slug: 'dark',
				label: 'Dark section',
				wrapper: { backgroundColor: 'shark' },
				appliesTo: ( pattern ) => pattern.name !== 'my-theme/skip',
			} ] };`,
		);

		const [ variant ] = ( await loadConfig( dir ) ).variants;

		assert.equal( variant.label, 'Dark section' );
		assert.equal( variant.appliesTo( { name: 'my-theme/skip' } ), false );
		assert.equal( variant.appliesTo( { name: 'my-theme/hero' } ), true );
	} );

	test( 'rejects a slug that would not survive a filename round trip', async () => {
		for ( const slug of [ 'Dark', 'dark section', 'dark/section', '-dark', '' ] ) {
			const dir = await writeConfig(
				`export default { variants: [ { slug: ${ JSON.stringify(
					slug,
				) }, wrapper: { className: 'x' } } ] };`,
			);

			await assert.rejects( loadConfig( dir ), /must be a lowercase kebab-case string/ );
		}
	} );

	test( 'rejects duplicate slugs, which would collide on disk', async () => {
		const dir = await writeConfig(
			`export default { variants: [
				{ slug: 'dark', wrapper: { className: 'a' } },
				{ slug: 'dark', wrapper: { className: 'b' } },
			] };`,
		);

		await assert.rejects( loadConfig( dir ), /duplicate variant slug "dark"/ );
	} );

	test( 'rejects a missing or empty wrapper', async () => {
		for ( const wrapper of [ 'undefined', '{}', '[]', '"is-style-dark"' ] ) {
			const dir = await writeConfig(
				`export default { variants: [ { slug: 'dark', wrapper: ${ wrapper } } ] };`,
			);

			await assert.rejects( loadConfig( dir ), /must be a non-empty object/ );
		}
	} );

	test( 'rejects a non-function appliesTo', async () => {
		const dir = await writeConfig(
			`export default { variants: [ { slug: 'dark', wrapper: { className: 'x' }, appliesTo: true } ] };`,
		);

		await assert.rejects( loadConfig( dir ), /appliesTo must be a function/ );
	} );

	test( 'rejects a non-array `variants`', async () => {
		const dir = await writeConfig( 'export default { variants: { slug: "dark" } };' );

		await assert.rejects( loadConfig( dir ), /`variants` must be an array/ );
	} );
} );

describe( 'requireConfig', () => {
	test( 'passes when every required key carries a value', () => {
		assert.doesNotThrow( () =>
			requireConfig( { siteUrl: 'https://example.com', username: 'bot' }, [
				'siteUrl',
				'username',
			] ),
		);
	} );

	test( 'names each missing key and how to set it', () => {
		assert.throws(
			() => requireConfig( { siteUrl: '' }, [ 'siteUrl', 'username', 'appPassword' ] ),
			( error ) => {
				assert.match( error.message, /--site or PATTERN_LIBRARY_SITE/ );
				assert.match( error.message, /PATTERN_LIBRARY_WP_USER/ );
				assert.match( error.message, /PATTERN_LIBRARY_WP_APP_PASSWORD/ );
				return true;
			},
		);
	} );
} );
