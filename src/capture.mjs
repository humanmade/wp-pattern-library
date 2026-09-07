/**
 * Screenshot each pattern with Playwright.
 */

import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { previewUrl, shotsFor } from './manifest.mjs';
import { resolveAnimations } from './animations.mjs';

/**
 * Bring a loaded pattern to its finished, fully-painted state.
 *
 * @param {import('playwright').Page} page       Loaded preview page.
 * @param {Array}                     animations Resolved animation libraries.
 */
async function prepareForCapture( page, animations ) {
	for ( const library of animations ) {
		if ( library.css ) {
			await page.addStyleTag( { content: library.css } );
		}
		if ( library.settle ) {
			await page.evaluate( library.settle );
		}
	}

	await page.evaluate( async () => {
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
				image.complete ? Promise.resolve() : image.decode().catch( () => {} ),
			),
		);
	} );
}

/**
 * Confirm the browser context is authenticating, before capturing anything.
 *
 * Playwright and Node's fetch authenticate independently, so a working manifest
 * fetch does not prove the *browser* is authenticated. Probe the manifest URL
 * with the browser: it returns 200 when authenticated and 401 when not, and —
 * unlike rendering a pattern — cannot be brought down by one broken pattern, so a
 * genuine render failure is never misreported as an auth failure.
 *
 * @param {import('playwright').Page} page   Page from the capture context.
 * @param {Object}                    config Resolved configuration.
 */
async function assertAuthenticated( page, config ) {
	const url = previewUrl( config, '__manifest' );
	const response = await page.goto( url, { waitUntil: 'domcontentloaded' } );
	const status = response?.status();

	if ( status !== 200 ) {
		throw new Error(
			`The browser is not authenticating against ${ url } (HTTP ${ status }). ` +
				'Browsers only attach credentials after a 401 carrying WWW-Authenticate, which the preview ' +
				'route sends — check that the site runs a wp-pattern-library new enough to send it, and that ' +
				'the credentials are valid for this origin. A 403 or a redirect to a login screen is more ' +
				'likely an access proxy in front of WordPress — see extraHeaders.',
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
 * @return {Promise<{written: number, unchanged: number, empty: string[], failed: Array, broken: Array}>} Summary.
 */
export async function captureAll( patterns, config, log = () => {} ) {
	await mkdir( config.screenshotsDir, { recursive: true } );

	const animations = resolveAnimations( config.animations );
	const origin = new URL( config.siteUrl ).origin;
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
			origin,
		},
	} );

	// Access-proxy headers gate the origin ahead of WordPress, so every request the
	// browser makes to the site needs them — but only to the site. Playwright's
	// context-level `extraHTTPHeaders` would attach them to third-party requests a
	// theme makes too (fonts, analytics, CDNs), which for a Cloudflare Access
	// service token means handing the secret to whoever the theme happens to call.
	if ( Object.keys( config.extraHeaders ).length ) {
		await context.route( '**/*', ( route ) => {
			const request = route.request();
			const sameOrigin = new URL( request.url() ).origin === origin;

			return route.continue(
				sameOrigin
					? { headers: { ...request.headers(), ...config.extraHeaders } }
					: undefined,
			);
		} );
	}

	const page = await context.newPage();
	const summary = { written: 0, unchanged: 0, empty: [], failed: [], broken: [] };

	// Track subresources that fail to load — a pattern referencing an image that
	// no longer exists renders "successfully" but previews wrong, so surface it.
	// The document itself is excluded: its status is handled on the goto response,
	// and the Basic-auth handshake legitimately answers 401 before retrying.
	let currentUrl = '';
	let missingResources = [];
	page.on( 'response', ( response ) => {
		if ( response.status() >= 400 && response.url() !== currentUrl ) {
			missingResources.push( `${ response.url() } (HTTP ${ response.status() })` );
		}
	} );
	page.on( 'requestfailed', ( request ) => {
		const error = request.failure()?.errorText ?? 'failed';
		// Navigations abort in-flight requests; that is not a missing resource.
		if ( error !== 'net::ERR_ABORTED' && request.url() !== currentUrl ) {
			missingResources.push( `${ request.url() } (${ error })` );
		}
	} );

	try {
		if ( patterns.length ) {
			await assertAuthenticated( page, config );
		}

		for ( const pattern of patterns ) {
			const width = pattern.viewportWidth > 0 ? pattern.viewportWidth : config.defaultViewport;
			const postType = config.postTypeContext[ pattern.basename ] ?? '';

			// The plain capture and each variant are separate page loads: the
			// wrapper is applied server-side, so the pattern has to be rendered
			// again inside it rather than adjusted in the browser.
			for ( const shot of shotsFor( pattern, config ) ) {
				const destination = join(
					config.screenshotsDir,
					`${ shot.basename }.${ config.imageFormat }`,
				);

				try {
					await page.setViewportSize( { width, height: 1000 } );
					currentUrl = previewUrl( config, pattern.name, postType, shot.variant?.wrapper );
					missingResources = [];
					const response = await page.goto( currentUrl, {
						waitUntil: 'networkidle',
						timeout: config.captureTimeout,
					} );

					const status = response?.status();
					if ( status && status >= 400 ) {
						// The request reached authenticated render code — auth is fine — but
						// the pattern itself failed to render. Almost always a block or
						// binding in the pattern that assumes a post context it lacks in
						// isolation. Surface it as this pattern's failure and move on.
						throw new Error(
							`HTTP ${ status } rendering the pattern (likely a block that needs post context; ` +
								'try postTypeContext, or exclude it).',
						);
					}
					await page.evaluate( () => document.fonts && document.fonts.ready );
					await prepareForCapture( page, animations );
					await page.waitForTimeout( 300 );

					const target = page.locator( '#pattern-library-preview' );
					const box = await target.boundingBox();
					const isEmpty = ! box || box.height < 8;

					if ( isEmpty ) {
						// A dynamic pattern that renders nothing in isolation, e.g. a query
						// loop with no matching posts. Capture the viewport so the gap is
						// visible in review, and flag it.
						summary.empty.push( shot.basename );
					}

					const image = isEmpty
						? await page.screenshot()
						: await target.screenshot();

					const changed = await writeIfChanged( destination, await encode( image, config ) );
					summary[ changed ? 'written' : 'unchanged' ] += 1;

					if ( missingResources.length ) {
						summary.broken.push( {
							basename: shot.basename,
							resources: [ ...new Set( missingResources ) ],
						} );
					}

					log(
						`  ${ changed ? 'write ' : 'same  ' } ${ shot.basename } (${ width }px, ${
							box ? Math.round( box.height ) : '?'
						}px tall)${ isEmpty ? ' — EMPTY' : '' }${
							missingResources.length ? ` — ${ missingResources.length } missing resource(s)` : ''
						}`,
					);
				} catch ( error ) {
					summary.failed.push( { basename: shot.basename, error: error.message } );
					log( `  FAIL   ${ shot.basename } — ${ error.message }` );
				}
			}
		}
	} finally {
		await browser.close();
	}

	return summary;
}
