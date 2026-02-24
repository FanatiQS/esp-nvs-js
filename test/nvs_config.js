// @ts-check

import { assert } from "./assert.js";

/**
 * @typedef {import("../src/nvs_parser.js").nvs_value} nvs_value
 * @typedef {{ [key: string]: { [key: string]: nvs_value } }} test_nvs_compare
 * @typedef {{ [key: string]: { key: string, value: nvs_value, type?: string }[] }} test_nvs_config
 */

// NVS configuration data
export const nvs_config_default = {
	"uint-max": [
		{ key: "u8-max", type: "u8", value: 2 ** 8 - 1 },
		{ key: "u16-max", type: "u16", value: 2 ** 16 - 1 },
		{ key: "u32-max", type: "u32", value: 2 ** 32 - 1 },
		{ key: "u64-max", type: "u64", value: 2n ** 63n - 1n } // python doesn't support full range of unsigned 64-bit values
	],
	"uint-min": [
		{ key: "u8-min", type: "u8", value: 0 },
		{ key: "u16-min", type: "u16", value: 0 },
		{ key: "u32-min", type: "u32", value: 0 },
		{ key: "u64-min", type: "u64", value: 0 }
	],
	"int-max": [
		{ key: "i8-max", type: "i8", value: 2 ** 7 - 1 },
		{ key: "i16-max", type: "i16", value: 2 ** 15 - 1 },
		{ key: "i32-max", type: "i32", value: 2 ** 31 - 1 },
		{ key: "i64-max", type: "i64", value: 2n ** 63n - 1n }
	],
	"int-min": [
		{ key: "i8-min", type: "i8", value: -(2 ** 7) },
		{ key: "i16-min", type: "i16", value: -(2 ** 15) },
		{ key: "i32-min", type: "i32", value: -(2 ** 31) },
		{ key: "i64-min", type: "i64", value: -(2n ** 63n) }
	],
	"js-safe": [
		{ key: "safe-u64-max", type: "u64", value: Number.MAX_SAFE_INTEGER },
		{ key: "safe-i64-max", type: "i64", value: Number.MAX_SAFE_INTEGER },
		{ key: "safe-i64-min", type: "i64", value: -Number.MAX_SAFE_INTEGER }
	],
	"js-unsafe": [
		{ key: "unsafe-u64-max", type: "u64", value: BigInt(Number.MAX_SAFE_INTEGER) + 1n },
		{ key: "unsafe-i64-max", type: "i64", value: BigInt(Number.MAX_SAFE_INTEGER) + 1n },
		{ key: "unsafe-i64-min", type: "i64", value: -BigInt(Number.MAX_SAFE_INTEGER) - 1n }
	],
	"string": [
		{ key: "short", value: "banana" },
		{ key: "long", value: "0123456789abcdef".repeat(124 * 2 - 1) },
		{ key: "utf8", value: "åäö√ø†ç≈ƒ†=π¬…æ" },
		{ key: "emojis", value: "💂‍♂️" }
	],
	"blob": [
		{ key: "single-page", value: new Uint8Array(5).map((value, index) => index) },
		{ key: "multi-page", value: new Uint8Array(0x2000).map((value, index) => index) }
	],
	"extra": [
		{ key: "u64-unsafe", type: "u64", value: 2n ** 63n - 512n },
		{ key: "duplicate", type: "u8", value: 1 }
	],
	"empty": []
};

// Alternative NVS configuration data
export const nvs_config2 = {
	"extra": [
		{ key: "duplicate", type: "u8", value: 2 }
	]
};

// Usable space left in NVS page when accounting for page header, entry state bitmap and entry header
export const nvs_config_page_space_usable = 0x1000 - 64 - 32;

// Blobs aligned so index and chunks always lands on a separate pages
export const nvs_config_reorder = {
	"foo": [
		{ key: "small", value: new Uint8Array(nvs_config_page_space_usable - 32).map((value, index) => index) }, // single chunk
		{ key: "big", value: new Uint8Array(nvs_config_page_space_usable * 2 - 32).map((value, index) => index) } // multiple chunks
	]
};

/**
 * Asserts that configuration object used for generating firmware buffer is identical to compare data
 * @param {test_nvs_config} nvs_config
 * @param {test_nvs_compare} nvs_cmp
 */
export function nvs_config_assert(nvs_config, nvs_cmp) {
	/** @type {test_nvs_compare} */
	const nvs_config_cmp = {};
	for (const [ namespace, entries ] of Object.entries(nvs_config)) {
		if (!entries.length) continue;
		nvs_config_cmp[namespace] = Object.fromEntries(entries.map(({ key, value }) => [ key, value ]));
	}
	assert.deepStrictEqual(nvs_config_cmp, nvs_cmp);
}

/**
 * Asserts that configuration object used for generating firmware buffer is identical to NVS parser output
 * @param {test_nvs_config} nvs_config
 * @param {import("../src/nvs.js").NVS} nvs
 */
export function nvs_config_assert_nvs(nvs_config, nvs) {
	/** @type {test_nvs_compare} */
	const nvs_parsed_cmp = {};
	for (const [ namespace, key, value] of nvs) {
		const entries = nvs_parsed_cmp[namespace] ||= {};
		entries[key] = value;
	}
	nvs_config_assert(nvs_config, nvs_parsed_cmp);
}
