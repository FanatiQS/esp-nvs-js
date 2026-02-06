// @ts-check

import { readFile, mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { parse as csv_parse } from "csv-parse/sync";

/**
 * @typedef {Object<string,{ key: string, value: string|number|bigint|Uint8Array, type?: string }[]>} test_nvs_config
 * @typedef {{ name: string, type: string, subtype: string, size: number, data?: test_nvs_config }[]} test_partitions
 */

// Default directory to use for generated files
const default_dir = "./generated";

// Runs a Python script
const python = promisify(exec);

/**
 * Parses number represented as string
 * @param {string} input
 */
function parse_int(input) {
	switch (input[input.length - 1]) {
		case "K":
		case "k": {
			return Number(input.slice(0, -1)) * 1024;
		}
		case "M":
		case 'm': {
			return Number(input.slice(0, -1)) * 1024 * 1024;
		}
		default: {
			return Number(input);
		}
	}
}

/**
 * Generates partition table and partitions binaries from configuration
 * @param {test_partitions} partitions
 * @param {string} [work_dir]
 */
export async function firmware_generate(partitions, work_dir=default_dir) {
	// Creates partition table CSV file
	await mkdir(work_dir, { recursive: true });
	const partition_table_csv_path = `${work_dir}/partition_table.csv`;
	const partition_table_csv = createWriteStream(partition_table_csv_path);
	partition_table_csv.write("#name,type,subtype,offset,size,flags\n");

	// Writes configuration to partition table CSV file and its optional data to separate CSV file
	for (const { name, type, subtype, size, data } of partitions) {
		partition_table_csv.write(`${name},${type},${subtype},,0x${size.toString(16)},\n`);

		// Generates NVS CSV if data is available
		if (data) {
			// Creates NVS CSV file
			const nvs_csv_path = `${work_dir}/${name}.csv`;
			const nvs_csv = createWriteStream(nvs_csv_path);
			nvs_csv.write("key,type,encoding,value\n");

			// Writes NVS configuration to CSV file
			for (const [ namespace, nvs_entries ] of Object.entries(data)) {
				nvs_csv.write(`${namespace},namespace,,\n`);
				for (let { key, type, value } of nvs_entries) {
					// Type for blob is optional
					if (value instanceof Uint8Array) {
						value = Buffer.from(value).toString("hex");
						type = "hex2bin";
					}
					// Type for string is optional
					else if (typeof value === "string") {
						type = "string";
					}

					// Writes NVS entry
					nvs_csv.write(`${key},data,${type},${value}\n`);
				}
			}

			// Ensures CSV file is completely written to before using it
			await new Promise((resolve) => nvs_csv.end(resolve));

			// Generates NVS binary from CSV file
			const nvs_bin_path = `${work_dir}/${name}.bin`;
			const nvs_script_path = "$IDF_PATH/components/nvs_flash/nvs_partition_generator/nvs_partition_gen.py";
			await python(`${nvs_script_path} generate ${nvs_csv_path} ${nvs_bin_path} ${size}`);	
		}
	}

	// Ensures partition table CSV file is completely written before using it
	await new Promise((resolve) => partition_table_csv.end(resolve));

	// Generates partition table binary from CSV file
	const partition_table_bin_path = `${work_dir}/partition_table.bin`;
	const partition_table_bin_script = "$IDF_PATH/components/partition_table/gen_esp32part.py";
	await python(`${partition_table_bin_script} ${partition_table_csv_path} ${partition_table_bin_path}`);
}

/**
 * Assembles firmware buffer from partition table and partition binaries
 * @param {string} [work_dir]
 */
export async function firmware_assemble(work_dir=default_dir) {
	// Reads partition table binary file first for better error if files have not been generated
	const partition_table_bin_path = `${work_dir}/partition_table.bin`;
	const partition_table_bin_data = await readFile(partition_table_bin_path);

	// Generates partition table CSV from binary containing calculated address for each partition
	const partition_table_csv_script = `$IDF_PATH/components/partition_table/gen_esp32part.py ${partition_table_bin_path}`;
	const { stdout: partition_table_csv_data } = await python(partition_table_csv_script);

	// Gets total size required from partition table and get NVS partition file
	let total_size = 0;
	const partitions = [];
	for (const [ name, type, subtype, addr, size ] of csv_parse(partition_table_csv_data, { comment: "#" })) {
		// Gets total buffer size required for firmware
		const size_parsed = parse_int(size);
		const addr_parsed = parse_int(addr);
		if (total_size <= addr_parsed) {
			total_size = addr_parsed + size_parsed;
		}

		// Gets generated NVS binary
		if (type === "data" && subtype === "nvs") {
			partitions.push({
				addr: addr_parsed,
				path: `${work_dir}/${name}.bin`
			});
		}
	}

	// Assembles all binary files into a single firmware buffer
	const firmware = new Uint8Array(total_size);
	firmware.fill(0xff);
	firmware.set(partition_table_bin_data, 0x8000);
	for (const { addr, path } of partitions) {
		firmware.set(await readFile(path), addr);
	}

	return firmware;
}
