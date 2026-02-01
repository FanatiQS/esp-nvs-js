import assert from "node:assert";
import test from "node:test";

import { createLoader } from "./loader.js";
import { NVS } from "../src/nvs.js";
import "./stub_serialport.js";

// Assert that all NVS pages are requested with correct address and size
test("all pages requested", async () => {
	// Creates empty firmware
	const partition_addr = 0x9000;
	const partition_size = 0x6000;
	const firmware = new Uint8Array(partition_addr + partition_size);
	firmware.fill(0xff);

	// Creates load that asserts serial read requests
	let addr_next = partition_addr;
	let size_remaining = partition_size;
	const loader = createLoader(firmware, async (addr, size) => {
		assert.equal(addr, addr_next);
		assert.equal(size, 0x1000);
		addr_next += size;
		size_remaining -= size;
	});

	// Runs test and asserts all pages were requested
	const nvs = new NVS(loader);
	nvs.addFlashAddr(addr_next, size_remaining);
	await nvs.next();
	assert.equal(size_remaining, 0);
});
