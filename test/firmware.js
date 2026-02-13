// @ts-check

/// <reference path="./types.d.ts" />

import { readFile, mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert";
import { parse as csv_parse } from "csv-parse/sync";

// Default directory to use for generated files
const default_dir = `${import.meta.dirname}/generated`;

// Runs a Python script
const python = promisify(exec);

// Gets path to installed and set up ESP-IDF SDK for python scripts
const { IDF_PATH } = process.env;
assert(IDF_PATH, "ESP-IDF not available");

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
					if (ArrayBuffer.isView(value)) {
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
			const nvs_script_path = `python -m esp_idf_nvs_partition_gen`;
			await python(`${nvs_script_path} generate ${nvs_csv_path} ${nvs_bin_path} ${size}`);	
		}
	}

	// Ensures partition table CSV file is completely written before using it
	await new Promise((resolve) => partition_table_csv.end(resolve));

	// Generates partition table binary from CSV file
	const partition_table_bin_path = `${work_dir}/partition_table.bin`;
	const partition_table_bin_script = `python ${IDF_PATH}/components/partition_table/gen_esp32part.py`;
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
	const partition_table_csv_script = `python ${IDF_PATH}/components/partition_table/gen_esp32part.py ${partition_table_bin_path}`;
	const { stdout: partition_table_csv_data } = await python(partition_table_csv_script);

	// Creates table with partition table region
	/** @type {test_page_map} */
	const page_map = new Map();
	page_map.set(0x8000, { read: false, data: new Uint8Array(partition_table_bin_data) });

	// Registers NVS partitions pages in table
	for (const [ name, type, subtype, addr, size ] of csv_parse(partition_table_csv_data, { comment: "#" })) {
		if (type === "data" && subtype === "nvs") {
			const page_size = 0x1000;
			const addr_parsed = parse_int(addr);
			const nvs_bin_data = await readFile(`${work_dir}/${name}.bin`);
			assert(nvs_bin_data.byteLength === parse_int(size));
			for (let i = 0; i < nvs_bin_data.byteLength; i += page_size) {
				page_map.set(addr_parsed + i, {
					name: name,
					read: false,
					data: new Uint8Array(nvs_bin_data.buffer, i, page_size)
				});
			}
		}
	}

	return page_map;
}

/**
 * Asserts that configuration object used for generating firmware buffer is identical to compare data
 * @param {test_nvs_config} nvs_config
 * @param {test_nvs_compare} nvs_cmp
 */
export function firmware_assert(nvs_config, nvs_cmp) {
	/** @type {test_nvs_compare} */
	const nvs_config_cmp = {};
	for (const [ namespace, entries ] of Object.entries(nvs_config)) {
		if (!entries.length) continue;
		nvs_config_cmp[namespace] = Object.fromEntries(entries.map(({ key, value }) => [ key, value ]));
	}
	assert.deepStrictEqual(nvs_config_cmp, nvs_cmp);
}

/**
 * Asserts that configuration object used for generating firmware buffer is identical to NVS parser output
 * @param {test_nvs_config} nvs_config
 * @param {import("../src/nvs.js").NVS} nvs
 */
export function firmware_assert_nvs(nvs_config, nvs) {
	/** @type {test_nvs_compare} */
	const nvs_parsed_cmp = {};
	for (const [ namespace, key, value] of nvs) {
		const entries = nvs_parsed_cmp[namespace] || (nvs_parsed_cmp[namespace] = {});
		entries[key] = value;
	}
	firmware_assert(nvs_config, nvs_parsed_cmp);
}
