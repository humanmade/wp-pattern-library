<?php
/**
 * Plugin Name: WP Pattern Library
 * Description: Serves a manifest and isolated previews of the site's registered block patterns.
 * Version: 0.1.0
 * License: GPL-2.0-or-later
 * Requires PHP: 8.1
 *
 * Installs as an mu-plugin. Because mu-plugins in subdirectories are not
 * auto-loaded, the consuming project must require this file from its own loader:
 *
 *   Altis: add the package to `extra.mu-plugins` in composer.json.
 *   VIP:   require it from `client-mu-plugins/plugin-loader.php`.
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
