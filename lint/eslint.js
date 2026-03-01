import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

// cspell: ignore camelcase no-plusplus

// Test server files that run in node
const files_server_test = [
	"test/index.js",
	"test/partitions.js"
];

export default defineConfig([
	{
		ignores: [ "coverage/**/*" ]
	},
	{
		name: "default",
		files: [ "src/**/*.js", "test/**/*.js" ],
		rules: {
			...js.configs.all.rules,
			"one-var": [ "error", "never" ],
			"func-style": [ "error", "declaration" ],
			"object-shorthand": [ "error", "methods" ],
			"id-length": [ "error", { min: 3, exceptions: [ "i", "j", "ns", "ui" ] } ],
			"capitalized-comments": [ "error", "always", { ignoreInlineComments: true, ignorePattern: "cspell: .*" } ],
			"eqeqeq": [ "error", "always", { null: "ignore" } ],
			"complexity": [ "error", { variant: "modified" } ],
			"curly": [ "error", "multi-line" ],
			"prefer-const": [ "error", { destructuring: "all" } ],
			"camelcase": "off",
			"no-plusplus": "off",
			"no-bitwise": "off",
			"no-ternary": "off",
			"no-continue": "off",
			"no-eq-null": "off",
			"max-statements": "off",
			"max-lines-per-function": "off",
			"max-lines": "off",
			"max-params": "off",
			"no-await-in-loop": "off",
			"no-inline-comments": "off",
			"init-declarations": "off",
			"no-multi-assign": "off",
			"no-magic-numbers": "off",
			"sort-keys": "off",
			"sort-imports": "off",
			"no-undefined": "off"
		}
	},
	{
		name: "browser",
		ignores: files_server_test,
		languageOptions: {
			globals: {
				SerialPort: true,
				...globals.browser
			}
		}
	},
	{
		name: "src exceptions",
		files: [ "src/**/*.js" ],
		rules: {
			"prefer-destructuring": "off",
			"prefer-rest-params": "off"
		}
	},
	{
		name: "test exceptions",
		files: [ "test/**/*.js" ],
		ignores: files_server_test,
		languageOptions: {
			globals: {
				test: true,
			}
		},
		rules: {
			"no-new": "off",
			"no-empty-function": "off",
			"class-methods-use-this": "off",
			"capitalized-comments": "off",
			"require-await": "off"
		}
	},
	{
		name: "test server",
		files: files_server_test,
		languageOptions: {
			globals: {
				...globals.nodeBuiltin
			}
		},
		rules: {
			"capitalized-comments": "off"
		}
	}
]);
