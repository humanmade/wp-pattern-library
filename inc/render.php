<?php
/**
 * Render a single registered pattern in a chrome-free HTML shell.
 *
 * Theme styles and scripts load via wp_head()/wp_footer() so the pattern looks
 * exactly as it would on the front end, but the site header, footer and admin bar
 * are omitted so a screenshot captures the pattern and nothing else.
 *
 * @package HM\Pattern_Library
 */

declare( strict_types=1 );

namespace HM\Pattern_Library;

/**
 * DOM id of the element wrapping the pattern. The capture tool crops to this.
 */
const CONTAINER_ID = 'pattern-library-preview';

/**
 * Render one pattern and exit.
 *
 * @param string $slug Pattern name, or a bare basename if unambiguous.
 */
function render_pattern( string $slug ): void {
	$pattern = find_pattern( $slug );

	if ( null === $pattern ) {
		send_error( 404, 'Unknown pattern: ' . $slug );
	}

	// Suppress the admin bar so it never intrudes on a capture. The request is
	// authenticated, so without this it would render.
	add_filter( 'show_admin_bar', '__return_false' );

	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only route, authenticated by the caller.
	if ( isset( $_GET[ PLACEHOLDER_QUERY_VAR ] ) ) {
		add_filter( 'post_thumbnail_html', __NAMESPACE__ . '\\placeholder_thumbnail', 10, 5 );
	}

	status_header( 200 );
	header( 'Content-Type: text/html; charset=utf-8' );

	$content = do_blocks(
		with_optional_wrapper( with_optional_post_context( $pattern, (string) $pattern['content'] ) )
	);

	?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="robots" content="noindex, nofollow">
	<?php // Emitted only on the authenticated path, so its presence in a saved page or a browser confirms auth worked. A debugging aid; the CLI probes the manifest URL's status for its pre-capture check. ?>
	<meta name="pattern-library-preview" content="<?php echo esc_attr( (string) $pattern['name'] ); ?>">
	<title><?php echo esc_html( (string) ( $pattern['title'] ?? $pattern['name'] ) ); ?> — Pattern Preview</title>
	<style>html, body { margin: 0; padding: 0; }</style>
	<?php wp_head(); ?>
</head>
<body class="pattern-library-preview">
	<div class="wp-site-blocks">
		<main class="wp-block-group" id="<?php echo esc_attr( CONTAINER_ID ); ?>">
			<?php
			// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- rendered output of markup already registered on this site.
			echo $content;
			?>
		</main>
	</div>
	<?php wp_footer(); ?>
</body>
</html>
	<?php
	exit;
}

/**
 * Look up a pattern by full name, falling back to a namespace-less basename.
 *
 * @param string $slug Pattern name or basename.
 * @return array|null Registered pattern, or null when not found.
 */
function find_pattern( string $slug ): ?array {
	$registry = \WP_Block_Patterns_Registry::get_instance();

	$pattern = $registry->get_registered( $slug );
	if ( null !== $pattern ) {
		return $pattern;
	}

	if ( str_contains( $slug, '/' ) ) {
		return null;
	}

	foreach ( $registry->get_all_registered() as $candidate ) {
		if ( basename_for( (string) $candidate['name'] ) === $slug ) {
			return $candidate;
		}
	}

	return null;
}

/**
 * Substitute a placeholder image when a post has no featured image.
 *
 * Query-loop and template patterns that lean on the featured image otherwise
 * preview with a hole in the layout. Applied only when the capture tool opts in
 * via PLACEHOLDER_QUERY_VAR, so the route shows real front-end output unless
 * asked otherwise.
 *
 * @param string       $html              Thumbnail markup; empty when the post has none.
 * @param int          $post_id           Post being rendered.
 * @param int          $post_thumbnail_id Thumbnail attachment ID; 0 when none.
 * @param string|int[] $size              Requested image size.
 * @param string|array $attr              Requested image attributes.
 * @return string Original markup, or placeholder markup.
 */
function placeholder_thumbnail( $html, $post_id, $post_thumbnail_id, $size, $attr ): string {
	if ( '' !== $html || $post_thumbnail_id ) {
		return (string) $html;
	}

	$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675">'
		. '<rect width="1200" height="675" fill="#d8dde3"/>'
		. '<circle cx="510" cy="255" r="45" fill="#aab4bf"/>'
		. '<path d="M420 460 570 310l120 120 90-90 120 120v55H420Z" fill="#aab4bf"/>'
		. '</svg>';

	$class = is_array( $attr ) && ! empty( $attr['class'] )
		? (string) $attr['class']
		: 'attachment-post-thumbnail';

	$placeholder = sprintf(
		'<img src="data:image/svg+xml;charset=utf-8,%s" alt="" class="%s" width="1200" height="675" style="width:100%%;height:auto;object-fit:cover;">',
		rawurlencode( $svg ),
		esc_attr( $class )
	);

	/**
	 * Filters the placeholder markup used for posts without a featured image.
	 *
	 * @param string $placeholder Placeholder <img> markup.
	 * @param int    $post_id     Post being rendered.
	 */
	return (string) apply_filters( 'pattern_library_placeholder_image', $placeholder, $post_id );
}

/**
 * Group-block attributes a variant wrapper may set.
 *
 * Deliberately narrow: a wrapper exists to put a pattern on a different ground —
 * a section style, a colour, a gradient, the layout that ground sits in — so the
 * vocabulary stops at what a section group needs. Anything outside this list is
 * dropped rather than passed through, so a config typo cannot quietly become a
 * block attribute nobody meant to set.
 *
 * `style` and `layout` are objects handed to core untouched: the style engine
 * resolves one into inline CSS, and the layout support resolves the other into
 * classes and container CSS while the pattern renders. The rest are scalars this
 * file has to turn into presentation classes itself — see wrapper_markup().
 */
const WRAPPER_ATTRIBUTES = [ 'className', 'align', 'backgroundColor', 'gradient', 'textColor', 'style', 'layout' ];

/**
 * Optionally wrap a pattern in a group block, for a variant capture.
 *
 * The capture tool asks for the same pattern twice: once bare, and once inside
 * the wrapper a project names in its config — typically a section style such as
 * `is-style-dark` over a dark ground. The wrapper is built here rather than sent
 * as markup so the URL carries data, not HTML.
 *
 * Two things make this a real group block rather than a plain div. Block-level
 * stylesheets registered with `wp_enqueue_block_style()` load only when their
 * block renders, so a pattern containing no group of its own would otherwise be
 * captured without the very CSS the wrapper style lives in. And the presentation
 * classes have to be written out in full: core applies block supports server-side
 * only to dynamic blocks, so a static group keeps whatever classes its saved
 * markup carries and no more.
 *
 * @param string $pattern_content Pattern markup, already given any post context.
 * @return string Markup, wrapped when a valid wrapper was requested.
 */
function with_optional_wrapper( string $pattern_content ): string {
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only route, authenticated by the caller.
	if ( ! isset( $_GET[ WRAPPER_QUERY_VAR ] ) ) {
		return $pattern_content;
	}

	// Not sanitize_text_field(): the value is a JSON document, and json_decode()
	// is the validation that matters. Anything that does not decode to an object
	// is discarded below.
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended, WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- read-only route, authenticated by the caller; validated by json_decode() below.
	$decoded = json_decode( wp_unslash( (string) $_GET[ WRAPPER_QUERY_VAR ] ), true );

	if ( ! is_array( $decoded ) || empty( $decoded ) ) {
		return $pattern_content;
	}

	$attributes = array_intersect_key( $decoded, array_flip( WRAPPER_ATTRIBUTES ) );

	if ( empty( $attributes ) ) {
		return $pattern_content;
	}

	[ $open, $close ] = wrapper_markup( $attributes );

	return $open . $pattern_content . $close;
}

/**
 * Sanitize one class name.
 *
 * A named wrapper for sanitize_html_class(), so it can be passed to array_map()
 * inside a namespace without the callable resolving to the global function.
 *
 * @param string $class Candidate class name.
 * @return string Sanitized class name.
 */
function sanitize_class( string $class ): string {
	return sanitize_html_class( $class );
}

/**
 * Build the opening and closing markup of a variant wrapper.
 *
 * @param array $attributes Group attributes, already reduced to WRAPPER_ATTRIBUTES.
 * @return array{0: string, 1: string} Opening and closing markup.
 */
function wrapper_markup( array $attributes ): array {
	$classes = [ 'wp-block-group' ];

	// Sanitize into a parallel array rather than reading the raw input twice: the
	// block comment and the div have to describe the same block, so the comment is
	// serialized from the sanitized values too.
	$clean = [];

	if ( ! empty( $attributes['align'] ) && is_string( $attributes['align'] ) ) {
		$clean['align'] = sanitize_html_class( $attributes['align'] );
		$classes[]      = 'align' . $clean['align'];
	}

	if ( ! empty( $attributes['className'] ) && is_string( $attributes['className'] ) ) {
		$names = array_filter(
			array_map( __NAMESPACE__ . '\\sanitize_class', preg_split( '/\s+/', $attributes['className'] ) ?: [] )
		);
		$clean['className'] = implode( ' ', $names );
		$classes            = array_merge( $classes, $names );
	}

	if ( ! empty( $attributes['textColor'] ) && is_string( $attributes['textColor'] ) ) {
		$clean['textColor'] = sanitize_html_class( $attributes['textColor'] );
		$classes[]          = sprintf( 'has-%s-color', $clean['textColor'] );
		$classes[]          = 'has-text-color';
	}

	if ( ! empty( $attributes['backgroundColor'] ) && is_string( $attributes['backgroundColor'] ) ) {
		$clean['backgroundColor'] = sanitize_html_class( $attributes['backgroundColor'] );
		$classes[]                = sprintf( 'has-%s-background-color', $clean['backgroundColor'] );
		$classes[]                = 'has-background';
	}

	if ( ! empty( $attributes['gradient'] ) && is_string( $attributes['gradient'] ) ) {
		$clean['gradient'] = sanitize_html_class( $attributes['gradient'] );
		$classes[]         = sprintf( 'has-%s-gradient-background', $clean['gradient'] );
		$classes[]         = 'has-background';
	}

	if ( ! empty( $attributes['layout'] ) && is_array( $attributes['layout'] ) ) {
		// Layout is resolved by core's layout support during the render, which
		// applies to a statically serialized block too: it adds the is-layout-*
		// classes to this tag and collects any container CSS into the style
		// engine. render_pattern() runs do_blocks() before wp_head(), so that CSS
		// is in the store by the time the document prints it.
		$clean['layout'] = $attributes['layout'];
	}

	$style = '';
	if ( ! empty( $attributes['style'] ) && is_array( $attributes['style'] ) ) {
		$clean['style'] = $attributes['style'];

		// The style engine filters its return, dropping `css` entirely when nothing
		// it understands was asked for. The WordPress stubs describe the key as
		// always present, so static analysis calls this guard redundant; core does
		// not agree, and a missing-key warning here would break the render.
		$style = (string) ( wp_style_engine_get_styles( $attributes['style'] )['css'] ?? '' );
	}

	$open = sprintf(
		'<!-- wp:group %s --><div class="%s"%s>',
		// JSON_HEX_TAG so no attribute value can carry an angle bracket into the
		// block comment and close it early.
		(string) wp_json_encode( $clean, JSON_HEX_TAG ),
		// No array_filter(): every branch above appends a literal prefix, so no
		// entry can be empty even when a sanitized value is.
		esc_attr( implode( ' ', array_unique( $classes ) ) ),
		'' === $style ? '' : sprintf( ' style="%s"', esc_attr( $style ) )
	);

	/**
	 * Filters the opening markup of a variant wrapper.
	 *
	 * The built-in wrapper covers the presentational attributes of a section
	 * group. A theme whose section treatment needs more than that — a nested
	 * wrapper, or a layout — can replace the opening markup here, and match it
	 * with `pattern_library_wrapper_close`.
	 *
	 * @param string $open       Opening markup, block comment included.
	 * @param array  $attributes Requested wrapper attributes.
	 */
	$open = (string) apply_filters( 'pattern_library_wrapper_open', $open, $attributes );

	/**
	 * Filters the closing markup of a variant wrapper.
	 *
	 * @param string $close      Closing markup, block comment included.
	 * @param array  $attributes Requested wrapper attributes.
	 */
	$close = (string) apply_filters( 'pattern_library_wrapper_close', '</div><!-- /wp:group -->', $attributes );

	return [ $open, $close ];
}

/**
 * Optionally wrap a pattern in a one-item query loop.
 *
 * Patterns designed to sit inside `core/post-template` — card item templates —
 * render as empty in isolation, because their post-title/post-content blocks
 * resolve against whatever the global query happens to be. Passing a post type
 * gives them a real post to bind to.
 *
 * @param array  $pattern         Registered pattern.
 * @param string $pattern_content Raw pattern markup.
 */
function with_optional_post_context( array $pattern, string $pattern_content ): string {
	$block_types = (array) ( $pattern['blockTypes'] ?? [] );
	if ( ! in_array( 'core/post-template', $block_types, true ) ) {
		return $pattern_content;
	}

	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only route, authenticated by the caller.
	if ( ! isset( $_GET[ POST_TYPE_QUERY_VAR ] ) ) {
		return $pattern_content;
	}

	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only route, authenticated by the caller.
	$post_type = sanitize_key( wp_unslash( (string) $_GET[ POST_TYPE_QUERY_VAR ] ) );
	if ( '' === $post_type || ! post_type_exists( $post_type ) ) {
		return $pattern_content;
	}

	$query = [
		'queryId' => 0,
		'query'   => [
			'perPage'  => 1,
			'pages'    => 0,
			'offset'   => 0,
			'postType' => $post_type,
			'order'    => 'desc',
			'orderBy'  => 'date',
			'inherit'  => false,
		],
	];

	return '<!-- wp:query ' . wp_json_encode( $query ) . ' -->'
		. '<div class="wp-block-query">'
		. '<!-- wp:post-template -->'
		. $pattern_content
		. '<!-- /wp:post-template -->'
		. '</div>'
		. '<!-- /wp:query -->';
}
