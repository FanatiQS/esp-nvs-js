import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";
import { defineConfig } from "eslint/config";

// cspell: ignore camelcase no-plusplus stroustrup linebreak

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
		plugins: { "@stylistic": stylistic },
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
			"consistent-return": "off",

			...stylistic.configs.all.rules,
			"@stylistic/space-before-function-paren": [ "error", { named: "never" } ],
			"@stylistic/object-property-newline": [ "error", { allowAllPropertiesOnSameLine: true }],
			"@stylistic/lines-around-comment": [ "error", { allowBlockStart: true, ignorePattern: "\\*" }],
			"@stylistic/array-element-newline": [ "error", "consistent" ],
			"@stylistic/indent": [ "error", "tab" ],
			"@stylistic/padded-blocks": [ "error", "never" ],
			"@stylistic/object-curly-spacing": [ "error", "always" ],
			"@stylistic/array-bracket-spacing": [ "error", "always" ],
			"@stylistic/function-call-argument-newline": [ "error", "consistent" ],
			"@stylistic/quote-props": [ "error", "as-needed" ],
			"@stylistic/brace-style": [ "error", "stroustrup" ],
			"@stylistic/multiline-ternary": [ "error", "never" ],
			"@stylistic/no-multiple-empty-lines": "off",
			"@stylistic/operator-linebreak": [ "error", "before"],
			"@stylistic/array-bracket-newline": [ "error", "consistent" ],
			"@stylistic/generator-star-spacing": [ "error", "after" ],
			"@stylistic/no-extra-parens": "off"
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
		name: "browser-src",
		files: [ "src/**/*.js" ],
		rules: {
			"prefer-destructuring": "off",
			"prefer-rest-params": "off"
		}
	},
	{
		name: "browser-test",
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
		name: "server-test",
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
