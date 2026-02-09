// @ts-check

/// <reference path="./types.d.ts" />

import assert from "node:assert";
import test from "node:test";
import { ESPLoader } from "esptool-js";

import { loader_from_map } from "./loader.js";
import { NVS } from "../src/nvs.js";
import { firmware_generate, firmware_assemble, firmware_assert, firmware_assert_nvs } from "./firmware.js";
import "./stub_serialport.js";

// Prevents ESPLoader from printing to the console
ESPLoader.prototype.write = () => {};

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
		{ key: "short", value: "banana" },
		{ key: "long", value: "0123456789abcdef".repeat(124 * 2 - 1) + "0123456789abcde" },
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
	]
};

// Alternative NVS configuration data
const nvs_config2 = {
	"extra": [
		{ key: "duplicate", type: "u8", value: 2 }
	]
};

// Generates firmware buffer
await firmware_generate([
	{ name: "phy_init", type: "data", subtype: "phy", size: 0x1000 },
	{ name: "nvs", type: "data", subtype: "nvs", size: 0x6000, data: nvs_config },
	{ name: "factory", type: "app", subtype: "factory", size: 0x10000 },
	{ name: "nvs2", type: "data", subtype: "nvs", size: 0x6000, data: nvs_config2 }
]);

// Creates loader using generated firmware buffer
const loader_map = await firmware_assemble();
const loader = loader_from_map(loader_map);



// Currently BigInts are not supported in JSON
test("JSON not support BigInt", () => {
	assert.throws(() => JSON.stringify(1n));
});

// Asserts that a type cast used in the NVS constructor is still required
test("internal cast required", () => {
	// @ts-expect-error
	new ESPLoader({ port: new SerialPort() });
});

// Assert that all pages in manually specified NVS partition are requested
test("set pages assert all requested", async () => {
	const addr = 0x9000;
	const size = 0x4000;
	const page_size = 0x1000;

	// Creates loader map with partition table that should not be read
	/** @type {test_loader_map} */
	const loader_map = new Map();
	const partition_table = { read: false, data: new Uint8Array(0) };
	loader_map.set(0x8000, partition_table);

	// Adds NVS pages to loader map
	const nvs_pages = [];
	for (let i = 0; i < size; i += page_size) {
		const page_data = new Uint8Array(page_size);
		page_data.fill(0xff);
		const page = { read: false, data: page_data };
		nvs_pages.push(page);
		loader_map.set(addr + i, page);
	}

	// Reads manually specified partition
	const nvs = new NVS(loader_from_map(loader_map));
	nvs.setPartition(addr, size);
	await nvs.next();

	// Asserts that all default NVS pages were read and nothing else
	assert(!partition_table.read);
	for (const page of nvs_pages) {
		assert(page.read);
	}
});

// Asserts that all pages in default NVS partition are requested
test("fetch pages assert all requested", async () => {
	// Clears read flag from previous tests
	for (const entry of loader_map.values()) {
		entry.read = false;
	}

	// Reads default partition
	const nvs = new NVS(loader);
	const found = await nvs.fetchPartition();
	assert(found);
	await nvs.all();

	// Asserts that all default NVS pages were read along with partition table but nothing else
	for (const entry of loader_map.values()) {
		if (!entry.name || entry.name === "nvs") {
			assert(entry.read);
		}
	}
});

// Asserts iterator data is identical to configuration used to create it
test("parser", async () => {
	const nvs = new NVS(loader);
	await nvs.all();
	firmware_assert_nvs(nvs_config, nvs);
});

// Asserts that output from .toJSON can be serialized
test("JSON serializable", async () => {
	const nvs = new NVS(loader);
	await nvs.all();
	JSON.stringify(nvs.toJSON());
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
				assert(value.value > Number.MAX_SAFE_INTEGER || value.value < Number.MIN_SAFE_INTEGER);
				return [ key, BigInt(value.value) + BigInt(value.diff) ];
			}
		}));
	}
	firmware_assert(nvs_config, cmp_json);
});

// Asserts that specifying a non default NVS partition parses correct partition
test("non default nvs partition", async () => {
	const nvs = new NVS(loader);
	const found = await nvs.fetchPartition("nvs2");
	assert(found);
	await nvs.all();
	firmware_assert_nvs(nvs_config2, nvs);
});

// Ensures constructor with serial port creates ESPLoader using serial port
test("serial port NVS constructor argument", () => {
	let called = false;
	const port = new SerialPort();
	port.getInfo = () => {
		called = true;
		return {};
	};
	const nvs = new NVS(port);
	assert(called);
});

// Ensures wrong type of argument is rejected by typescript
test("NVS constructor wrong or missing argument", () => {
	// @ts-expect-error
	assert.throws(() => new NVS());
	// @ts-expect-error
	new NVS({});
});
