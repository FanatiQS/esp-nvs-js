// @ts-check

import { ESPLoader } from "./esptool.js";
import { nvs_page_set, nvs_page_lookup, nvs_page_next, nvs_entry_next, nvs_iterate } from "./nvs_parser.js";
import { nvs_transform_json, nvs_transform_html } from "./nvs_transform.js";

export class NVS {
	/**
	 * @param {ESPLoader|SerialPort} loader Connected ESPTool loader with stub running
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
		/** @type {import("./nvs_parser.js").nvs_page|null} */
		this.page = null;
		/** @type {import("./nvs_parser.js").nvs_cache} */
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
	 * Specifies NVS partition to use
	 * If no partition have been specified before parsing, default NVS page will automatically be fetched from partition table
	 * @param {number} addr Address of an NVS partition
	 * @param {number} len Size of the NVS partition
	 */
	setPartition(addr, len) {
		nvs_page_set(addr, len, this.addr_list);
	}

	/**
	 * Fetches NVS partition from device
	 * If no partition have been specified before parsing, default NVS page will automatically be fetched from partition table
	 * @param {string} [partitionName="nvs"] Partition name to get the page addresses for
	 * @param {number} [addr=0x8000] Address of the partition table
	 */
	async fetchPartition(partitionName, addr) {
		// Connects to device if not already connected
		if (!this.loader.chip) {
			await this.connect();
		}

		// Fetches page addresses of NVS partition
		await nvs_page_lookup(this.loader, this.addr_list, partitionName, addr);
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
				await this.fetchPartition();
				if (!this.addr_list.length) {
					throw new Error("No NVS partitions found");
				}
			}

			// Reads first NVS page containing data
			this.page = await nvs_page_next(this.loader, this.addr_list);
			if (!this.page) {
				return null;
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
		/** @type {import("./nvs_parser.js").nvs_entry|undefined} */
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
