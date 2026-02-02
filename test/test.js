import assert from "node:assert";
import test from "node:test";

import { createLoader } from "./loader.js";
import { NVS } from "../src/nvs.js";
import "./stub_serialport.js";
import { firmware_generate_partitions } from "./firmware_generate.js";

/**
 * Creates a loader that asserts every page was requested
 * @param {Uint8Array} firmware
 * @param {{ addr: number, size: number }[]} partitions
 */
async function createLoaderAssertPartitions(firmware, partitions) {
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
	const nvs = new NVS(await createLoaderAssertPartitions(firmware, partitions));
	nvs.addFlashAddr(addr, size);
	await nvs.next();
	assert(partitions.length === 0);
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
	const nvs = new NVS(await createLoaderAssertPartitions(firmware, partitions));
	await nvs.next();
	assert(partitions.length === 0);
});
