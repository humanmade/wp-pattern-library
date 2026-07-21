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

	status_header( 200 );
	header( 'Content-Type: text/html; charset=utf-8' );

	$content = do_blocks( with_optional_post_context( $pattern, (string) $pattern['content'] ) );

	?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="robots" content="noindex, nofollow">
	<?php // Marker asserted by the CLI before capturing. Only the authenticated path emits it, so its absence means auth silently failed. ?>
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
