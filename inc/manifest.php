<?php
/**
 * JSON manifest of the site's registered patterns and pattern categories.
 *
 * @package HM\Pattern_Library
 */

declare( strict_types=1 );

namespace HM\Pattern_Library;

/**
 * Manifest schema version. Bumped when the shape changes incompatibly, so the
 * CLI can refuse a site it does not understand rather than misread it.
 */
const MANIFEST_VERSION = 1;

/**
 * Emit the manifest as JSON and exit.
 */
function render_manifest(): void {
	$namespaces = get_namespaces();

	$patterns = [];
	foreach ( \WP_Block_Patterns_Registry::get_instance()->get_all_registered() as $pattern ) {
		if ( ! is_in_namespace( (string) $pattern['name'], $namespaces ) ) {
			continue;
		}
		$patterns[] = prepare_pattern( $pattern );
	}

	usort( $patterns, static fn( array $a, array $b ): int => strcmp( $a['name'], $b['name'] ) );

	$categories = [];
	foreach ( \WP_Block_Pattern_Categories_Registry::get_instance()->get_all_registered() as $category ) {
		$categories[] = [
			'slug'  => (string) $category['name'],
			'label' => (string) ( $category['label'] ?? $category['name'] ),
		];
	}

	wp_send_json(
		[
			'manifestVersion' => MANIFEST_VERSION,
			'site'            => [
				'name' => get_bloginfo( 'name' ),
				'url'  => home_url( '/' ),
			],
			'categories'      => $categories,
			'patterns'        => $patterns,
		]
	);
}

/**
 * Whether a pattern name falls within one of the configured namespaces.
 *
 * @param string   $name       Registered pattern name, e.g. `my-theme/hero`.
 * @param string[] $namespaces Allowed prefixes. Empty means allow everything.
 */
function is_in_namespace( string $name, array $namespaces ): bool {
	if ( empty( $namespaces ) ) {
		return true;
	}

	foreach ( $namespaces as $namespace ) {
		if ( str_starts_with( $name, (string) $namespace ) ) {
			return true;
		}
	}

	return false;
}

/**
 * Reduce a registered pattern to the fields the generator needs.
 *
 * Deliberately omits `content`: the library documents patterns visually, and
 * shipping every pattern's markup would make the manifest an order of magnitude
 * larger for no benefit.
 *
 * @param array $pattern Registered pattern, as stored by the registry.
 * @return array<string, mixed>
 */
function prepare_pattern( array $pattern ): array {
	$name = (string) $pattern['name'];

	return [
		'name'          => $name,
		'basename'      => basename_for( $name ),
		'title'         => (string) ( $pattern['title'] ?? $name ),
		'description'   => (string) ( $pattern['description'] ?? '' ),
		'categories'    => array_values( array_map( 'strval', (array) ( $pattern['categories'] ?? [] ) ) ),
		'keywords'      => array_values( array_map( 'strval', (array) ( $pattern['keywords'] ?? [] ) ) ),
		'blockTypes'    => array_values( array_map( 'strval', (array) ( $pattern['blockTypes'] ?? [] ) ) ),
		'postTypes'     => array_values( array_map( 'strval', (array) ( $pattern['postTypes'] ?? [] ) ) ),
		'viewportWidth' => (int) ( $pattern['viewportWidth'] ?? 0 ),
		'inserter'      => (bool) ( $pattern['inserter'] ?? true ),
		'source'        => (string) ( $pattern['source'] ?? '' ),
	];
}

/**
 * Strip the namespace from a pattern name, for use as a filename.
 *
 * `my-theme/hero` becomes `hero`. Names without a namespace are returned as-is.
 *
 * @param string $name Registered pattern name.
 */
function basename_for( string $name ): string {
	$position = strpos( $name, '/' );

	return false === $position ? $name : substr( $name, $position + 1 );
}
