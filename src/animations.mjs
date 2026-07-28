/**
 * Animation libraries whose "finished" state must be forced before capture.
 *
 * Reduced-motion (set on the browser context) handles a theme's own animations,
 * but scroll-triggered libraries reveal blocks by adding a class only as they
 * scroll into view, and commonly re-hide anything off screen. A tall capture
 * would lose every below-the-fold section, so each library here forces its
 * revealed end state.
 *
 * A library entry has:
 *
 * - `css`     Stylesheet injected before capture, overriding the hidden state.
 * - `settle`  Function run in the page context to flip elements to "done".
 *             Serialized into the browser, so it must be self-contained: no
 *             closures over Node-side variables.
 */

export const LIBRARIES = {
	// AOS (Animate On Scroll) — https://michalsnik.github.io/aos/
	aos: {
		css: `
			[data-aos] {
				opacity: 1 !important;
				transform: none !important;
				transition: none !important;
			}
		`,
		settle: () => {
			document
				.querySelectorAll( '[data-aos]' )
				.forEach( ( el ) => el.classList.add( 'aos-animate' ) );
		},
	},
};

/**
 * Resolve the configured animation entries to concrete library objects.
 *
 * Config entries are either the name of a built-in library, or an inline
 * `{ css, settle }` object for a custom implementation.
 *
 * @param {Array<string|Object>} animations The `animations` config value.
 * @return {Array<{css?: string, settle?: Function}>} Resolved libraries.
 */
export function resolveAnimations( animations ) {
	return animations.map( ( entry ) => {
		if ( typeof entry !== 'string' ) {
			return entry;
		}

		if ( ! LIBRARIES[ entry ] ) {
			throw new Error(
				`Unknown animation library "${ entry }" in config. Built in: ${ Object.keys(
					LIBRARIES
				).join( ', ' ) }. Pass an object ({ css, settle }) for a custom library.`
			);
		}

		return LIBRARIES[ entry ];
	} );
}
