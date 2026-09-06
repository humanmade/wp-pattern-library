<?php
/**
 * PHPUnit bootstrap.
 *
 * The plugin is thin glue over WordPress' pattern registry, the block renderer
 * and the roles API, so these are integration tests against a real WordPress:
 * mocking that surface would test the mocks. `composer test` runs them inside
 * wp-env, where the test library lives at /wordpress-phpunit.
 *
 * @package HM\Pattern_Library
 */

declare( strict_types=1 );

require_once dirname( __DIR__, 2 ) . '/vendor/autoload.php';

define( 'WP_TESTS_PHPUNIT_POLYFILLS_PATH', dirname( __DIR__, 2 ) . '/vendor/yoast/phpunit-polyfills' );

$_tests_dir = getenv( 'WP_TESTS_DIR' ) ?: '/wordpress-phpunit';

if ( ! file_exists( $_tests_dir . '/includes/functions.php' ) ) {
	fwrite(
		STDERR,
		"Could not find the WordPress test library at {$_tests_dir}.\n" .
		"Run the suite with `composer test`, which executes it inside wp-env, or set WP_TESTS_DIR.\n"
	);
	exit( 1 );
}

require_once $_tests_dir . '/includes/functions.php';

tests_add_filter(
	'muplugins_loaded',
	static function (): void {
		require dirname( __DIR__, 2 ) . '/plugin.php';
	}
);

require $_tests_dir . '/includes/bootstrap.php';
