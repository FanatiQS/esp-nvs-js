// @ts-check

import assert from "node:assert";
import { readFile, mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { parse as csv_parse } from "csv-parse/sync";

import { nvs_config_default, nvs_config2, nvs_config_reorder, nvs_config_page_space_usable } from "./nvs_config.js";

/**
 * @typedef {object[]} test_partitions_config
 * @property {string} name
 * @property {string} type
 * @property {string} subtype
 * @property {number} size
 * @property {import("./nvs_config.js").test_nvs_config} [data]
 */

// Default directory to use for generated files
const default_dir = `${import.meta.dirname}/generated`;

// Runs a Python script
const python = promisify(exec);

// Gets path to installed and set up ESP-IDF SDK for python scripts
const { IDF_PATH } = process.env;
assert(IDF_PATH, "ESP-IDF not available");

// Configuration for partition table and NVS partitions generation
/** @type {test_partitions_config} */
const partitions_config = [
	{ name: "phy_init", type: "data", subtype: "phy", size: 0x1000 },
	{ name: "nvs", type: "data", subtype: "nvs", size: 0x6000, data: nvs_config_default },
	{ name: "factory", type: "app", subtype: "factory", size: 0x10000 },
	{ name: "nvs2", type: "data", subtype: "nvs", size: 0x4000, data: nvs_config2 },
	{
		name: "duplicate-keys",
		type: "data",
		subtype: "nvs",
		size: 0x3000,
		data: {
			foo: [
				{ key: "bar", type: "u8", value: 1 },
				{ key: "bar", type: "i16", value: 2 }
			]
		}
	},
	{
		name: "blob-data-on-str",
		type: "data",
		subtype: "nvs",
		size: 0x5000,
		data: {
			foo: [
				{ key: "baz", value: "0".repeat(nvs_config_page_space_usable - 1 - 32) }, // string filling to end of page
				{ key: "bar", value: 1, type: "u8" }, // dummy data since string can for some reason not fill page by itself
				{ key: "baz", value: new Uint8Array(nvs_config_page_space_usable).map((value, index) => index) } // blob with data and index in separate pages
			]
		}
	},
	{ name: "reorder", type: "data", subtype: "nvs", size: 0x5000, data: nvs_config_reorder }
];

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
		case "m": {
			return Number(input.slice(0, -1)) * 1024 * 1024;
		}
		default: {
			return Number(input);
		}
	}
}

/**
 * Generates partition table and partitions binaries from configuration
 * @param {string} [work_dir]
 */
export async function partitions_generate(work_dir = default_dir) {
	// Creates partition table CSV file
	await mkdir(work_dir, { recursive: true });
	const partition_table_csv_path = `${work_dir}/partition_table.csv`;
	const partition_table_csv = createWriteStream(partition_table_csv_path);
	partition_table_csv.write("#name,type,subtype,offset,size,flags\n");

	// Writes configuration to partition table CSV file and its optional data to separate CSV file
	for (const { name, type: partition_type, subtype, size, data } of partitions_config) {
		partition_table_csv.write(`${name},${partition_type},${subtype},,0x${size.toString(16)},\n`);

		// Only generates NVS CSV if data is available
		if (!data) continue;

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
				assert(type);

				// Writes NVS entry
				nvs_csv.write(`${key},data,${type},${value}\n`);
			}
		}

		// Ensures CSV file is completely written to before using it
		await new Promise((resolve) => {
			nvs_csv.end(resolve);
		});

		// Generates NVS binary from CSV file
		const nvs_bin_path = `${work_dir}/${name}.bin`;
		const nvs_script_path = "python -m esp_idf_nvs_partition_gen";
		await python(`${nvs_script_path} generate ${nvs_csv_path} ${nvs_bin_path} ${size}`);
	}

	// Ensures partition table CSV file is completely written before using it
	await new Promise((resolve) => {
		partition_table_csv.end(resolve);
	});

	// Generates partition table binary from CSV file
	const partition_table_bin_path = `${work_dir}/partition_table.bin`;
	const partition_table_bin_script = `python ${IDF_PATH}/components/partition_table/gen_esp32part.py`;
	await python(`${partition_table_bin_script} ${partition_table_csv_path} ${partition_table_bin_path}`);
}

/**
 * Caches generated NVS partitions
 * @param {string} [work_dir]
 */
export async function partitions_cache(work_dir = default_dir) {
	// Reads partition table binary file first for better error if files have not been generated
	const partition_table_bin_path = `${work_dir}/partition_table.bin`;
	const partition_table_bin_data = await readFile(partition_table_bin_path);

	// Generates partition table CSV from binary containing calculated address for each partition
	const partition_table_csv_script = `python ${IDF_PATH}/components/partition_table/gen_esp32part.py ${partition_table_bin_path}`;
	const { stdout: partition_table_csv_data } = await python(partition_table_csv_script);

	// Creates partitions list with partition table region
	const partitions = new Map([ [ "partition_table", { addr: 0x8000, data: new Uint8Array(partition_table_bin_data) } ] ]);

	// Registers NVS partitions in partitions list
	for (const [ name, type, subtype, addr, size ] of csv_parse(partition_table_csv_data, { comment: "#" })) {
		if (type === "data" && subtype === "nvs") {
			const nvs_bin_data = await readFile(`${work_dir}/${name}.bin`);
			assert(nvs_bin_data.byteLength === parse_int(size));
			partitions.set(name, {
				addr: parse_int(addr),
				data: new Uint8Array(nvs_bin_data.buffer)
			});
		}
	}

	return partitions;
}
