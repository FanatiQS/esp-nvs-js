// @ts-check

/// <reference path="./types.d.ts" />

import assert from "node:assert";
import test from "node:test";
import { ESPLoader } from "esptool-js";

import { loader_from_map } from "./loader.js";
import { NVS, nvs_pages_lookup } from "../src/index.js";
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
const nvs_config2 = {
	"extra": [
		{ key: "duplicate", type: "u8", value: 2 }
	]
};

// Usable space left in NVS page when accounting for page header, entry state bitmap and entry header
const nvs_page_usable_space = 0x1000 - 64 - 32;

// Blobs aligned so index and chunks always lands on a separate pages
const nvs_config_reorder = {
	"foo": [
		{ key: "small", value: new Uint8Array(nvs_page_usable_space - 32).map((value, index) => index) }, // single chunk
		{ key: "big", value: new Uint8Array(nvs_page_usable_space * 2 - 32).map((value, index) => index) } // multiple chunks
	]
};

// Generates firmware buffer
await firmware_generate([
	{ name: "phy_init", type: "data", subtype: "phy", size: 0x1000 },
	{ name: "nvs", type: "data", subtype: "nvs", size: 0x6000, data: nvs_config },
	{ name: "factory", type: "app", subtype: "factory", size: 0x10000 },
	{ name: "nvs2", type: "data", subtype: "nvs", size: 0x4000, data: nvs_config2 },
	{ name: "duplicate-keys", type: "data", subtype: "nvs", size: 0x3000, data: {
		"foo": [
			{ key: "bar", type: "u8", value: 1 },
			{ key: "bar", type: "i16", value: 2 }
		]
	}},
	{ name: "blob-data-on-str", type: "data", subtype: "nvs", size: 0x5000, data: {
		"foo": [
			{ key: "baz", value: "0".repeat(nvs_page_usable_space - 1 - 32) }, // string filling to end of page
			{ key: "bar", value: 1, type: "u8" }, // dummy data since string can for some reason not fill page by itself
			{ key: "baz", value: new Uint8Array(nvs_page_usable_space).map((value, index) => index) } // blob with data and index in separate pages
		]
	}},
	{ name: "reorder", type: "data", subtype: "nvs", size: 0x5000, data: nvs_config_reorder }
]);

// Creates loader using generated firmware buffer
const page_map = await firmware_assemble();
const loader = loader_from_map(page_map);



/**
 * Goes through every page order permutation in partition
 * @param {string} partition_name
 */
async function* pages_reorder(partition_name) {
	/** @type {test_page_map} */
	const page_map_copy = new Map();

	// Deep copies page map for modification
	for (const [ addr, page ] of page_map) {
		if (page.name === partition_name) {
			page_map_copy.set(addr, { ...page });
		}
	}
	const nvs_pages = Array.from(page_map_copy.values());

	// Adds partition table to page map copy
	const partition_table_map_entry = page_map.get(0x8000);
	assert(partition_table_map_entry);
	page_map_copy.set(0x8000, partition_table_map_entry);

	// Goes through all NVS page order permutations
	const counters = new Array(nvs_pages.length).fill(0);
	let i = 1;
	while (i < nvs_pages.length) {
		if (counters[i] < i) {
			const j = i % 2 && counters[i];
			const temp = nvs_pages[i].data;
			nvs_pages[i].data = nvs_pages[j].data;
			nvs_pages[j].data = temp;
			counters[i]++;
			i = 1;

			// Instantiates NVS parser with page map permutation
			const nvs = new NVS(loader_from_map(page_map_copy));
			const found = await nvs.fetchPartition(partition_name);
			assert(found);
			yield nvs;
		}
		else {
			counters[i] = 0;
			i++;
		}
	}
}

/**
 * Clones first nvs page of specified partition so it can safely be modified since just creating a new map from another is a shallow copy
 * @param {ESPLoader} loader
 * @param {test_page_map} page_map_modified
 * @param {string} [partition_name]
 */
async function clone_page_first(loader, page_map_modified, partition_name) {
	assert(page_map_modified !== page_map);

	const addr_list = /** @type {number[]} */([]);
	await loader.connect();
	assert(await nvs_pages_lookup(loader, addr_list, partition_name));
	const [ addr ] = addr_list;
	const page = page_map_modified.get(addr);
	assert(page);

	const data = new Uint8Array(page.data);
	page_map_modified.set(addr, {
		name: page.name,
		read: false,
		data: data
	});
	return data;
}



// Assert that all pages in manually specified NVS partition are requested
test("set pages assert all requested", async () => {
	const addr = 0x9000;
	const size = 0x4000;
	const page_size = 0x1000;

	// Creates loader map with partition table that should not be read
	/** @type {test_page_map} */
	const page_map = new Map();
	const partition_table = { read: false, data: new Uint8Array(0) };
	page_map.set(0x8000, partition_table);

	// Adds NVS pages to loader map
	const nvs_pages = [];
	for (let i = 0; i < size; i += page_size) {
		const page = { read: false, data: new Uint8Array(page_size).fill(0xff) };
		nvs_pages.push(page);
		page_map.set(addr + i, page);
	}

	// Reads manually specified partition
	const nvs = new NVS(loader_from_map(page_map));
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
	for (const entry of page_map.values()) {
		entry.read = false;
	}

	// Reads default partition
	const nvs = new NVS(loader);
	const found = await nvs.fetchPartition();
	assert(found);
	await nvs.all();

	// Asserts that all default NVS pages were read along with partition table but nothing else
	for (const entry of page_map.values()) {
		if (!entry.name || entry.name === "nvs") {
			assert(entry.read);
		}
	}
});

// Asserts that specifying a non default NVS partition parses correct partition
test("non default nvs partition", async () => {
	const nvs = new NVS(loader);
	const found = await nvs.fetchPartition("nvs2");
	assert(found);
	await nvs.all();
	firmware_assert_nvs(nvs_config2, nvs);
});

// Searches for NVS partition by name without success
test("missing nvs partition", async () => {
	const nvs = new NVS(loader);
	const found = await nvs.fetchPartition("no-exist");
	assert(found === false);
});



// Asserts iterator data is identical to configuration used to create it
test("parser", async () => {
	const nvs = new NVS(loader);
	await nvs.all();
	firmware_assert_nvs(nvs_config, nvs);
});

// Searching for specified value
test("search for value", async () => {
	const nvs = new NVS(loader);
	const value = await nvs.get("extra", "duplicate");
	assert(value === 1);
});

// Searching for non existent namespace
test("no existent namespace", async () => {
	const nvs = new NVS(loader);
	const value = await nvs.get("foo", "bar");
	assert(value === null);
});

// Searching for non existent key
test("no existent key", async () => {
	const nvs = new NVS(loader);
	const value = await nvs.get("extra", "foo");
	assert(value === null);
});

// Searching for key in empty namespace
test("empty namespace", async () => {
	const nvs = new NVS(loader);
	const value = await nvs.get("empty", "foo");
	assert(value === null);
});

// Ensures blob data received in different orders is still handled correctly
test("out of order blob", async () => {
	for await (const nvs of pages_reorder("reorder")) {
		await nvs.all();
		firmware_assert_nvs(nvs_config_reorder, nvs);
	}
});

// Ensures entry is returned from .next between blob entry existing and it being assembled
test("full value between blob chunks in search", async () => {
	for await (const nvs of pages_reorder("reorder")) {
		assert(ArrayBuffer.isView(await nvs.get("foo", "big")));
	}
});

// Asserts that clearing out some of the pages will result in an incomplete blob when iterating
test("incomplete blob in iterator", async () => {
	let done = false;
	for (const [ addr, page ] of page_map) {
		if (page.name === "reorder") {
			// Blanks out NVS page and parses modified page map
			const page_map_modified = new Map(page_map);
			page_map_modified.set(addr, {
				name: page.name,
				read: false,
				data: new Uint8Array(page.data.byteLength).fill(0xff)
			});
			const nvs = new NVS(loader_from_map(page_map_modified));
			await nvs.fetchPartition("reorder");
			await nvs.all();

			// Test successful when iterating over nvs throws because of incomplete blob
			try {
				for (const a of nvs) {}
			}
			catch (err) {
				done = true;
				break;
			}
		}
	}
	assert(done);
});

// Parsing should do nothing if it has already parsed to the end
test("nothing after complete", async () => {
	const nvs = new NVS(loader);
	await nvs.all();
	await nvs.all();
});



// Not allowed to set partition when already defined
test("no double set partition", async () => {
	const nvs = new NVS(loader);
	nvs.setPartition(0x9000, 0x6000);
	assert.throws(() => nvs.setPartition(0x9000, 0x6000));
});

// Not allowed to fetch partition when already defined
test("no double fetch partition", async () => {
	const nvs = new NVS(loader);
	const found = await nvs.fetchPartition();
	assert(found);
	await assert.rejects(async () => nvs.fetchPartition());
});

// Asserts empty partition table can fetch without reject and fails on .next
test("empty partition table", async () => {
	const page_map = new Map();
	page_map.set(0x8000, { read: false, data: new Uint8Array(0xc00).fill(0xff) });
	const nvs = new NVS(loader_from_map(page_map));
	assert(!await nvs.fetchPartition());
	await assert.rejects(async () => await nvs.next());
});

// Asserts zeroed out partition table can fetch without reject and fails on .next
test("zeroed partition table", async () => {
	const page_map = new Map();
	page_map.set(0x8000, { read: false, data: new Uint8Array(0xc00) });
	const nvs = new NVS(loader_from_map(page_map));
	assert(!await nvs.fetchPartition());
	await assert.rejects(async () => await nvs.next());
});



// Reject multiple keys in the same namespace
test("duplicate keys", async () => {
	const nvs = new NVS(loader);
	const found = await nvs.fetchPartition("duplicate-keys");
	assert(found);
	await assert.rejects(async () => await nvs.all());
});

// Reject blob data entry that uses the same key as entry with other data type
test("blob data collide with string", async () => {
	const nvs = new NVS(loader);
	const found = await nvs.fetchPartition("blob-data-on-str");
	assert(found);
	await assert.rejects(async () => await nvs.all());
});

// Reject blob index entry that uses the same key as entry with other data type
test("blob index collide with string", async () => {
	for await (const nvs of pages_reorder("blob-data-on-str")) {
		await assert.rejects(async () => await nvs.all());
	}
});

// Asserts invalid entry state is rejected
test("invalid entry state", async () => {
	const addr_bitmap_offset = 32;
	const page_map_modified = new Map(page_map);
	const loader = loader_from_map(page_map_modified);
	const data = await clone_page_first(loader, page_map_modified);
	data[addr_bitmap_offset] = 0x01;
	const nvs = new NVS(loader);
	await assert.rejects(async () => await nvs.all());
});

// Asserts invalid entry type is rejected
test("invalid entry type", async () => {
	const addr_entry_offset = 64;
	const page_map_modified = new Map(page_map);
	const loader = loader_from_map(page_map_modified);
	const data = await clone_page_first(loader, page_map_modified);
	data.fill(0xff, addr_entry_offset);
	const nvs = new NVS(loader);
	await assert.rejects(async () => await nvs.all());
});



// Currently BigInts are not supported in JSON
test("JSON not support BigInt", () => {
	assert.throws(() => JSON.stringify(1n));
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
	for (const [ namespace, object ] of Object.entries(nvs.toJSON())) {
		const entries = Object.entries(object);
		if (!entries.length) continue;
		cmp_json[namespace] = Object.fromEntries(entries.map(([ key, value]) => {
			// Converts JSON numbers array back to Uint8Array
			if (Array.isArray(value)) {
				return [ key, new Uint8Array(value) ];
			}

			// Converts JSON bigint back to bigint primitive
			if (typeof value === "object") {
				assert(value.value > Number.MAX_SAFE_INTEGER || value.value < Number.MIN_SAFE_INTEGER);
				return [ key, BigInt(value.value) + BigInt(value.diff) ];
			}

			// No conversion needed
			return [ key, value ];
		}));
	}
	firmware_assert(nvs_config, cmp_json);
});



// Asserts that a type cast used in the NVS constructor is still required
test("internal cast required", () => {
	// @ts-expect-error
	new ESPLoader({ port: new SerialPort() });
});

// Ensures constructor with serial port creates ESPLoader using serial port
test("serial port NVS constructor argument", () => {
	let called = false;
	const port = new SerialPort();
	port.getInfo = () => {
		called = true;
		return {};
	};
	new NVS(port);
	assert(called);
});

// Ensures wrong type of argument is rejected by typescript
test("NVS constructor wrong or missing argument", () => {
	// @ts-expect-error
	assert.throws(() => new NVS());
	// @ts-expect-error
	new NVS({});
});
