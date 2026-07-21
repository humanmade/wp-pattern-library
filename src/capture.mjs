/**
 * Screenshot each pattern with Playwright.
 */

import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { previewUrl } from './manifest.mjs';

/**
 * CSS injected before capture.
 *
 * Reduced-motion (set on the context) handles a theme's own animations, but
 * scroll-triggered libraries reveal `[data-aos]` blocks by adding a class only as
 * they scroll into view, and commonly re-hide anything off screen. A tall capture
 * would lose every below-the-fold section, so force the revealed end state.
 */
const REVEAL_CSS = `
	[data-aos] {
		opacity: 1 !important;
		transform: none !important;
		transition: none !important;
	}
`;

/**
 * Bring a loaded pattern to its finished, fully-painted state.
 *
 * @param {import('playwright').Page} page Loaded preview page.
 */
async function prepareForCapture( page ) {
	await page.addStyleTag( { content: REVEAL_CSS } );

	await page.evaluate( async () => {
		document
			.querySelectorAll( '[data-aos]' )
			.forEach( ( el ) => el.classList.add( 'aos-animate' ) );

		// Walk the full height so intersection- and scroll-triggered content (and
		// native lazy images) start loading, then return to the top.
		const step = window.innerHeight || 800;
		for ( let y = 0; y <= document.body.scrollHeight; y += step ) {
			window.scrollTo( 0, y );
			await new Promise( ( r ) => setTimeout( r, 40 ) );
		}
		window.scrollTo( 0, 0 );

		// Force still-lazy images to fetch, then await decode so the capture never
		// lands on an undecoded (blank) image.
		const images = Array.from( document.images );
		images.forEach( ( image ) => {
			if ( image.loading === 'lazy' ) {
				image.loading = 'eager';
			}
		} );
		await Promise.all(
			images.map( ( image ) =>
				image.complete ? Promise.resolve() : image.decode().catch( () => {} )
			)
		);
	} );
}

/**
 * Confirm the browser context is authenticating, before capturing anything.
 *
 * Playwright and Node's fetch authenticate independently, so a working manifest
 * fetch does not prove the browser is authenticated. An unauthenticated preview
 * returns HTTP 200 with the logged-out page, which would yield a run's worth of
 * plausible-looking but wrong screenshots. The preview shell emits a marker only
 * on the authenticated path; require it.
 *
 * @param {import('playwright').Page} page   Page from the capture context.
 * @param {Object}                    config Resolved configuration.
 * @param {Object}                    sample Any pattern from the manifest.
 */
async function assertAuthenticated( page, config, sample ) {
	const url = previewUrl( config, sample.name );
	const response = await page.goto( url, { waitUntil: 'domcontentloaded' } );
	const marker = await page
		.locator( 'meta[name="pattern-library-preview"]' )
		.count();

	if ( marker === 0 ) {
		throw new Error(
			`The browser is not authenticating against ${ url } (HTTP ${ response?.status() }). ` +
				'Browsers only attach credentials after a 401 carrying WWW-Authenticate, which the preview ' +
				'route sends — check that the site is running a wp-pattern-library new enough to send it, ' +
				'and that the credentials are valid for this origin.'
		);
	}
}

/**
 * Encode a PNG buffer to the configured output format.
 *
 * @param {Buffer} buffer PNG bytes from Playwright.
 * @param {Object} config Resolved configuration.
 * @return {Promise<Buffer>} Encoded image bytes.
 */
async function encode( buffer, config ) {
	if ( config.imageFormat === 'png' ) {
		return buffer;
	}

	return sharp( buffer )
		[ config.imageFormat ]( { quality: config.imageQuality } )
		.toBuffer();
}

/**
 * Write an image only when its bytes differ from what is on disk.
 *
 * Captures run against a live site, so query-loop patterns render real content
 * that changes underneath them. Rewriting visually identical files would add
 * megabytes of noise to every pull request.
 *
 * @param {string} path  Destination path.
 * @param {Buffer} bytes Encoded image.
 * @return {Promise<boolean>} Whether the file was written.
 */
async function writeIfChanged( path, bytes ) {
	const current = await readFile( path ).catch( () => null );

	if ( current && current.equals( bytes ) ) {
		return false;
	}

	await writeFile( path, bytes );

	return true;
}

/**
 * Capture every pattern, returning a per-pattern result.
 *
 * @param {Array}    patterns Patterns to capture.
 * @param {Object}   config   Resolved configuration.
 * @param {Function} log      Progress reporter.
 * @return {Promise<{written: number, unchanged: number, empty: string[], failed: Array}>} Summary.
 */
export async function captureAll( patterns, config, log = () => {} ) {
	await mkdir( config.screenshotsDir, { recursive: true } );

	const browser = await chromium.launch();
	const context = await browser.newContext( {
		ignoreHTTPSErrors: true,
		// 1x keeps committed images small; the rendered width is already ample.
		deviceScaleFactor: 1,
		// Themes commonly gate scroll-driven and entrance animations behind
		// prefers-reduced-motion. Emulating "reduce" collapses each to its rest
		// state, so a still capture shows the finished design rather than a
		// half-played keyframe.
		reducedMotion: 'reduce',
		// Credentials are attached in response to the WWW-Authenticate challenge the
		// preview route sends with its 401. `send: 'always'` is deliberately not
		// used: it only affects Playwright's API request context, not page
		// navigation. Scoped to the site's origin so the password is never attached
		// to third-party requests a theme makes (fonts, analytics, CDNs).
		httpCredentials: {
			username: config.username,
			password: config.appPassword,
			origin: new URL( config.siteUrl ).origin,
		},
	} );

	const page = await context.newPage();
	const summary = { written: 0, unchanged: 0, empty: [], failed: [] };

	try {
		if ( patterns.length ) {
			await assertAuthenticated( page, config, patterns[ 0 ] );
		}

		for ( const pattern of patterns ) {
			const filename = `${ pattern.basename }.${ config.imageFormat }`;
			const destination = join( config.screenshotsDir, filename );
			const width = pattern.viewportWidth > 0 ? pattern.viewportWidth : config.defaultViewport;
			const postType = config.postTypeContext[ pattern.basename ] ?? '';

			try {
				await page.setViewportSize( { width, height: 1000 } );
				await page.goto( previewUrl( config, pattern.name, postType ), {
					waitUntil: 'networkidle',
					timeout: config.captureTimeout,
				} );
				await page.evaluate( () => document.fonts && document.fonts.ready );
				await prepareForCapture( page );
				await page.waitForTimeout( 300 );

				const target = page.locator( '#pattern-library-preview' );
				const box = await target.boundingBox();
				const isEmpty = ! box || box.height < 8;

				if ( isEmpty ) {
					// A dynamic pattern that renders nothing in isolation, e.g. a query
					// loop with no matching posts. Capture the viewport so the gap is
					// visible in review, and flag it.
					summary.empty.push( pattern.basename );
				}

				const shot = isEmpty
					? await page.screenshot()
					: await target.screenshot();

				const changed = await writeIfChanged( destination, await encode( shot, config ) );
				summary[ changed ? 'written' : 'unchanged' ] += 1;

				log(
					`  ${ changed ? 'write ' : 'same  ' } ${ pattern.basename } (${ width }px, ${
						box ? Math.round( box.height ) : '?'
					}px tall)${ isEmpty ? ' — EMPTY' : '' }`
				);
			} catch ( error ) {
				summary.failed.push( { basename: pattern.basename, error: error.message } );
				log( `  FAIL   ${ pattern.basename } — ${ error.message }` );
			}
		}
	} finally {
		await browser.close();
	}

	return summary;
}
