<?php
/**
 * Route registration, capability and access control.
 *
 * @package HM\Pattern_Library
 */

declare( strict_types=1 );

namespace HM\Pattern_Library;

/**
 * Query var carrying the pattern slug, or `__manifest` for the pattern list.
 */
const QUERY_VAR = 'pattern-library-preview';

/**
 * Query var optionally naming a post type to wrap the pattern in a query loop.
 */
const POST_TYPE_QUERY_VAR = 'pattern-library-post-type';

/**
 * Query var opting in to a placeholder featured image for posts without one.
 */
const PLACEHOLDER_QUERY_VAR = 'pattern-library-placeholder';

/**
 * Query var carrying JSON group-block attributes to wrap the pattern in.
 *
 * Lets one pattern be captured more than once — plain, and again inside the
 * section wrapper a theme uses to give it a different treatment. See
 * with_optional_wrapper().
 */
const WRAPPER_QUERY_VAR = 'pattern-library-wrapper';

/**
 * Capability required to read the manifest or render a preview.
 */
const CAPABILITY = 'view_pattern_library';

/**
 * Role created by `wp pattern-library setup`, holding only CAPABILITY and `read`.
 */
const ROLE = 'pattern_library';

/**
 * Hook the preview route.
 */
function bootstrap(): void {
	add_filter( 'application_password_is_api_request', __NAMESPACE__ . '\\allow_application_password', 10, 1 );
	add_action( 'template_redirect', __NAMESPACE__ . '\\maybe_render', 0 );
}

/**
 * Determine whether the current request targets the preview route.
 *
 * Deliberately does not sanitize or trust the value — this only answers "is this
 * our URL", and is called early enough that the query var is not yet registered.
 */
function is_preview_request(): bool {
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only route, authenticated by application password.
	return isset( $_GET[ QUERY_VAR ] );
}

/**
 * Opt the preview route in to application-password authentication.
 *
 * `wp_authenticate_application_password()` ignores any request that is not
 * XML-RPC or REST, so without this a front-end preview authenticates as nobody.
 * WordPress then serves the logged-out page with a 200, which would silently
 * produce logged-out screenshots rather than an error. Scoped to this one route.
 *
 * @param bool $is_api_request Whether core considers this an API request.
 */
function allow_application_password( $is_api_request ): bool {
	return (bool) $is_api_request || is_preview_request();
}

/**
 * Whether the current user may use the pattern library routes.
 *
 * Filterable so a project can grant access through its own role management
 * instead of the bundled role.
 */
function current_user_can_view(): bool {
	/**
	 * Filters whether the current user may read the pattern library.
	 *
	 * @param bool $can Whether the current user holds the capability.
	 */
	return (bool) apply_filters( 'pattern_library_user_can', current_user_can( CAPABILITY ) );
}

/**
 * Namespace prefixes whose patterns are exposed, e.g. `my-theme/`.
 *
 * Defaults to every registered pattern. Filtering this matters on sites where the
 * registry also holds core or plugin patterns that do not belong in the library.
 *
 * @return string[]
 */
function get_namespaces(): array {
	/**
	 * Filters the pattern-name prefixes exposed by the manifest.
	 *
	 * @param string[] $namespaces Prefixes to include. Empty array means all.
	 */
	return (array) apply_filters( 'pattern_library_namespaces', [] );
}

/**
 * Route the request to the manifest or a single pattern render.
 */
function maybe_render(): void {
	if ( ! is_preview_request() ) {
		return;
	}

	/**
	 * Filters whether the pattern library routes are enabled at all.
	 *
	 * @param bool $enabled Whether to serve the routes.
	 */
	if ( ! apply_filters( 'pattern_library_enabled', true ) ) {
		return;
	}

	// Never let a preview be indexed or cached by a shared cache, whatever the
	// environment's default headers are.
	header( 'X-Robots-Tag: noindex, nofollow', true );
	nocache_headers();

	if ( ! current_user_can_view() ) {
		// Issue a real HTTP Basic challenge. Browsers — including Playwright —
		// only attach credentials to a navigation after a 401 carrying
		// WWW-Authenticate; Playwright's `httpCredentials.send = 'always'` applies
		// to its API request context, not to page navigation. Without this header
		// no browser can ever authenticate to this route.
		header( 'WWW-Authenticate: Basic realm="Pattern Library", charset="UTF-8"' );
		send_error( 401, 'Authentication required. Send an application password for a user holding the ' . CAPABILITY . ' capability.' );
	}

	// phpcs:ignore WordPress.Security.NonceVerification.Recommended, HM.Security.ValidatedSanitizedInput.InputNotValidated -- read-only route, authenticated above; the index is guaranteed by the is_preview_request() guard at the top of this function.
	$value = sanitize_text_field( wp_unslash( (string) $_GET[ QUERY_VAR ] ) );

	if ( '__manifest' === $value ) {
		render_manifest();
	}

	render_pattern( $value );
}

/**
 * Emit a plain-text error and exit.
 *
 * @param int    $status  HTTP status code.
 * @param string $message Human-readable explanation.
 */
function send_error( int $status, string $message ): void {
	status_header( $status );
	header( 'Content-Type: text/plain; charset=utf-8' );
	echo esc_html( $message );
	exit;
}
