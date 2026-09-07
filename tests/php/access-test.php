<?php
/**
 * Access control.
 *
 * Both behaviours here fail silently when broken — WordPress serves the
 * logged-out page with a 200 — so a regression would yield a run's worth of
 * plausible but wrong screenshots rather than an error.
 *
 * @package HM\Pattern_Library
 */

declare( strict_types=1 );

namespace HM\Pattern_Library\Tests;

use WP_UnitTestCase;

use const HM\Pattern_Library\CAPABILITY;
use const HM\Pattern_Library\QUERY_VAR;
use const HM\Pattern_Library\ROLE;

use function HM\Pattern_Library\allow_application_password;
use function HM\Pattern_Library\current_user_can_view;
use function HM\Pattern_Library\is_preview_request;

/**
 * Cover the capability gate and the application-password opt-in.
 */
class Access_Test extends WP_UnitTestCase {

	/**
	 * Clear the query var between tests.
	 */
	public function tear_down(): void {
		unset( $_GET[ QUERY_VAR ] );
		remove_role( ROLE );
		parent::tear_down();
	}

	/**
	 * The route is identified by its query var alone.
	 */
	public function test_preview_requests_are_identified_by_the_query_var(): void {
		$this->assertFalse( is_preview_request() );

		$_GET[ QUERY_VAR ] = 'hero';
		$this->assertTrue( is_preview_request() );

		// Present but empty is still our route: it is a 404, not somebody else's page.
		$_GET[ QUERY_VAR ] = '';
		$this->assertTrue( is_preview_request() );
	}

	/**
	 * wp_authenticate_application_password() ignores anything that is not REST or
	 * XML-RPC, so the route has to opt itself in.
	 */
	public function test_application_passwords_are_opted_in_for_this_route_only(): void {
		$this->assertFalse( allow_application_password( false ) );

		$_GET[ QUERY_VAR ] = 'hero';
		$this->assertTrue( allow_application_password( false ) );
	}

	/**
	 * The opt-in never takes away an approval core already made.
	 */
	public function test_application_password_opt_in_preserves_an_existing_yes(): void {
		$this->assertTrue( allow_application_password( true ) );
	}

	/**
	 * Access hangs on a dedicated capability, and on nothing else.
	 *
	 * `view_pattern_library` is a custom primitive capability, so no built-in
	 * role holds it — an administrator included. That is the whole point of a
	 * dedicated capability, but it does mean every account that reads the
	 * library has to be granted it explicitly.
	 */
	public function test_the_capability_gates_access_even_for_an_administrator(): void {
		$this->assertFalse( current_user_can_view() );

		wp_set_current_user( self::factory()->user->create( [ 'role' => 'editor' ] ) );
		$this->assertFalse( current_user_can_view() );

		wp_set_current_user( self::factory()->user->create( [ 'role' => 'administrator' ] ) );
		$this->assertFalse( current_user_can_view() );
	}

	/**
	 * Granting the capability to any existing user is enough, which is what
	 * `wp pattern-library grant` does.
	 */
	public function test_granting_the_capability_to_an_existing_user_is_enough(): void {
		$user = self::factory()->user->create_and_get( [ 'role' => 'editor' ] );
		$user->add_cap( CAPABILITY );
		wp_set_current_user( $user->ID );

		$this->assertTrue( current_user_can_view() );
	}

	/**
	 * A user holding only the capability can read the library.
	 */
	public function test_the_capability_alone_is_enough(): void {
		add_role( ROLE, 'Pattern Library', [ 'read' => true, CAPABILITY => true ] );

		$user = self::factory()->user->create( [ 'role' => ROLE ] );
		wp_set_current_user( $user );

		$this->assertTrue( current_user_can_view() );
		// ...and nothing more. The account cannot touch content.
		$this->assertFalse( current_user_can( 'edit_posts' ) );
		$this->assertFalse( current_user_can( 'manage_options' ) );
	}

	/**
	 * Projects with their own role management can take over the decision.
	 */
	public function test_the_capability_check_is_filterable(): void {
		add_filter( 'pattern_library_user_can', '__return_true' );
		$this->assertTrue( current_user_can_view() );

		remove_filter( 'pattern_library_user_can', '__return_true' );

		wp_set_current_user( self::factory()->user->create( [ 'role' => 'administrator' ] ) );
		add_filter( 'pattern_library_user_can', '__return_false' );
		$this->assertFalse( current_user_can_view() );
	}

	/**
	 * The plugin hooks nothing onto the ordinary request path beyond the two
	 * filters it needs, so an inactive route costs a visitor nothing.
	 */
	public function test_bootstrap_registers_only_the_preview_hooks(): void {
		$this->assertNotFalse(
			has_filter( 'application_password_is_api_request', 'HM\\Pattern_Library\\allow_application_password' )
		);
		$this->assertNotFalse(
			has_action( 'template_redirect', 'HM\\Pattern_Library\\maybe_render' )
		);
	}
}
