/**
 * Lint configuration for the Node half of the package — the CLI in `bin/` and
 * the modules in `src/` that npm publishes.
 *
 * The WordPress plugin's PHP is covered by phpcs.xml and phpstan.neon.dist; this
 * file has nothing to say about it.
 */

import globals from 'globals';
import wordpress from '@wordpress/eslint-plugin';

export default [
	{
		ignores: [ 'node_modules/**', 'vendor/**', 'docs/**' ],
	},

	...wordpress.configs[ 'recommended-with-formatting' ].map( ( config ) => ( {
		...config,
		files: [ 'bin/**/*.mjs', 'src/**/*.mjs', 'tests/**/*.mjs', 'eslint.config.mjs' ],
	} ) ),

	{
		files: [ 'bin/**/*.mjs', 'src/**/*.mjs', 'tests/**/*.mjs', 'eslint.config.mjs' ],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: {
				...globals.node,
			},
		},
		rules: {
			// This package ships no WordPress-facing JavaScript, so there is
			// nothing to translate and no i18n runtime to call into.
			'@wordpress/i18n-text-domain': 'off',
			'@wordpress/i18n-translator-comments': 'off',
			'@wordpress/no-unused-vars-before-return': 'off',

			// The CLI is a Node program, not a browser bundle: it reads
			// process.env and writes to stdout by design.
			'no-console': 'off',

			// Resolved against the published `dependencies`, not a bundler.
			'import/no-unresolved': 'off',
			'import/no-extraneous-dependencies': 'off',

			// Every exported function here carries a docblock; enforce it.
			'jsdoc/require-param': 'error',
			'jsdoc/require-returns': 'off',
		},
	},

	{
		// Playwright evaluates these in the page, where `document` is the point.
		files: [ 'src/animations.mjs', 'src/capture.mjs' ],
		languageOptions: {
			globals: {
				...globals.node,
				...globals.browser,
			},
		},
	},
];
