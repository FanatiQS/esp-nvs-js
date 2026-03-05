// @ts-check

/**
 * @typedef nvs_page
 * @property {number} addr
 * @property {DataView} view
 * @property {number} index
 *
 * @typedef {number|bigint|string|Uint8Array} nvs_value
 *
 * @typedef nvs_chunks_info
 * @property {number} size
 * @property {number} count
 * @property {number} start
 *
 * @typedef nvs_chunks
 * @property {Uint8Array[]} arr
 * @property {number} len
 * @property {nvs_chunks_info|null} info
 *
 * @typedef nvs_entry
 * @property {nvs_value|null} value
 * @property {nvs_chunks|null} chunks
 *
 * @typedef {Map<string,nvs_entry>[]} nvs_cache
 *
 * @typedef {import("./esptool.js").ESPLoader} ESPLoader
 */

const HEADER_SIZE = 32;
const BITMAP_SIZE = 32;
const ENTRY_SIZE = 32;
const PAGE_SIZE = 0x1000;
const PARTITION_TABLE_SIZE = 0xc00;
const PARTITION_TABLE_ENTRY_SIZE = 32;
const ENTRIES_COUNT_MAX = (PAGE_SIZE - HEADER_SIZE - BITMAP_SIZE) / ENTRY_SIZE;

const decoder = new TextDecoder();

/**
 * Possible NVS page states
 * @readonly
 * @enum {number}
 */
const nvs_page_states = {
	empty: 0xffffffff,
	active: 0xfffffffe,
	full: 0xfffffffc,
	erasing: 0xfffffff8,
	corrupted: 0xfffffff0
};

/**
 * Possible NVS entry states
 * @readonly
 * @enum {number}
 */
const nvs_entry_states = {
	empty: 0x03,
	written: 0x02,
	erased: 0x00
};

/**
 * Possible NVS entry data types
 * @readonly
 * @enum {number}
 */
export const nvs_entry_type = {
	uint8: 0x01,
	uint16: 0x02,
	uint32: 0x04,
	uint64: 0x08,
	int8: 0x11,
	int16: 0x12,
	int32: 0x14,
	int64: 0x18,
	string: 0x21,
	blob_data: 0x42,
	blob_index: 0x48
};



/**
 * Gets a possibly NULL terminated ASCII string from an array buffer.
 * If the string is not NULL terminated, the entire length is used
 * @param {ArrayBufferLike} buffer The buffer to extract the string from
 * @param {number} offset The start offset into the buffer
 * @param {number} length The max length of the string
 */
function nvs_buffer_null_terminate(buffer, offset, length) {
	const buf = new Uint8Array(buffer, offset, length);
	const index = buf.indexOf(0x00);
	return (index === -1) ? buf : buf.slice(0, index);
}

/**
 * Joins all chunks into a single buffer
 * @param {nvs_chunks_info} info
 * @param {nvs_chunks} chunks
 */
function nvs_chunks_assemble(info, chunks) {
	const buf = new Uint8Array(info.size);
	let offset = 0;
	for (let i = 0; i < chunks.len; i++) {
		const chunk = chunks.arr[info.start + i];
		if (!chunk) {
			throw new Error("Missing chunk when assembling");
		}
		buf.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return buf;
}

/**
 * Simplifies bigint to number primitive if it is safe
 * @param {bigint} bigint
 */
function nvs_bigint_simplify(bigint) {
	const number = Number(bigint);
	return (number <= Number.MAX_SAFE_INTEGER && number >= Number.MIN_SAFE_INTEGER) ? number : bigint;
}

/**
 * Parses the entry pointed to in the page
 * @param {nvs_page} page NVS page to parse data from
 * @param {nvs_cache} cache Cache for storing parsed NVS entries
 * @returns Parsed entry or null if entry is incomplete, erased or empty
 */
function nvs_entry_parse(page, cache) {
	// Gets next entry's state from bitmap
	const bitmap_index = page.index * 2;
	const bitmap_byte_index = HEADER_SIZE + bitmap_index / 8;
	const bitmap_bit_index = bitmap_index % 8;
	const state = (page.view.getUint8(bitmap_byte_index) >> bitmap_bit_index) & 0x03;

	// Skips uninitialized entry regions
	if (state === nvs_entry_states.empty) {
		page.index++;
		return null;
	}

	// Increments index based on entry size found in entry data
	const offset = HEADER_SIZE + BITMAP_SIZE + page.index * ENTRY_SIZE;
	const span = page.view.getUint8(offset + 2);
	page.index += span;

	// Skips erased entry
	if (state === nvs_entry_states.erased) {
		return null;
	}
	// Validates state value
	else if (state !== nvs_entry_states.written) {
		throw new Error(`Invalid entry state: ${state.toString(16)}`);
	}

	// Gets data related to inserting entry into cache
	const ns = page.view.getUint8(offset + 0);
	const type = page.view.getUint8(offset + 1);
	const key_buf = nvs_buffer_null_terminate(page.view.buffer, page.view.byteOffset + offset + 8, 16);
	const key = String.fromCharCode(...key_buf);
	if (ns === 0 && type !== nvs_entry_type.uint8) {
		throw new Error("Invalid NVS data type for namespace");
	}
	const entries = cache[ns] ||= new Map();

	// Gets entry's data based on defined type
	/** @type {nvs_value|null} */
	let value;
	/** @type {nvs_chunks|null} */
	let chunks = null;
	switch (type) {
		case nvs_entry_type.uint8: {
			value = page.view.getUint8(offset + 24);
			break;
		}
		case nvs_entry_type.int8: {
			value = page.view.getInt8(offset + 24);
			break;
		}
		case nvs_entry_type.uint16: {
			value = page.view.getUint16(offset + 24, true);
			break;
		}
		case nvs_entry_type.int16: {
			value = page.view.getInt16(offset + 24, true);
			break;
		}
		case nvs_entry_type.uint32: {
			value = page.view.getUint32(offset + 24, true);
			break;
		}
		case nvs_entry_type.int32: {
			value = page.view.getInt32(offset + 24, true);
			break;
		}
		case nvs_entry_type.uint64: {
			value = nvs_bigint_simplify(page.view.getBigUint64(offset + 24, true));
			break;
		}
		case nvs_entry_type.int64: {
			value = nvs_bigint_simplify(page.view.getBigInt64(offset + 24, true));
			break;
		}
		case nvs_entry_type.string: {
			const key_offset = offset + ENTRY_SIZE;
			const key_length = page.view.getUint16(offset + 24, true);
			value = decoder.decode(nvs_buffer_null_terminate(page.view.buffer, key_offset, key_length));
			break;
		}
		case nvs_entry_type.blob_data: {
			// Gets blob_data chunk buffer and index
			const chunk_index = page.view.getUint8(offset + 3);
			const size = page.view.getUint16(offset + 24, true);
			const chunk = new Uint8Array(page.view.buffer, page.view.byteOffset + offset + ENTRY_SIZE, size);

			// Adds to existing entry instead of creating new
			const entry = entries.get(key);
			if (entry) {
				// Only blob types can have chunks
				if (!entry.chunks) {
					throw new Error("Entry is not a blob");
				}

				// Finalizes single chunk blob by using buffer without copying
				if (entry.chunks.info && entry.chunks.info.count === 1) {
					entry.value = chunk;
					entry.chunks = null;
					return entry;
				}

				// Finalizes multi-chunk blob by joining chunks into a new buffer when all chunks are available
				entry.chunks.len++;
				entry.chunks.arr[chunk_index] = chunk;
				if (entry.chunks.info && entry.chunks.len === entry.chunks.info.count) {
					entry.value = nvs_chunks_assemble(entry.chunks.info, entry.chunks);
					entry.chunks = null;
					return entry;
				}

				return null;
			}

			// Initializes chunks and value for entry creation
			value = null;
			chunks = {
				arr: [],
				len: 0,
				info: null
			};
			chunks.arr[chunk_index] = chunk;
			break;
		}
		case nvs_entry_type.blob_index: {
			// Gets blob_index chunks info
			const info = {
				size: page.view.getUint32(offset + 24, true),
				count: page.view.getUint8(offset + 28),
				start: page.view.getUint8(offset + 29)
			};

			// Adds to existing entry instead of creating new
			const entry = entries.get(key);
			if (entry) {
				// Only blob types can have chunks
				if (!entry.chunks) {
					throw new Error("Entry is not a blob");
				}

				// Finalizes single chunk blob by using buffer without copying
				if (info.count === 1) {
					entry.value = entry.chunks.arr[info.start];
					entry.chunks = null;
					return entry;
				}

				// Finalizes multi-chunk blob by joining chunks into a new buffer when all chunks are available
				entry.chunks.len++;
				if (entry.chunks.len === info.count) {
					entry.value = nvs_chunks_assemble(info, entry.chunks);
					entry.chunks = null;
					return entry;
				}

				// Stores blob index info for use when all chunks are available
				entry.chunks.info = info;

				return null;
			}

			// Initializes chunks and value for entry creation
			value = null;
			chunks = {
				arr: [],
				len: 0,
				info: info
			};
			break;
		}
		default: {
			throw new Error(`Invalid type: 0x${type.toString(16)}`);
		}
	}

	// Registers entry in cache
	if (entries.has(key)) {
		throw new Error(`Found multiple entries for: 0x${ns.toString(16).padStart(2, "0")} "${key}"`);
	}
	const entry = /** @type {nvs_entry} */({
		value: value,
		chunks: chunks
	});
	entries.set(key, entry);

	// Returns entry unless an incomplete blob
	return (chunks) ? null : entry;
}

/**
 * Gets next entry from page
 * @param {nvs_page} page NVS page to parse data from
 * @param {nvs_cache} cache Cache for storing parsed NVS entries
 * @returns Parsed entry or null if no more entries are available in the page
 */
export function nvs_entry_next(page, cache) {
	while (page.index < ENTRIES_COUNT_MAX) {
		const entry = nvs_entry_parse(page, cache);
		if (entry) {
			return entry;
		}
	}
	return null;
}



/**
 * Adds NVS pages from an NVS partition to the specified addresses list
 * @param {number} addr Address of the NVS partition
 * @param {number} len Size of the NVS partition
 * @param {number[]} addr_list Empty list of NVS page addresses to add the extracted addresses to
 */
export function nvs_pages_set(addr, len, addr_list) {
	// Requires address list to be empty before adding new pages
	if (addr_list.length !== 0) {
		throw new Error("Partition already set");
	}

	// Adds partition page address range to address list
	for (let i = 0; i < len; i += 0x1000) {
		addr_list.push(addr + i);
	}
}

/**
 * Fetches NVS partition from device and adds its pages to the specified addresses list
 * @param {ESPLoader} loader Connected ESPTool loader with stub running
 * @param {number[]} addr_list Empty list of NVS page addresses to append the extracted addresses to
 * @param {string} [name] Partition name to get the page addresses for
 * @param {number} [addr] Address of the partition table
 * @return Indicates if NVS partition was found or not
 */
export async function nvs_pages_lookup(loader, addr_list, name = "nvs", addr = 0x8000) {
	// Reads partition table from device
	const data = await loader.readFlash(addr, PARTITION_TABLE_SIZE);
	const view = new DataView(data.buffer);

	for (let i = 0; i < PARTITION_TABLE_SIZE; i += PARTITION_TABLE_ENTRY_SIZE) {
		// Parses partition entries up to magic number being 0xffff
		if (view.getUint16(i + 0) === 0xffff) {
			break;
		}

		// Registers NVS partition if it has correct magic number, type, subtype, name and is not encrypted
		if (
			view.getUint32(i + 0) === 0xaa500102
			&& view.getUint32(i + 28) === 0x00000000
			&& String.fromCharCode(...nvs_buffer_null_terminate(view.buffer, view.byteOffset + i + 12, 16)) === name
		) {
			nvs_pages_set(view.getUint32(i + 4, true), view.getUint32(i + 8, true), addr_list);
			return true;
		}
	}

	return false;
}

/**
 * Reads next NVS page from device
 * @param {ESPLoader} loader Connected ESPTool loader with stub running
 * @param {number[]} addr_list Address list to get the next page address from
 * @returns {Promise<nvs_page|null>}
 */
export async function nvs_pages_next(loader, addr_list) {
	/** @type {number|undefined} */
	let addr;
	while ((addr = addr_list.shift()) != null) {
		// Reads next NVS page from device
		const data = await loader.readFlash(addr, PAGE_SIZE);
		const view = new DataView(data.buffer);

		// Returns page object for parsing if it could contain data
		const state = view.getUint32(0, true);
		if (state === nvs_page_states.active || state === nvs_page_states.full) {
			return {
				addr: addr,
				index: 0,
				view: view
			};
		}
	}
	return null;
}



/**
 * Iterates over all cached namespaces
 * @param {nvs_cache} cache Cache storing parsed NVS entries
 * @returns {Generator<[string,number],void,void>} Namespace index to use with cache
 */
export function* nvs_iterate_ns(cache) {
	for (const [ namespace, entry ] of cache[0]) {
		if (typeof entry.value !== "number") {
			throw new Error("Invalid cache, namespace can only have a data type of uint8");
		}
		const ns = entry.value;
		yield [ namespace, ns ];
	}
}

/**
 * Iterates over all cached key-value-pairs in namespace
 * @param {nvs_cache} cache Cache storing parsed NVS entries
 * @param {number} ns Namespace index
 * @returns {Generator<[string,nvs_value],void,void>}
 */
export function* nvs_iterate_value(cache, ns) {
	if (ns in cache) {
		for (const [ key, entry ] of cache[ns]) {
			if (entry.value == null) {
				throw new Error("Invalid cache, entry not completed");
			}
			yield [ key, entry.value ];
		}
	}
}

/**
 * Iterates over all cached key-value-pairs
 * @param {nvs_cache} cache
 * @returns {Generator<[string,string,nvs_value],void,void>}
 */
export function* nvs_iterate(cache) {
	for (const [ namespace, ns ] of nvs_iterate_ns(cache)) {
		for (const [ key, value ] of nvs_iterate_value(cache, ns)) {
			yield [ namespace, key, value ];
		}
	}
}
