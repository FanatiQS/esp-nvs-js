type nvs_value = import("../src/nvs_parser.js").nvs_value;

declare interface test_nvs_entry {
	key: string;
	value: nvs_value;
	type?: string;
}

declare interface test_nvs_config {
	[key: string]: test_nvs_entry[]
}

interface test_partition {
	name: string;
	type: string;
	subtype: string;
	size: number;
	data?: test_nvs_config;
}

declare type test_partitions = Array<test_partition>;

declare interface test_nvs_compare {
	[key: string]: {
		[key: string]: nvs_value;
	}
}

declare type test_loader_map = Map<number, { name?: string, read: boolean, data: Uint8Array }>;
