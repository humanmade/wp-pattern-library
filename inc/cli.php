<?php
/**
 * WP-CLI commands for provisioning pattern library access.
 *
 * The role is created by an explicit command rather than an activation hook:
 * provisioning also mints an application password, which has to be surfaced to
 * an operator once and cannot be recovered afterwards, and on multisite roles
 * are stored per site, so activating on one site would provision only that one.
 * It also keeps role writes out of the request path entirely.
 *
 * @package HM\Pattern_Library
 */

declare( strict_types=1 );

namespace HM\Pattern_Library\CLI;

use WP_CLI;

use const HM\Pattern_Library\CAPABILITY;
use const HM\Pattern_Library\ROLE;

/**
 * Register the commands.
 */
function bootstrap(): void {
	WP_CLI::add_command( 'pattern-library setup', __NAMESPACE__ . '\\setup' );
	WP_CLI::add_command( 'pattern-library grant', __NAMESPACE__ . '\\grant' );
}

/**
 * Create the pattern library role, and optionally a user holding it.
 *
 * The role holds `read` and `view_pattern_library` and nothing else — notably not
 * `edit_posts`, so the account cannot create or edit content.
 *
 * On multisite, roles are stored per site: run this with `--url=` for each site
 * whose patterns you intend to capture.
 *
 * ## OPTIONS
 *
 * [--login=<login>]
 * : Also create this user with the pattern library role, and print an
 *   application password for it. Grants the role if the user already exists.
 *   Named `--login` rather than `--user` because WP-CLI reserves `--user`
 *   globally for setting the acting user.
 *
 * [--email=<email>]
 * : Email for a user created via --login. Defaults to <login>@<site host>.
 *
 * ## EXAMPLES
 *
 *     wp pattern-library setup
 *     wp pattern-library setup --login=pattern-library-bot
 *
 * @param array $args       Positional arguments.
 * @param array $assoc_args Associative arguments.
 */
function setup( array $args, array $assoc_args ): void {
	remove_role( ROLE );
	$role = add_role(
		ROLE,
		'Pattern Library',
		[
			'read'     => true,
			CAPABILITY => true,
		]
	);

	if ( null === $role ) {
		WP_CLI::error( sprintf( 'Could not create the %s role.', ROLE ) );
	}

	WP_CLI::success( sprintf( 'Created the %s role with the %s capability.', ROLE, CAPABILITY ) );

	$login = (string) ( $assoc_args['login'] ?? '' );
	if ( '' === $login ) {
		WP_CLI::log( 'Grant an existing user access with: wp pattern-library grant <user>' );
		return;
	}

	$user = get_user_by( 'login', $login );

	if ( ! $user ) {
		$host  = (string) wp_parse_url( home_url(), PHP_URL_HOST );
		$email = (string) ( $assoc_args['email'] ?? $login . '@' . $host );

		$user_id = wp_insert_user(
			[
				'user_login' => $login,
				'user_email' => $email,
				'user_pass'  => wp_generate_password( 32, true, true ),
				'role'       => ROLE,
			]
		);

		if ( is_wp_error( $user_id ) ) {
			WP_CLI::error( $user_id->get_error_message() );
		}

		$user = get_user_by( 'id', $user_id );
		WP_CLI::success( sprintf( 'Created user %s (%d).', $login, (int) $user_id ) );
	} else {
		$user->add_role( ROLE );
		WP_CLI::success( sprintf( 'Granted the %s role to the existing user %s.', ROLE, $login ) );
	}

	print_application_password( $user );
}

/**
 * Grant the pattern library capability to an existing user.
 *
 * ## OPTIONS
 *
 * <user>
 * : User login, email, or ID.
 *
 * ## EXAMPLES
 *
 *     wp pattern-library grant editor@example.com
 *
 * @param array $args Positional arguments.
 */
function grant( array $args ): void {
	$user = get_user_by( 'login', $args[0] )
		?: get_user_by( 'email', $args[0] )
		?: get_user_by( 'id', (int) $args[0] );

	if ( ! $user ) {
		WP_CLI::error( sprintf( 'No such user: %s', $args[0] ) );
	}

	if ( ! wp_roles()->is_role( ROLE ) ) {
		WP_CLI::error( sprintf( 'The %s role does not exist on this site. Run `wp pattern-library setup` first.', ROLE ) );
	}

	$user->add_role( ROLE );
	WP_CLI::success( sprintf( 'Granted the %s role to %s.', ROLE, $user->user_login ) );

	print_application_password( $user );
}

/**
 * Mint and print an application password for a user.
 *
 * @param \WP_User $user User to create the password for.
 */
function print_application_password( \WP_User $user ): void {
	if ( ! wp_is_application_passwords_available_for_user( $user ) ) {
		WP_CLI::warning( 'Application passwords are unavailable for this user. They require HTTPS, or WP_ENVIRONMENT_TYPE=local.' );
		return;
	}

	$created = \WP_Application_Passwords::create_new_application_password( $user->ID, [ 'name' => 'Pattern Library' ] );

	if ( is_wp_error( $created ) ) {
		WP_CLI::error( $created->get_error_message() );
	}

	WP_CLI::log( '' );
	WP_CLI::log( 'Store these as CI secrets — the password is not recoverable:' );
	WP_CLI::log( '  PATTERN_LIBRARY_WP_USER=' . $user->user_login );
	WP_CLI::log( '  PATTERN_LIBRARY_WP_APP_PASSWORD=' . $created[0] );
}
