// @ts-check

import { readFile, mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert";
import test from "node:test";
import { parse as csv_parse } from "csv-parse/sync";

import { createLoader } from "./loader.js";
import "./stub_serialport.js";
import { NVS } from "../src/index.js";

/**
 * @typedef {Object<string,{ key: string, value: string|number|bigint|Uint8Array, type?: string }[]>} test_nvs_config
 * @typedef {{ name: string, type: string, subtype: string, size: number, data?: test_nvs_config }[]} test_partitions
 * @typedef {Object<string,Object<string,string|number|bigint|Uint8Array>>} test_nvs_compare
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
export async function test_parser_generate(partitions, work_dir=default_dir) {
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
				for (const { key, type, value } of nvs_entries) {
					nvs_csv.write(`${key},data,${type},`);
					nvs_csv.write(`${(value instanceof Uint8Array) ? Buffer.from(value).toString("hex") : value}\n`);
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
export async function test_parser_assemble(work_dir=default_dir) {
	// Generates partition table CSV from binary containing calculated address for each partition
	const partition_table_bin_path = `${work_dir}/partition_table.bin`;
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
	firmware.set(await readFile(partition_table_bin_path), 0x8000);
	for (const { addr, path } of partitions) {
		firmware.set(await readFile(path), addr);
	}

	return firmware;
}

/**
 * Generates firmware buffer from configuration and asserts that it is parsed correctly
 * @param {test_nvs_config} nvs_config
 * @param {string} [work_dir]
 */
export async function test_parser_assert(nvs_config, work_dir=default_dir) {
	// Creates compare object from config data
	/** @type {test_nvs_compare} */
	const cmp_config = {};
	for (const [ namespace, entries ] of Object.entries(nvs_config)) {
		cmp_config[namespace] = Object.fromEntries(entries.map(({ key, value }) => [ key, value ]));
	}

	// Generates and parses firmware buffer
	const firmware = await test_parser_assemble(work_dir);
	const nvs = new NVS(createLoader(firmware));
	await nvs.all();

	// Asserts iterator data is identical to configuration used to create it
	/** @type {test_nvs_compare} */
	const cmp_nvs = {};
	for (const [ namespace, key, value] of nvs) {
		const entries = cmp_nvs[namespace] || (cmp_nvs[namespace] = {});
		entries[key] = value;
	}
	assert.deepStrictEqual(cmp_config, cmp_nvs);

	// Asserts JSON data is identical to configuration used to create it
	/** @type {test_nvs_compare} */
	const cmp_json = {};
	for (const [ namespace, entries ] of Object.entries(nvs.toJSON())) {
		cmp_json[namespace] = Object.fromEntries(Object.entries(entries).map(([ key, value]) => {
			// No conversion needed
			if (typeof value !== "object") {
				return [ key, value ];
			}
			// Converts JSON numbers array back to Uint8Array
			else if (Array.isArray(value)) {
				return [ key, new Uint8Array(value) ];
			}
			// Converts JSON bigint back to bigint primitive
			else {
				return [ key, BigInt(value.value) + BigInt(value.diff) ];
			}
		}));
	}
	assert.deepStrictEqual(cmp_config, cmp_json);
}



const nvs_data = {
	"uint-max": [
		{ key: "u8-max", type: "u8", value: 2 ** 8 - 1 },
		{ key: "u16-max", type: "u16", value: 2 ** 16 - 1 },
		{ key: "u32-max", type: "u32", value: 2 ** 32 - 1 },
		{ key: "u64-max", type: "u64", value: 2n ** 63n - 1n } // python doesn't support full range of unsigned 64-bit values
	],
	"uint-min": [
		{ key: "u8-min", type: "u8", value: 0 },
		{ key: "u16-min", type: "u16", value: 0 },
		{ key: "u32-min", type: "u32", value: 0 },
		{ key: "u64-min", type: "u64", value: 0 }
	],
	"int-max": [
		{ key: "i8-max", type: "i8", value: 2 ** 7 - 1 },
		{ key: "i16-max", type: "i16", value: 2 ** 15 - 1 },
		{ key: "i32-max", type: "i32", value: 2 ** 31 - 1 },
		{ key: "i64-max", type: "i64", value: 2n ** 63n - 1n }
	],
	"int-min": [
		{ key: "i8-min", type: "i8", value: -(2 ** 7) },
		{ key: "i16-min", type: "i16", value: -(2 ** 15) },
		{ key: "i32-min", type: "i32", value: -(2 ** 31) },
		{ key: "i64-min", type: "i64", value: -(2n ** 63n) }
	],
	"js-safe": [
		{ key: "safe-u64-max", type: "u64", value: Number.MAX_SAFE_INTEGER },
		{ key: "safe-i64-max", type: "i64", value: Number.MAX_SAFE_INTEGER },
		{ key: "safe-i64-min", type: "i64", value: -Number.MAX_SAFE_INTEGER }
	],
	"js-unsafe": [
		{ key: "unsafe-u64-max", type: "u64", value: BigInt(Number.MAX_SAFE_INTEGER) + 1n },
		{ key: "unsafe-i64-max", type: "i64", value: BigInt(Number.MAX_SAFE_INTEGER) + 1n },
		{ key: "unsafe-i64-min", type: "i64", value: -BigInt(Number.MAX_SAFE_INTEGER) - 1n }
	],
	"string": [
		{ key: "short", type: "string", value: "banana" },
		{ key: "long", type: "string", value: "0123456789abcdef".repeat(124 * 2 - 1) + "0123456789abcde" },
		{ key: "utf8", type: "string", value: "åäö√ø†ç≈ƒ†=π¬…æ" },
		{ key: "emojis", type: "string", value: "💂‍♂️" }
	],
	"blob": [
		{ key: "single-page", type: "hex2bin", value: new Uint8Array(5).map((value, index) => index) },
		{ key: "multi-page", type: "hex2bin", value: new Uint8Array(0x2000).map((value, index) => index) }
	],
	"extra": [
		{ key: "u64-unsafe", type: "u64", value: 2n ** 63n - 512n }
	]
};

test("parser", async () => {
	await test_parser_generate([
		{ name: "phy_init", type: "data", subtype: "phy", size: 0x1000 },
		{ name: "nvs", type: "data", subtype: "nvs", size: 0x6000, data: nvs_data },
		{ name: "factory", type: "app", subtype: "factory", size: 0x10000 }
	]);
	await test_parser_assert(nvs_data);
});






// @todo has to be located before imports to work
// /// <reference path="./types.d.ts" />



/**
 * @typedef {object[]} nvs_csv_data
 * @property {string} key
 * @property {string} type
 * @property {string} encoding
 * @property {string} value
 */

/**
 * @param {string} path
 * @param {string} cmd
 * @param {string} [cwd]
 */
async function read_or_generate(path, cmd) {
	try {
		return await readFile(path);
	}
	catch (err) {
		if (/** @type {Error&{ code: string }} */(err).code !== "ENOENT") throw err;
		await python(cmd);
		return await readFile(path);
	}
}

/**
 * @param {string} partition_table_csv_path
 * @param {string} src_path_nvs
 * @param {string} output_dir
 */
async function firmware_read(partition_table_csv_path, src_path_nvs, output_dir) {
	// @todo
	partition_table_csv_path = partition_table_csv_path;
	const partition_table_bin_path = `${output_dir}/partition_table.bin`;
	const partition_table_script = "$IDF_PATH/components/partition_table/gen_esp32part.py";
	const partition_table_cmd = `${partition_table_script} ${partition_table_csv_path} ${partition_table_bin_path}`;
	const partition_table_data = await read_or_generate(partition_table_bin_path, partition_table_cmd);

	// @todo
	const { stdout } = await python(`$IDF_PATH/components/partition_table/gen_esp32part.py ${partition_table_bin_path}`);
	const csv = csv_parse(stdout, { comment: "#" });
	const partition_table_parsed = [];
	let total_size = 0x9000;
	for (const [ name, type, subtype, addr, size ] of csv) {
		const size_parsed = parse_int(size);
		if (type === "data" && subtype === "nvs") {
			partition_table_parsed.push({ addr: parse_int(addr), size: size_parsed });
		}
		total_size += size_parsed;
	}

	// @todo
	const nvs_path = `${output_dir}/nvs.bin`;
	const nvs_script = "$IDF_PATH/components/nvs_flash/nvs_partition_generator/nvs_partition_gen.py";
	const nvs_cmd = `${nvs_script} generate ${src_path_nvs} ${nvs_path} ${total_size}`;
	const nvs_data = await read_or_generate(nvs_path, nvs_cmd);

	// @todo
	const firmware = new Uint8Array(total_size);
	firmware.fill(0xff);
	firmware.set(partition_table_data, 0x8000);

	// @todo
	let nvs_offset = 0;
	for (const partition of partition_table_parsed) {
		const page_data = nvs_data.subarray(nvs_offset, partition.size);
		firmware.set(page_data, partition.addr);
		nvs_offset += partition.size;
	}

	return firmware;
}

/**
 * @param {NVS} nvs
 * @param {string} csv_path
 */
async function firmware_compare2(nvs, csv_path) {
	const nvs_data = nvs.toJSON();
	const csv_data = csv_parse(await readFile(csv_path, "utf8"), { comment: "#", columns: true });
	let namespace = "";
	for (const info of /** @type {nvs_csv_data} */(csv_data)) {
		// @todo
		if (info.type === "namespace") {
			namespace = info.key;
		}
		// @todo
		else {
			const nvs_value = nvs_data[namespace][info.key];
			if (info.type === "data") {
				switch (info.encoding) {
					case "u8":
					case "i8":
					case "u16":
					case "i16":
					case "u32":
					case "i32": {
						assert(typeof nvs_value === "number");
						assert(Number(info.value) === nvs_value);
						break;
					}
					case "u64":
					case "i64": {
						throw new Error("NOT IMPLEMENTED YET!");
						break;
					}
					case "string": {
						assert(typeof nvs_value === "string");
						assert(info.value === nvs_value);
						break;
					}
					case "hex2bin": {
						const data = Buffer.from(info.value, "hex");
						assert(Array.isArray(nvs_value));
						assert.deepStrictEqual(Array.from(data), nvs_value);
						break;
					}
					default: {
						throw new Error(`Type not implemented: ${info.encoding}`);
					}
				}
			}
			// @todo
			else if (info.type === "file") {
				const file_data = await readFile(info.value);
				switch (info.encoding) {
					case "binary": {

						break;
					}
				}
				console.log(info.encoding, info.value, info.key, nvs_value);
				// throw new Error("not implemented");
			}
		}
	}
}













/**
 * Generates partition table
 * @param {string} path_input
 */
async function generate_partitions_table(path_input) {
	const path_output = `${output_dir}/partition_table.bin`;
	const path_script = "$IDF_PATH/components/partition_table/gen_esp32part.py";
	await python(`${path_script} ${path_input} ${path_output}`);
	return path_output;
}

/**
 * @param {string} name
 * @param {number} size
 * @param {string} path_input
 */
async function generate_nvs(size, path_input) {
	const path_output = `${output_dir}/partition_nvs.bin`;
	const path_script = "$IDF_PATH/components/nvs_flash/nvs_partition_generator/nvs_partition_gen.py";
	await python(`${path_script} generate ${path_input} ${path_output} ${size}`);
	return path_output;
}



// @todo maybe get a csv parser to get name and size of partitions from partition table file that can then be used to create 
// @todo getting the address to file mapping is the most important thing to get

// generate_partitions_table("$IDF_PATH/components/partition_table/partitions_singleapp.csv");
// generate_nvs("nvs", 0x6000, "$IDF_PATH/components/nvs_flash/nvs_partition_generator/sample_val.csv");

// const output = await python("$IDF_PATH/components/partition_table/gen_esp32part.py ./generated/partition_table.bin");



async function parse_partition_table() {
	const path_input = "./generated/partition_table.bin";
	const { stdout } = await python(`$IDF_PATH/components/partition_table/gen_esp32part.py ${path_input}`);
	const csv = parse(stdout, { comment: "#" });

	const partition_table = [];
	let total_size = 0;
	for (const [ name, type, subtype, addr, size ] of csv) {
		const size_parsed = parse_int(size);
		if (type === "data" && subtype === "nvs") {
			partition_table.push({ addr: parse_int(addr), size: size_parsed });
		}
		total_size += size_parsed;
	}

	console.log(partition_table, total_size.toString(16));
}

// const csv = parse(output.stdout, { comment: "#" });
// const addrs = [];
// for (const [ name, type, subtype, addr, size ] of csv) {
// 	if (type === "data" && subtype === "nvs") {
		
// 		addrs.push([ addr, size ]);
// 	}
// }
// console.log(addrs)

// generate_partitions_table("./partitions.csv");
// parse_partition_table();






// const fw = await firmware_read(
// 	"./partitions.csv",
// 	// "/Users/fanatiqs/esp/esp-idf-v5.5.1/components/nvs_flash/nvs_partition_generator/sample_val.csv",
// 	"/Users/fanatiqs/esp/esp-idf-v5.5.1/components/nvs_flash/nvs_partition_generator/sample_singlepage_blob.csv",
// 	"./generated3"
// );
// const loader = createLoader(fw);
// const nvs = new NVS(loader);
// await nvs.all();


// firmware_compare(nvs, "/Users/fanatiqs/esp/esp-idf-v5.5.1/components/nvs_flash/nvs_partition_generator/sample_singlepage_blob.csv");






// @todo generate nvs configuration object
// @todo firmware_partition_table_generate_csv // generates a partition table csv file from object
// @todo firmware_partition_table_generate_bin // generates a partition table binary file from csv
// @todo firmware_partition_table_get_size // gets total size of all partitions in partition table
// @todo firmware_generate_nvs_csv // generates nvs csv file from object
// @todo firmware_generate_nvs_bin // generates nvs binary file from csv
// @todo firmware_assemble // assembles multiple bin files into a single buffer
// @todo firmware_compare // compares parsed result from library with original configuration object

/**
 * @param {string} path
 * @param {test_config} config
 */
function generate_nvs_csv(path, config) {
	// @todo
	const csv = createWriteStream(path);
	csv.write("key,type,encoding,value\n");

	for (const [ namespace, entries ] of Object.entries(config)) {
		// @todo
		csv.write(`${namespace},namespace,,\n`);

		for (let { key, value, type } of entries) {
			// @todo
			if (typeof value === "string") {
				assert(type == undefined);
				type = "string";
			}
			// @todo
			else if (value instanceof Buffer) {
				assert(type == undefined);
				type = "hex2bin";
				value = value.toString("hex");
			}
			// @todo
			else {
				assert(type != undefined)
			}

			// @todo
			csv.write(`${key},data,${type},${value}\n`);
		}
	}
}

// generate_nvs_csv("./generated3/nvs.csv", {
// 	"test": [
// 		{ key: "dummy1", value: 1, type: "u8" }
// 	]
// });

// await firmware_partition_table_generate_csv("./generated4", [{
// 	name: "banana",
// 	type: "data",
// 	subtype: "nvs",
// 	size: 0x4000
// }]);




