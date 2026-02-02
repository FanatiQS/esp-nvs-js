// @ts-check

import { createHash } from "node:crypto";



/**
 * Creates a flash data buffer containing the specified partitions in the partition table
 * @param {object[]} partitions
 * @param {number} partitions.size
 * @param {number} partitions.type
 * @param {string} partitions.name
 * @param {number} [addr=0x8000]
 */
export function firmware_generate_partitions(partitions, addr = 0x8000) {
	// Creates flash buffer
	const size = partitions.reduce((acc, partition) => acc + partition.size, addr) + 0x1000;
	const data = new Uint8Array(size);
	const view = new DataView(data.buffer);
	data.fill(0xff);

	// Appends partitions to flash buffer
	let offset_addr = addr + 0x1000;
	for (let i = 0; i < partitions.length; i++) {
		const partition = partitions[i];

		// Sets magic number, type, address offset and size of partition in partition table
		const offset_table = addr + 32 * i;
		view.setUint32(offset_table + 0, 0xaa500000 | partition.type);
		view.setUint32(offset_table + 4, offset_addr, true);
		view.setUint32(offset_table + 8, partition.size, true);
		offset_addr += partition.size;

		// Sets partition name in partition table
		for (let i = 0; i < 20; i++) {
			data[offset_table + 12 + i] = partition.name.charCodeAt(i);
		}
	}

	// Sets partition table checksum
	const table_size = addr + 32 * partitions.length;
	view.setUint16(table_size, 0xeded);
	data.set(createHash("md5").update(data.slice(addr, table_size)).digest(), table_size + 16);

	return data;
}

// Generates default partitions
export function generate_default() {
	return firmware_generate_partitions([
		{ type: 0x0102, size: 0x6000, name: "nvs" },
		{ type: 0x0101, size: 0x1000, name: "phy_init" },
		{ type: 0x0000, size: 0x100000, name: "factory" }
	]);
}
