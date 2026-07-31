<?php
/**
 * Plugin Name: WP Pattern Library
 * Description: Serves a manifest and isolated previews of the site's registered block patterns.
 * Version: 0.1.0
 * License: GPL-2.0-or-later
 * Requires PHP: 8.1
 *
 * Installs as a regular plugin, so the consuming project activates it the same
 * way it activates any other — through wp-admin, `wp plugin activate`, or the
 * platform's code-activation helper (`wpcom_vip_load_plugin()` on VIP,
 * `Altis\Enable_Plugins\load_plugins()` on Altis).
 *
 * @package HM\Pattern_Library
 */

namespace HM\Pattern_Library;

require_once __DIR__ . '/inc/namespace.php';
require_once __DIR__ . '/inc/manifest.php';
require_once __DIR__ . '/inc/render.php';

if ( defined( 'WP_CLI' ) && WP_CLI ) {
	require_once __DIR__ . '/inc/cli.php';
	CLI\bootstrap();
}

bootstrap();
