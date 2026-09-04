<?php
/**
 * The manifest: which patterns the site exposes, and in what shape.
 *
 * The manifest is the contract between the two halves of this package, so these
 * tests pin the field names and types the Node CLI reads.
 *
 * @package HM\Pattern_Library
 */

declare( strict_types=1 );

namespace HM\Pattern_Library\Tests;

use WP_UnitTestCase;

use function HM\Pattern_Library\basename_for;
use function HM\Pattern_Library\get_namespaces;
use function HM\Pattern_Library\is_in_namespace;
use function HM\Pattern_Library\prepare_pattern;

/**
 * Cover the manifest's filtering and field preparation.
 */
class Manifest_Test extends WP_UnitTestCase {

	/**
	 * A pattern name splits into namespace and basename on the first slash only.
	 */
	public function test_basename_strips_the_namespace(): void {
		$this->assertSame( 'hero', basename_for( 'my-theme/hero' ) );
		$this->assertSame( 'hero', basename_for( 'hero' ) );
		$this->assertSame( 'hero/inner', basename_for( 'my-theme/hero/inner' ) );
		$this->assertSame( '', basename_for( 'my-theme/' ) );
	}

	/**
	 * An empty namespace list means "expose everything".
	 */
	public function test_empty_namespace_list_allows_every_pattern(): void {
		$this->assertTrue( is_in_namespace( 'core/banner', [] ) );
		$this->assertTrue( is_in_namespace( 'my-theme/hero', [] ) );
	}

	/**
	 * Namespaces match on prefix, so a trailing slash scopes to one namespace.
	 */
	public function test_namespaces_match_on_prefix(): void {
		$namespaces = [ 'my-theme/' ];

		$this->assertTrue( is_in_namespace( 'my-theme/hero', $namespaces ) );
		$this->assertFalse( is_in_namespace( 'core/banner', $namespaces ) );
		// Prefix matching: a sibling namespace sharing the stem is not included.
		$this->assertFalse( is_in_namespace( 'my-theme-extras/hero', $namespaces ) );
	}

	/**
	 * More than one namespace can be exposed at once.
	 */
	public function test_any_configured_namespace_matches(): void {
		$namespaces = [ 'my-theme/', 'my-plugin/' ];

		$this->assertTrue( is_in_namespace( 'my-plugin/card', $namespaces ) );
		$this->assertFalse( is_in_namespace( 'core/banner', $namespaces ) );
	}

	/**
	 * The namespace list is filterable, and always an array.
	 */
	public function test_namespaces_come_from_a_filter(): void {
		$this->assertSame( [], get_namespaces() );

		add_filter( 'pattern_library_namespaces', static fn (): array => [ 'my-theme/' ] );

		$this->assertSame( [ 'my-theme/' ], get_namespaces() );
	}

	/**
	 * Every field the CLI reads is present and correctly typed.
	 */
	public function test_prepare_pattern_produces_the_manifest_shape(): void {
		$prepared = prepare_pattern(
			[
				'name'          => 'my-theme/hero',
				'title'         => 'Hero',
				'description'   => 'A big hero.',
				'categories'    => [ 'banner' ],
				'keywords'      => [ 'masthead' ],
				'blockTypes'    => [ 'core/group' ],
				'postTypes'     => [ 'page' ],
				'viewportWidth' => 1280,
				'inserter'      => true,
				'source'        => 'theme',
				'content'       => '<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->',
			]
		);

		$this->assertSame( 'my-theme/hero', $prepared['name'] );
		$this->assertSame( 'hero', $prepared['basename'] );
		$this->assertSame( 'Hero', $prepared['title'] );
		$this->assertSame( 'A big hero.', $prepared['description'] );
		$this->assertSame( [ 'banner' ], $prepared['categories'] );
		$this->assertSame( [ 'masthead' ], $prepared['keywords'] );
		$this->assertSame( [ 'core/group' ], $prepared['blockTypes'] );
		$this->assertSame( [ 'page' ], $prepared['postTypes'] );
		$this->assertSame( 1280, $prepared['viewportWidth'] );
		$this->assertTrue( $prepared['inserter'] );
		$this->assertSame( 'theme', $prepared['source'] );
	}

	/**
	 * Pattern markup is deliberately left out: the library documents patterns
	 * visually, and shipping every pattern's content would bloat the manifest.
	 */
	public function test_prepare_pattern_omits_the_pattern_content(): void {
		$prepared = prepare_pattern(
			[
				'name'    => 'my-theme/hero',
				'content' => '<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->',
			]
		);

		$this->assertArrayNotHasKey( 'content', $prepared );
	}

	/**
	 * A sparsely registered pattern still yields every key, so the CLI never has
	 * to guard against a missing field.
	 */
	public function test_prepare_pattern_fills_in_missing_fields(): void {
		$prepared = prepare_pattern( [ 'name' => 'my-theme/hero' ] );

		$this->assertSame( 'my-theme/hero', $prepared['title'] );
		$this->assertSame( '', $prepared['description'] );
		$this->assertSame( [], $prepared['categories'] );
		$this->assertSame( [], $prepared['keywords'] );
		$this->assertSame( [], $prepared['blockTypes'] );
		$this->assertSame( [], $prepared['postTypes'] );
		$this->assertSame( 0, $prepared['viewportWidth'] );
		$this->assertTrue( $prepared['inserter'] );
		$this->assertSame( '', $prepared['source'] );
	}

	/**
	 * Registry arrays are not guaranteed to be lists, and JSON encoding turns a
	 * gappy array into an object the CLI cannot iterate.
	 */
	public function test_prepare_pattern_reindexes_list_fields(): void {
		$prepared = prepare_pattern(
			[
				'name'       => 'my-theme/hero',
				'categories' => [ 2 => 'banner', 5 => 'featured' ],
			]
		);

		$this->assertSame( [ 'banner', 'featured' ], $prepared['categories'] );
		$this->assertSame( [ 0, 1 ], array_keys( $prepared['categories'] ) );
	}

	/**
	 * A pattern hidden from the inserter is reported as such rather than dropped
	 * server-side, so the CLI can list it under "not included".
	 */
	public function test_prepare_pattern_reports_inserter_visibility(): void {
		$prepared = prepare_pattern( [ 'name' => 'my-theme/hero', 'inserter' => false ] );

		$this->assertFalse( $prepared['inserter'] );
	}
}
