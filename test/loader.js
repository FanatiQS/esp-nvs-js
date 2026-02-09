// @ts-check

/// <reference path="./types.d.ts" />

import assert from "node:assert";

export class Loader {
	/**
	 * @param {test_page_map} page_map
	 */
	constructor(page_map) {
		this.connected = false;
		this.page_map = page_map;
	}

	/**
	 * @param {number} addr
	 * @param {number} size
	 */
	async readFlash(addr, size) {
		// Ensures loader was connected before reading flash
		assert(this.connected, "Loader not connected");

		// Ensures requested region exists
		const page = this.page_map.get(addr);
		assert(page, `Firmware buffer does not contain requested page: 0x${addr.toString(16)}`);
		assert(
			page.data.byteLength === size,
			`Firmware buffer is not of the expected size: ${page.data.byteLength.toString(16)}, ${size.toString(16)}`
		);

		// Sets read flag to indicate this page was read
		page.read = true;

		// Returns requested slice of buffer
		return new Uint8Array(page.data);
	}

	async connect() {
		this.connected = true;
	}
	async runStub() {}
}

/**
 * @param {test_page_map} loader_map
 */
export function loader_from_map(loader_map) {
	return /** @type {import("esptool-js").ESPLoader} */(/** @type {unknown} */(new Loader(loader_map)));
}
