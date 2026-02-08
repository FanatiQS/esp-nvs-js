// @ts-check

/// <reference path="./types.d.ts" />

export class Loader {
	/**
	 * @param {test_loader_map} loader_map
	 */
	constructor(loader_map) {
		this.connected = false;
		this.loader_map = loader_map;
	}

	/**
	 * @param {number} addr
	 * @param {number} size
	 */
	async readFlash(addr, size) {
		// Ensures loader was connected before reading flash
		if (this.connected === false) {
			throw new Error("Loader not connected");
		}

		// Ensures requested region exists
		const page = this.loader_map.get(addr);
		if (!page) {
			throw new Error(`Firmware buffer does not contain requested page: 0x${addr.toString(16)}`);
		}
		if (page.data.byteLength !== size) {
			throw new Error(`Firmware buffer is not of the expected size: ${page.data.byteLength.toString(16)}, ${size.toString(16)}`);
		}

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
 * @param {test_loader_map} loader_map
 */
export function loader_from_map(loader_map) {
	return /** @type {import("esptool-js").ESPLoader} */(/** @type {unknown} */(new Loader(loader_map)));
}
