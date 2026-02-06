import assert from "node:assert";
import test from "node:test";

import { createLoader } from "./loader.js";
import { NVS } from "../src/nvs.js";
import { firmware_generate, firmware_assemble } from "./test_parser.js";
import "./stub_serialport.js";
import { firmware_generate_partitions } from "./firmware_generate.js";

/**
 * @typedef {Object<string,Object<string,string|number|bigint|Uint8Array>>} test_nvs_compare
 */

// NVS configuration data
const nvs_config = {
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
		{ key: "short", type: "string", value: "banana" },
		{ key: "long", type: "string", value: "0123456789abcdef".repeat(124 * 2 - 1) + "0123456789abcde" },
		{ key: "utf8", type: "string", value: "åäö√ø†ç≈ƒ†=π¬…æ" },
		{ key: "emojis", type: "string", value: "💂‍♂️" }
	],
	"blob": [
		{ key: "single-page", type: "hex2bin", value: new Uint8Array(5).map((value, index) => index) },
		{ key: "multi-page", type: "hex2bin", value: new Uint8Array(0x2000).map((value, index) => index) }
	],
	"extra": [
		{ key: "u64-unsafe", type: "u64", value: 2n ** 63n - 512n },
		{ key: "duplicate", type: "u8", value: 1 }
	]
};

// Generates firmware buffer
await firmware_generate([
	{ name: "phy_init", type: "data", subtype: "phy", size: 0x1000 },
	{ name: "nvs", type: "data", subtype: "nvs", size: 0x6000, data: nvs_config },
	{ name: "factory", type: "app", subtype: "factory", size: 0x10000 }
]);

// Creates loader using generated firmware buffer
const loader = createLoader(await firmware_assemble());

// Creates compare object from config data
/** @type {test_nvs_compare} */
const nvs_config_cmp = {};
for (const [ namespace, entries ] of Object.entries(nvs_config)) {
	nvs_config_cmp[namespace] = Object.fromEntries(entries.map(({ key, value }) => [ key, value ]));
}



/**
 * Creates a loader that asserts every page was requested
 * @param {Uint8Array} firmware
 * @param {{ addr: number, size: number }[]} partitions
 */
function createLoaderAssertPartitions(firmware, partitions) {
	let offset = 0;
	return createLoader(firmware.buffer, (addr, size) => {
		const partition = partitions[0];
		assert(addr === (partition.addr + offset));
		offset += size;
		assert(offset <= partition.size);
		if (offset === partition.size) {
			partitions.shift();
			offset = 0;
		}
	});
}

// Assert that all NVS pages in manually specified partition are requested
test("all pages requested", async () => {
	const addr = 0x9000;
	const size = 0x4000;
	const partitions = [ { addr, size } ];
	const firmware = new Uint8Array(addr + size);
	firmware.fill(0xff);
	const nvs = new NVS(createLoaderAssertPartitions(firmware, partitions));
	nvs.addFlashAddr(addr, size);
	await nvs.next();
	assert(partitions.length === 0);
});

// Asserts iterator data is identical to configuration used to create it
test("parser", async () => {
	const nvs = new NVS(loader);
	await nvs.all();

	/** @type {test_nvs_compare} */
	const parsed_cmp = {};
	for (const [ namespace, key, value] of nvs) {
		const entries = parsed_cmp[namespace] || (parsed_cmp[namespace] = {});
		entries[key] = value;
	}
	assert.deepStrictEqual(nvs_config_cmp, parsed_cmp);
});

// Asserts JSON data is identical to configuration used to create it
test("parsed JSON", async () => {
	const nvs = new NVS(loader);
	await nvs.all();

	/** @type {test_nvs_compare} */
	const cmp_json = {};
	for (const [ namespace, entries ] of Object.entries(nvs.toJSON())) {
		cmp_json[namespace] = Object.fromEntries(Object.entries(entries).map(([ key, value]) => {
			// No conversion needed
			if (typeof value !== "object") {
				return [ key, value ];
			}
			// Converts JSON numbers array back to Uint8Array
			else if (Array.isArray(value)) {
				return [ key, new Uint8Array(value) ];
			}
			// Converts JSON bigint back to bigint primitive
			else {
				return [ key, BigInt(value.value) + BigInt(value.diff) ];
			}
		}));
	}
	assert.deepStrictEqual(nvs_config_cmp, cmp_json);

});

// Asserts that all existing NVS pages are requested with correct address and size
test("pages from partition table", async () => {
	const partitions = [
		{ addr: 0x8000, size: 0xc00 },
		{ addr: 0x9000, size: 0x2000 },
		{ addr: 0x10000, size: 0x3000 }
	];
	const firmware = firmware_generate_partitions([
		{ type: 0x0102, size: 0x2000, name: "foo" },
		{ type: 0x0000, size: 0x5000, name: "bar" },
		{ type: 0x0102, size: 0x3000, name: "baz" }
	], 0x8000);
	const nvs = new NVS(createLoaderAssertPartitions(firmware, partitions));
	await nvs.next();
	assert(partitions.length === 0);
});
