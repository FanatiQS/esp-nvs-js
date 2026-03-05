// @ts-check

import { assert } from "./assert.js";

/**
 * @typedef {Map<number, { is_table: boolean, read: boolean, data: Uint8Array }>} loader_map
 */

export class Loader {
	/**
	 * @param {loader_map} loader_map
	 */
	constructor(loader_map) {
		this.connected = false;
		this.stubbed = false;
		this.loader_map = loader_map;
	}

	/**
	 * @param {number} addr
	 * @param {number} size
	 */
	async readFlash(addr, size) {
		// Ensures loader was connected before reading flash
		assert(this.connected, "Loader not connected");

		// Ensures requested region exists
		const region = this.loader_map.get(addr);
		assert(region, `Firmware buffer does not contain requested region: 0x${addr.toString(16)}`);

		// Ensures requested region is of correct size or a peek at the NVS page state
		if (region.is_table || size !== 4) {
			const size_hex_region = `0x${region.data.byteLength.toString(16)}`;
			const size_hex_request = `0x${size.toString(16)}`;
			assert(region.data.byteLength === size, `Firmware buffer is not of expected size: ${size_hex_region}, ${size_hex_request}`);
		}

		// Sets read flag to indicate this page was read
		region.read = true;

		// Returns requested slice of buffer
		return region.data;
	}

	async connect() {
		assert(this.connected === false);
		this.connected = true;
	}

	async runStub() {
		assert(this.stubbed === false);
		this.stubbed = true;
	}

	get chip() {
		return (this.connected) ? {} : null;
	}
}

/**
 * @param {loader_map} loader_map
 */
export function loader_from_map(loader_map) {
	return /** @type {import("esptool-js").ESPLoader} */(/** @type {unknown} */(new Loader(loader_map)));
}



/**
 * Gets flash address of specified partition
 * @param {string} partition_name
 */
export async function loader_map_get_addr(partition_name = "nvs") {
	const response = await fetch(`/api/addr/${partition_name}`);
	assert(response.status === 200);
	const addr = await response.json();
	assert(typeof addr === "number");
	return addr;
}

/**
 * Get data buffer from specified file
 * @param {string} [name]
 */
export async function loader_map_get_data(name = "nvs") {
	const response = await fetch(`/api/data/${name}`);
	assert(response.status === 200);
	return new Uint8Array(await response.arrayBuffer());
}

/**
 * Creates loader map using specified partition data
 * @param {number} addr
 * @param {Uint8Array} data
 */
export function loader_map_from(addr, data) {
	/** @type {loader_map} */
	const loader_map = new Map();

	// Adds nvs partitions to loader map, split by pages
	const page_size = 0x1000;
	assert(!(data.byteLength % page_size));
	for (let i = 0; i < data.byteLength; i += page_size) {
		loader_map.set(addr + i, {
			is_table: false,
			read: false,
			data: data.slice(i, i + page_size)
		});
	}

	return loader_map;
}

/**
 * Creates a loader map from generated NVS partition data
 * @param {string} [partition_name]
 */
export async function loader_map_fetch(partition_name = "nvs") {
	const addr = await loader_map_get_addr(partition_name);
	const data = await loader_map_get_data(partition_name);
	const loader_map = loader_map_from(addr, data);
	loader_map.set(0x8000, { is_table: true, read: false, data: await loader_map_get_data("partition_table") });
	return loader_map;
}

/**
 * Creates a loader from generated NVS partition data
 * @param {string} [partition_name]
 */
export async function loader_fetch(partition_name) {
	return loader_from_map(await loader_map_fetch(partition_name));
}
