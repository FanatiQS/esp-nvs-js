// @ts-check

import { ESPLoader } from "https://cdn.jsdelivr.net/npm/esptool-js@0.5.6/+esm";
import { nvs_page_append, nvs_page_lookup, nvs_page_next, nvs_entry_next, nvs_iterate } from "./nvs_parser.js";
import { nvs_transform_json, nvs_transform_html } from "./nvs_transform.js";

/**
 * @typedef {import("./nvs_parser.js").nvs_cache} nvs_cache
 * @typedef {import("./nvs_parser.js").nvs_page} nvs_page
 * @typedef {import("./nvs_parser.js").nvs_entry} nvs_entry
 * @typedef {import("./nvs_parser.js").nvs_value} nvs_value
 */

export class NVS {
	/**
	 * @param {ESPLoader|SerialPort|undefined} loader Connected ESPTool loader with stub running
	 */
	constructor(loader) {
		if (loader instanceof SerialPort) {
			this.loader = new ESPLoader(/** @type {import("esptool-js").LoaderOptions} */({ port: loader }));
		}
		else if (loader) {
			this.loader = loader;
		}
		else {
			throw new Error("No serial port or loader");
		}

		/** @type {number[]} */
		this.addr_list = [];
		/** @type {nvs_page|null} */
		this.page = null;
		/** @type {nvs_cache} */
		this.cache = [ new Map() ];
	}

	/**
	 * Connects to device
	 */
	async connect() {
		await this.loader.connect();
		await this.loader.runStub();
	}



	/**
	 * Adds 1 or more NVS page addresses
	 * If no partitions have been added before parsing, all NVS pages will automatically be fetched from partition table
	 * @param {number} addr Address of an NVS partition
	 * @param {number} len Size of the NVS partition
	 */
	addFlashAddr(addr, len) {
		nvs_page_append(addr, len, this.addr_list);
	}

	/**
	 * Fetches all NVS partitions from device
	 * If no partitions have been added before parsing, all NVS pages will automatically be fetched from partition table
	 * @param {number} [addr=0x8000] Address of the partition table
	 */
	async fetchFlashAddr(addr = 0x8000) {
		return nvs_page_lookup(this.loader, addr, this.addr_list);
	}



	/**
	 * Parses next NVS entry and adds it to the cache
	 * @returns Parsed entry or null if no more entries are available on any of the registered NVS pages
	 */
	async next() {
		// Reads first NVS page if not yet read
		if (!this.page) {
			// Connects to device if not already connected
			if (!this.loader.chip) {
				await this.connect();
			}

			// Fetches NVS partitions automatically if no partitions have been added
			if (!this.addr_list.length) {
				await this.fetchFlashAddr();
			}

			// Reads first NVS page containing data
			this.page = await nvs_page_next(this.loader, this.addr_list);
			if (!this.page) {
				throw new Error("No flash addresses added");
			}
		}

		// Parses next entry in NVS page
		do {
			const entry = nvs_entry_next(this.page, this.cache);
			if (entry) {
				return entry;
			}
			this.page = await nvs_page_next(this.loader, this.addr_list);
		} while (this.page);
		return null;
	}

	/**
	 * Gets the internal entry for the specified key in the specified namespace
	 * @param {string} namespace Namespace to find the key in
	 * @param {string} key Key to find the value for
	 * @returns Found entry or null if not found
	 */
	async find(namespace, key) {
		/** @type {nvs_entry|undefined} */
		let entry;

		// Gets namespace number
		const namespace_entries = this.cache[0];
		while (!(entry = namespace_entries.get(namespace))) {
			if (!await this.next()) {
				return null;
			}
		}
		const ns = /** @type {number} */(entry.value);

		// Ensures namespace exists
		while (!this.cache[ns]) {
			if (!await this.next()) {
				return null;
			}
		}

		// Gets entry for key from namespace
		const entries = this.cache[ns];
		while (!(entry = entries.get(key))) {
			if (!await this.next()) {
				return null;
			}
		}

		// Ensures entry is not an incomplete value
		while (entry.value === null) {
			if (!await this.next()) {
				return null;
			}
		}

		return entry;
	}

	/**
	 * Parses all NVS entries on device
	 */
	async all() {
		while (await this.next());
	}

	/**
	 * Iterates over all cached data
	 */
	[Symbol.iterator]() {
		return nvs_iterate(this.cache);
	}



	/**
	 * Gets the value for the specified key in the specified namespace
	 * @param {string} namespace Namespace to find the key in
	 * @param {string} key Key to find the value for
	 */
	async get(namespace, key) {
		const entry = await this.find(namespace, key);
		return entry && entry.value;
	}



	/**
	 * Gets all cached data as JSON
	 */
	toJSON() {
		return nvs_transform_json(this.cache);
	}

	/**
	 * Gets all cached data as HTML table
	 */
	toHTML() {
		return nvs_transform_html(this.cache);
	}
}
