// @ts-check

import { ESPLoader } from "./esptool.js";
import { nvs_pages_set, nvs_pages_lookup, nvs_pages_next, nvs_entry_next, nvs_iterate_ns } from "./nvs_parser.js";
import { nvs_transform_json, nvs_transform_html } from "./nvs_transform.js";

export class NVS {
	/**
	 * @param {ESPLoader|SerialPort} loader ESPLoader from ESPTool library or WebSerial SerialPort
	 * @throws {TypeError} Argument is not an ESPLoader or a SerialPort
	 */
	constructor(loader) {
		if (loader instanceof SerialPort) {
			/** @private */
			this.loader = new ESPLoader(/** @type {import("esptool-js").LoaderOptions} */({ port: loader }));
		}
		else if (loader) {
			/** @private */
			this.loader = loader;
		}
		else {
			throw new TypeError("Invalid argument: 'loader' must be an ESPLoader or a SerialPort");
		}

		/**
		 * @type {number[]}
		 * @private
		 */
		this.addr_list = [];
		/**
		 * @type {import("./nvs_parser.js").nvs_page|null}
		 * @private
		 */
		this.page = null;
		/**
		 * @type {import("./nvs_parser.js").nvs_cache}
		 * @readonly
		 */
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
	 * @throws Partition already set
	 */
	setPartition(addr, len) {
		nvs_pages_set(addr, len, this.addr_list);
	}

	/**
	 * Fetches NVS partition from device
	 * If no partition have been specified before parsing, default NVS page will automatically be fetched from partition table
	 * @param {string} [partitionName="nvs"] Partition name to get the page addresses for
	 * @param {number} [addr=0x8000] Address of the partition table
	 * @throws Partition already set
	 */
	async fetchPartition(partitionName, addr) {
		// Connects to device if not already connected
		if (!this.loader.chip) {
			await this.connect();
		}

		// Fetches page addresses of NVS partition
		return nvs_pages_lookup(this.loader, this.addr_list, partitionName, addr);
	}



	/**
	 * Parses next NVS entry and adds it to the cache
	 * @returns Parsed entry or null if no more entries are available on any of the registered NVS pages
	 */
	async next() {
		// Reads first NVS page if not yet read
		if (!this.page) {
			// Exits early if there is no page because parser has completed
			if (this.cache.length > 1 || this.cache[0].size > 0) {
				return null;
			}

			// Fetches NVS partitions automatically if no partition has been added
			if (!this.addr_list.length) {
				if (!await this.fetchPartition()) {
					throw new Error("NVS partition not found");
				}
			}
			// Connects to device if not connected and partition address is available
			else if (!this.loader.chip) {
				await this.connect();
			}

			// Reads first NVS page containing data
			this.page = await nvs_pages_next(this.loader, this.addr_list);
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
			this.page = await nvs_pages_next(this.loader, this.addr_list);
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
		/** @type {import("./nvs_parser.js").nvs_cache_entry|undefined} */
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
		/** @type {import("./nvs_parser.js").nvs_cache_namespace} */
		let entries;
		while (!(entries = this.cache[ns])) {
			if (!await this.next()) {
				return null;
			}
		}

		// Gets entry for key from namespace
		while (!(entry = entries.get(key))) {
			if (!await this.next()) {
				return null;
			}
		}

		// Ensures entry is not an incomplete value
		while (entry.value === null) {
			if (!await this.next()) {
				throw new Error("Blob is in an incomplete state after parsing all pages");
			}
		}

		return /** @type {import("./nvs_parser.js").nvs_entry} */(entry);
	}

	/**
	 * Parses all NVS entries on device
	 */
	async all() {
		while (await this.next());
	}



	/**
	 * Asynchronously iterates over all NVS entries
	 * @returns {AsyncIterator<[ string, string, import("./nvs_parser.js").nvs_value ]>}
	 */
	async* [Symbol.asyncIterator]() {
		// Namespace numbers to string mappings
		const namespaces_by_value = /** @type {Map<number,string>} */(new Map());

		// Iterates through already cached entries
		for (const [ namespace, ns ] of nvs_iterate_ns(this.cache)) {
			namespaces_by_value.set(ns, namespace);
			if (!this.cache[ns]) continue;
			for (const [ key, entry ] of this.cache[ns]) {
				if (entry.value == null) continue;
				yield [ namespace, key, entry.value ];
			}
		}

		// Reads in more entries
		/** @type {import("./nvs_parser.js").nvs_entry|null} */
		let entry;
		while ((entry = await this.next())) {
			// Iterates through cached namespace entries for newly received namespace
			if (entry.ns === 0) {
				const ns = /** @type {number} */(entry.value);
				namespaces_by_value.set(ns, entry.key);

				if (!this.cache[ns]) continue;
				for (const { key, value } of this.cache[ns].values()) {
					if (!value) continue;
					yield [ entry.key, key, value ];
				}
			}
			// Outputs entry if its namespaces name exists in cache
			else {
				const namespace = namespaces_by_value.get(entry.ns);
				if (namespace != null) {
					yield [ namespace, entry.key, entry.value ];
				}
			}
		}
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
	 * Gets all data as JSON
	 */
	async toJSON() {
		await this.all();
		return nvs_transform_json(this.cache);
	}

	/**
	 * Gets all data as HTML table
	 */
	async toHTML() {
		await this.all();
		return nvs_transform_html(this.cache);
	}
}
