import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

// cspell: ignore camelcase no-plusplus

const rules_base = {
	"one-var": [ "error", "never" ],
	"func-style": [ "error", "declaration" ],
	"object-shorthand": [ "error", "consistent-as-needed" ],
	"id-length": [ "error", { min: 3, exceptions: [ "i", "j", "ns" ] } ],
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
	"sort-imports": "off"
};

export default defineConfig([
	{
		files: [ "src/**/*.js" ],
		plugins: { js },
		extends: [ "js/all" ],
		languageOptions: {
			globals: {
				SerialPort: true,
				...globals.browser
			}
		},
		rules: {
			...rules_base,
			"prefer-destructuring": "off"
		}
	},
	{
		files: [ "test/**/*.js" ],
		plugins: { js },
		extends: [ "js/all" ],
		languageOptions: {
			globals: {
				SerialPort: true,
				...globals.nodeBuiltin
			}
		},
		rules: {
			...rules_base,
			"no-new": "off",
			"no-empty-function": "off",
			"class-methods-use-this": "off",
			"capitalized-comments": "off",
			"require-await": "off"
		}
	}
]);
