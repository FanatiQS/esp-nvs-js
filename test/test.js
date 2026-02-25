// @ts-check

import { NVS } from "../src/index.js";
import { ESPLoader } from "../src/esptool.js";

import { assert } from "./assert.js";
import { loader_from_map, loader_map_get_addr, loader_map_get_data, loader_map_from, loader_map_fetch, loader_fetch } from "./loader.js";
import { nvs_config_default, nvs_config2, nvs_config_reorder, nvs_config_assert, nvs_config_assert_nvs } from "./nvs_config.js";
import { serialport_stub } from "./stub_serialport.js";

// Prevents ESPLoader from printing to the console
ESPLoader.prototype.write = () => {};



/**
 * Goes through every page order permutation in partition
 * @param {string} partition_name
 */
async function* pages_reorder(partition_name) {
	const loader_map = await loader_map_fetch(partition_name);
	const nvs_pages = Array.from(loader_map.values()).filter((page) => !page.is_table);
	assert(nvs_pages.length > 1);

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
			const nvs = new NVS(loader_from_map(loader_map));
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



// Assert that all pages in manually specified NVS partition are requested
test("set pages assert all requested", async () => {
	// Creates loader map without partition table
	const addr = await loader_map_get_addr("nvs");
	const data = await loader_map_get_data("nvs");
	const loader_map = loader_map_from(addr, data);

	// Reads manually specified partition
	const nvs = new NVS(loader_from_map(loader_map));
	nvs.setPartition(addr, data.byteLength);
	await nvs.all();

	// Asserts that all NVS pages were read
	for (const page of loader_map.values()) {
		assert(page.read);
	}
});

// Asserts that all pages in default NVS partition are requested
test("fetch pages assert all requested", async () => {
	// Creates loader map with partition table
	const loader_map = await loader_map_fetch();

	// Reads default partition
	const nvs = new NVS(loader_from_map(loader_map));
	const found = await nvs.fetchPartition();
	assert(found);
	await nvs.all();

	// Asserts that all default NVS pages were read along with partition table
	for (const entry of loader_map.values()) {
		assert(entry.read);
	}
});

// Asserts that specifying a non default NVS partition parses correct partition
test("load and parse non default nvs partition", async () => {
	const nvs = new NVS(await loader_fetch("nvs2"));
	const found = await nvs.fetchPartition("nvs2");
	assert(found);
	await nvs.all();
	nvs_config_assert_nvs(nvs_config2, nvs);
});

// Searches for NVS partition by name without success
test("missing nvs partition", async () => {
	const nvs = new NVS(await loader_fetch());
	const found = await nvs.fetchPartition("no-exist");
	assert(found === false);
});



// Asserts iterator data is identical to configuration used to create it
test("load and parse default nvs partition", async () => {
	const nvs = new NVS(await loader_fetch());
	await nvs.all();
	nvs_config_assert_nvs(nvs_config_default, nvs);
});

// Searching for specified value
test("search for value", async () => {
	const nvs = new NVS(await loader_fetch());
	const value = await nvs.get("extra", "duplicate");
	assert(value === 1);
});

// Searching for non existent namespace
test("no existent namespace", async () => {
	const nvs = new NVS(await loader_fetch());
	const value = await nvs.get("foo", "bar");
	assert(value === null);
});

// Searching for non existent key
test("no existent key", async () => {
	const nvs = new NVS(await loader_fetch());
	const value = await nvs.get("extra", "foo");
	assert(value === null);
});

// Searching for key in empty namespace
test("empty namespace", async () => {
	const nvs = new NVS(await loader_fetch());
	const value = await nvs.get("empty", "foo");
	assert(value === null);
});

// Ensures blob data received in different orders is still handled correctly
test("out of order blob", async () => {
	for await (const nvs of pages_reorder("reorder")) {
		await nvs.all();
		nvs_config_assert_nvs(nvs_config_reorder, nvs);
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
	const loader_map = await loader_map_fetch("reorder");
	assert(Array.from(loader_map.values()).some(async (page) => {
		// Blanks out NVS page and parses everything
		page.data.fill(0xff);
		const nvs = new NVS(loader_from_map(loader_map));
		await nvs.fetchPartition("reorder");
		await nvs.all();

		// Test successful when iterating over nvs throws because of incomplete blob
		const iterator = nvs[Symbol.iterator]();
		try {
			while (!iterator.next().done);
		}
		catch {
			return true;
		}
		return false;
	}));
});

// Parsing should do nothing if it has already parsed to the end
test("nothing after complete", async () => {
	const nvs = new NVS(await loader_fetch());
	await nvs.all();
	await nvs.all();
});



// Not allowed to set partition when already defined
test("no double set partition", async () => {
	const addr = 0x9000;
	const size = 0x6000;
	const nvs = new NVS(loader_from_map(new Map()));
	nvs.setPartition(addr, size);
	assert.throws(() => nvs.setPartition(addr, size));
});

// Not allowed to fetch partition when already defined
test("no double fetch partition", async () => {
	const nvs = new NVS(await loader_fetch());
	const found = await nvs.fetchPartition();
	assert(found);
	await assert.isRejected(nvs.fetchPartition());
});

// Asserts empty partition table can fetch without reject and fails on .next
test("empty partition table", async () => {
	const partition_table_data = await loader_map_get_data("partition_table");
	const loader_map = new Map([[ 0x8000, { is_table: true, read: false, data: partition_table_data.fill(0xff) } ]]);
	const nvs = new NVS(loader_from_map(loader_map));
	assert(!await nvs.fetchPartition());
	await assert.isRejected(nvs.all());
});

// Asserts zeroed out partition table can fetch without reject and fails on .next
test("zeroed partition table", async () => {
	const partition_table_data = await loader_map_get_data("partition_table");
	const loader_map = new Map([[ 0x8000, { is_table: true, read: false, data: partition_table_data.fill(0x00) } ]]);
	const nvs = new NVS(loader_from_map(loader_map));
	assert(!await nvs.fetchPartition());
	await assert.isRejected(nvs.all());
});



// Reject multiple keys in the same namespace
test("duplicate keys", async () => {
	const nvs = new NVS(await loader_fetch());
	const found = await nvs.fetchPartition("duplicate-keys");
	assert(found);
	await assert.isRejected(nvs.all());
});

// Reject blob data entry that uses the same key as entry with other data type
test("blob data collide with string", async () => {
	const nvs = new NVS(await loader_fetch());
	const found = await nvs.fetchPartition("blob-data-on-str");
	assert(found);
	await assert.isRejected(nvs.all());
});

// Reject blob index entry that uses the same key as entry with other data type
test("blob index collide with string", async () => {
	for await (const nvs of pages_reorder("blob-data-on-str")) {
		await assert.isRejected(nvs.all());
	}
});

// Asserts invalid entry state is rejected
test("invalid entry state", async () => {
	// Set only invalid entry state
	const addr_bitmap_offset = 32;
	const data = await loader_map_get_data("nvs");
	data[addr_bitmap_offset] = 0x01;

	// Asserts parsing buffer with invalid entry state is rejected
	const loader_map = loader_map_from(await loader_map_get_addr("nvs"), data);
	const loader = loader_from_map(loader_map);
	const nvs = new NVS(loader);
	await assert.isRejected(nvs.all());
});

// Asserts invalid entry type is rejected
test("invalid entry type", async () => {
	// Clears all entry data while keeping entry states to parse invalid data
	const addr_entry_offset = 64;
	const data = await loader_map_get_data("nvs");
	data.fill(0xff, addr_entry_offset);

	// Asserts that parsing invalid data rejects
	const loader_map = loader_map_from(await loader_map_get_addr("nvs"), data);
	const loader = loader_from_map(loader_map);
	const nvs = new NVS(loader);
	await assert.isRejected(nvs.all());
});



// Currently BigInts are not supported in JSON
test("JSON not support BigInt", () => {
	assert.throws(() => JSON.stringify(1n));
});

// Asserts that output from .toJSON can be serialized
test("JSON serializable", async () => {
	const nvs = new NVS(await loader_fetch());
	await nvs.all();
	JSON.stringify(nvs.toJSON());
});

// Asserts JSON data is identical to configuration used to create it
test("parsed JSON", async () => {
	const nvs = new NVS(await loader_fetch());
	await nvs.all();

	/** @type {import("./nvs_config.js").test_nvs_compare} */
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
	nvs_config_assert(nvs_config_default, cmp_json);
});

// Asserts that .toHTML function and underlying transformer generates table without exceptions
test("HTML generation", async () => {
	const nvs = new NVS(await loader_fetch());
	await nvs.all();
	assert(nvs.toHTML() instanceof HTMLElement);
});



// Asserts that a type cast used in the NVS constructor is still required
test("internal cast required", () => {
	// @ts-expect-error
	new ESPLoader({ port: serialport_stub() });
});

// Ensures constructor with serial port creates ESPLoader using serial port
test("serial port NVS constructor argument", async () => {
	const port = serialport_stub();
	const indicator = {};
	port.open = async () => {
		throw indicator;
	};
	const nvs = new NVS(port);
	assert(await nvs.connect().catch((err) => err === indicator));
});

// Ensures using non existing port throws since indexing into array can always be undefined
test("not found serial port", async () => {
	const ports = await navigator.serial.getPorts();
	const port = ports[ports.length];
	assert.throws(() => new NVS(port));
});

// Ensures wrong type of argument is rejected by typescript
test("NVS constructor wrong or missing argument", () => {
	// @ts-expect-error
	assert.throws(() => new NVS());
	// @ts-expect-error
	new NVS({});
});
