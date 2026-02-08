declare type test_nvs_value = string | number | bigint | Uint8Array;

declare interface test_nvs_entry {
	key: string;
	value: test_nvs_value;
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
		[key: string]: test_nvs_value;
	}
}

declare type test_loader_map = Map<number, { name?: string, read: boolean, data: Uint8Array }>;
