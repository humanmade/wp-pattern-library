<?php
/**
 * Pattern lookup, variant wrappers, post context and placeholder images.
 *
 * The wrapper is the security-sensitive half of this file: it turns a query
 * string into block markup, so what it refuses matters as much as what it emits.
 *
 * @package HM\Pattern_Library
 */

declare( strict_types=1 );

namespace HM\Pattern_Library\Tests;

use WP_Block_Patterns_Registry;
use WP_UnitTestCase;

use const HM\Pattern_Library\POST_TYPE_QUERY_VAR;
use const HM\Pattern_Library\WRAPPER_QUERY_VAR;

use function HM\Pattern_Library\find_pattern;
use function HM\Pattern_Library\placeholder_thumbnail;
use function HM\Pattern_Library\with_optional_post_context;
use function HM\Pattern_Library\with_optional_wrapper;

/**
 * Cover render-side behaviour that does not require emitting a document.
 */
class Render_Test extends WP_UnitTestCase {

	private const CONTENT = '<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->';

	/**
	 * Register a pattern to look up.
	 */
	public function set_up(): void {
		parent::set_up();

		register_block_pattern(
			'my-theme/hero',
			[
				'title'   => 'Hero',
				'content' => self::CONTENT,
			]
		);
	}

	/**
	 * Unregister it, and clear the query vars.
	 */
	public function tear_down(): void {
		unset( $_GET[ WRAPPER_QUERY_VAR ], $_GET[ POST_TYPE_QUERY_VAR ] );

		if ( WP_Block_Patterns_Registry::get_instance()->is_registered( 'my-theme/hero' ) ) {
			unregister_block_pattern( 'my-theme/hero' );
		}

		parent::tear_down();
	}

	/**
	 * Set the wrapper query var to an encoded attribute set.
	 *
	 * @param mixed $value Value to encode, or a raw string to send verbatim.
	 */
	private function request_wrapper( $value ): void {
		$json = is_string( $value ) ? $value : (string) wp_json_encode( $value );

		// WordPress slashes every superglobal in wp_magic_quotes() before any
		// plugin code runs, and the route calls wp_unslash() to undo it. Tests
		// assign $_GET after that has happened, so they have to slash too — a
		// wrapper containing a quote would otherwise arrive as invalid JSON here
		// and as valid JSON in production.
		$_GET[ WRAPPER_QUERY_VAR ] = wp_slash( $json );
	}

	/**
	 * Patterns resolve by full name.
	 */
	public function test_find_pattern_resolves_a_full_name(): void {
		$pattern = find_pattern( 'my-theme/hero' );

		$this->assertNotNull( $pattern );
		$this->assertSame( 'my-theme/hero', $pattern['name'] );
	}

	/**
	 * ...and by bare basename, which is what the CLI's filters use.
	 */
	public function test_find_pattern_falls_back_to_a_basename(): void {
		$pattern = find_pattern( 'hero' );

		$this->assertNotNull( $pattern );
		$this->assertSame( 'my-theme/hero', $pattern['name'] );
	}

	/**
	 * A namespaced name is never guessed at: it either exists or it does not.
	 */
	public function test_find_pattern_does_not_guess_at_a_namespaced_name(): void {
		$this->assertNull( find_pattern( 'other-theme/hero' ) );
		$this->assertNull( find_pattern( 'nope' ) );
	}

	/**
	 * Without the query var, the pattern is rendered exactly as registered.
	 */
	public function test_no_wrapper_is_added_unless_one_is_requested(): void {
		$this->assertSame( self::CONTENT, with_optional_wrapper( self::CONTENT ) );
	}

	/**
	 * The wrapper is a real group block, so block stylesheets registered with
	 * wp_enqueue_block_style() load for it.
	 */
	public function test_a_wrapper_is_a_real_group_block(): void {
		$this->request_wrapper( [ 'className' => 'is-style-dark' ] );

		$wrapped = with_optional_wrapper( self::CONTENT );

		$this->assertStringStartsWith( '<!-- wp:group ', $wrapped );
		$this->assertStringEndsWith( '</div><!-- /wp:group -->', $wrapped );
		$this->assertStringContainsString( self::CONTENT, $wrapped );
		$this->assertStringContainsString( 'class="wp-block-group is-style-dark"', $wrapped );
	}

	/**
	 * Colour supports are applied server-side only to dynamic blocks, so the
	 * presentation classes have to be written out in full here.
	 */
	public function test_colour_attributes_are_written_out_as_classes(): void {
		$this->request_wrapper(
			[
				'backgroundColor' => 'shark',
				'textColor'       => 'white',
			]
		);

		$wrapped = with_optional_wrapper( self::CONTENT );

		$this->assertStringContainsString( 'has-shark-background-color', $wrapped );
		$this->assertStringContainsString( 'has-background', $wrapped );
		$this->assertStringContainsString( 'has-white-color', $wrapped );
		$this->assertStringContainsString( 'has-text-color', $wrapped );
	}

	/**
	 * A gradient is a background too.
	 */
	public function test_a_gradient_is_written_out_as_a_background(): void {
		$this->request_wrapper( [ 'gradient' => 'midnight' ] );

		$wrapped = with_optional_wrapper( self::CONTENT );

		$this->assertStringContainsString( 'has-midnight-gradient-background', $wrapped );
		$this->assertStringContainsString( 'has-background', $wrapped );
	}

	/**
	 * An attribute outside the accepted vocabulary is dropped, so a config typo
	 * cannot quietly become a block attribute nobody meant to set.
	 */
	public function test_unknown_attributes_are_dropped(): void {
		$this->request_wrapper( [ 'metadata' => [ 'name' => 'x' ], 'lock' => [ 'remove' => true ] ] );

		// Nothing recognised remains, so there is no wrapper to add.
		$this->assertSame( self::CONTENT, with_optional_wrapper( self::CONTENT ) );
	}

	/**
	 * Recognised attributes survive alongside unrecognised ones.
	 */
	public function test_unknown_attributes_are_dropped_but_known_ones_survive(): void {
		$this->request_wrapper( [ 'className' => 'is-style-dark', 'lock' => [ 'remove' => true ] ] );

		$wrapped = with_optional_wrapper( self::CONTENT );

		$this->assertStringContainsString( 'is-style-dark', $wrapped );
		// Asserted on the JSON key, not the bare word: "wp-block-group" contains
		// "lock".
		$this->assertStringNotContainsString( '"lock"', $wrapped );
		$this->assertStringNotContainsString( 'remove', $wrapped );
	}

	/**
	 * Class names are sanitized, so markup cannot ride in on one.
	 */
	public function test_class_names_are_sanitized(): void {
		$this->request_wrapper( [ 'className' => 'ok "><script>alert(1)</script>' ] );

		$wrapped = with_optional_wrapper( self::CONTENT );

		$this->assertStringNotContainsString( '<script', $wrapped );
		$this->assertStringContainsString( 'ok', $wrapped );
	}

	/**
	 * ...and the block comment describes the same block as the div, built from
	 * the sanitized values rather than the raw input.
	 */
	public function test_the_block_comment_cannot_be_closed_early(): void {
		$this->request_wrapper( [ 'className' => 'a --><!-- wp:html -->' ] );

		$wrapped = with_optional_wrapper( self::CONTENT );

		// Exactly one opening group comment: the injected one did not survive.
		$this->assertSame( 1, substr_count( $wrapped, '<!-- wp:group ' ) );
		$this->assertStringNotContainsString( 'wp:html', $wrapped );
	}

	/**
	 * A style object is resolved by the style engine into inline CSS.
	 */
	public function test_a_style_object_becomes_inline_css(): void {
		$this->request_wrapper(
			[ 'style' => [ 'spacing' => [ 'padding' => [ 'top' => '4rem' ] ] ] ]
		);

		$wrapped = with_optional_wrapper( self::CONTENT );

		$this->assertStringContainsString( 'padding-top:4rem', $wrapped );
	}

	/**
	 * A wrapper the style engine understands nothing in must still render — the
	 * `css` key is simply absent, and the guard in wrapper_markup() covers it.
	 */
	public function test_a_style_object_with_nothing_resolvable_still_renders(): void {
		$this->request_wrapper(
			[ 'className' => 'is-style-dark', 'style' => [ 'nonsense' => [ 'x' => 'y' ] ] ]
		);

		$wrapped = with_optional_wrapper( self::CONTENT );

		$this->assertStringContainsString( 'is-style-dark', $wrapped );
		$this->assertStringNotContainsString( 'style=""', $wrapped );
	}

	/**
	 * Malformed or empty wrapper values leave the pattern alone.
	 */
	public function test_a_malformed_wrapper_is_ignored(): void {
		foreach ( [ 'not json', '[]', '{}', 'null', '"a string"', '' ] as $raw ) {
			$this->request_wrapper( $raw );

			$this->assertSame(
				self::CONTENT,
				with_optional_wrapper( self::CONTENT ),
				"Expected {$raw} to be ignored."
			);
		}
	}

	/**
	 * A theme whose section treatment needs more can replace the markup.
	 */
	public function test_the_wrapper_markup_is_filterable(): void {
		$this->request_wrapper( [ 'className' => 'is-style-dark' ] );

		add_filter( 'pattern_library_wrapper_open', static fn (): string => '<section class="custom">' );
		add_filter( 'pattern_library_wrapper_close', static fn (): string => '</section>' );

		$this->assertSame(
			'<section class="custom">' . self::CONTENT . '</section>',
			with_optional_wrapper( self::CONTENT )
		);
	}

	/**
	 * Post context applies only to patterns built as query-loop item templates.
	 */
	public function test_post_context_is_only_added_to_post_template_patterns(): void {
		$_GET[ POST_TYPE_QUERY_VAR ] = 'post';

		$this->assertSame(
			self::CONTENT,
			with_optional_post_context( [ 'blockTypes' => [ 'core/group' ] ], self::CONTENT )
		);
	}

	/**
	 * ...and only when a post type is actually asked for.
	 */
	public function test_post_context_is_only_added_when_requested(): void {
		$this->assertSame(
			self::CONTENT,
			with_optional_post_context( [ 'blockTypes' => [ 'core/post-template' ] ], self::CONTENT )
		);
	}

	/**
	 * A card item template gets a one-item query loop to bind to.
	 */
	public function test_post_context_wraps_the_pattern_in_a_query_loop(): void {
		$_GET[ POST_TYPE_QUERY_VAR ] = 'post';

		$wrapped = with_optional_post_context(
			[ 'blockTypes' => [ 'core/post-template' ] ],
			self::CONTENT
		);

		$this->assertStringContainsString( '<!-- wp:query ', $wrapped );
		$this->assertStringContainsString( '<!-- wp:post-template -->', $wrapped );
		$this->assertStringContainsString( '"postType":"post"', $wrapped );
		$this->assertStringContainsString( '"perPage":1', $wrapped );
		$this->assertStringContainsString( self::CONTENT, $wrapped );
	}

	/**
	 * An unregistered post type is refused rather than queried for.
	 */
	public function test_an_unknown_post_type_is_ignored(): void {
		$_GET[ POST_TYPE_QUERY_VAR ] = 'no-such-type';

		$this->assertSame(
			self::CONTENT,
			with_optional_post_context( [ 'blockTypes' => [ 'core/post-template' ] ], self::CONTENT )
		);
	}

	/**
	 * A post that already has a featured image keeps it.
	 */
	public function test_the_placeholder_leaves_a_real_thumbnail_alone(): void {
		$this->assertSame(
			'<img src="real.jpg">',
			placeholder_thumbnail( '<img src="real.jpg">', 1, 7, 'post-thumbnail', [] )
		);
	}

	/**
	 * A post without one gets an inline SVG, so the layout has no hole in it.
	 */
	public function test_the_placeholder_fills_in_for_a_missing_thumbnail(): void {
		$html = placeholder_thumbnail( '', 1, 0, 'post-thumbnail', [] );

		$this->assertStringContainsString( 'data:image/svg+xml', $html );
		$this->assertStringContainsString( 'attachment-post-thumbnail', $html );
	}

	/**
	 * The requested classes are carried onto the placeholder, so theme styles
	 * that target them still apply.
	 */
	public function test_the_placeholder_keeps_the_requested_classes(): void {
		$html = placeholder_thumbnail( '', 1, 0, 'post-thumbnail', [ 'class' => 'my-theme-card__image' ] );

		$this->assertStringContainsString( 'my-theme-card__image', $html );
	}

	/**
	 * Projects can supply their own placeholder.
	 */
	public function test_the_placeholder_is_filterable(): void {
		add_filter( 'pattern_library_placeholder_image', static fn (): string => '<img src="ours.png">' );

		$this->assertSame(
			'<img src="ours.png">',
			placeholder_thumbnail( '', 1, 0, 'post-thumbnail', [] )
		);
	}
}
