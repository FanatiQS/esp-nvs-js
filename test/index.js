// @ts-check

import { startTestRunner, defaultReporter, summaryReporter } from "@web/test-runner";
import { partitions_generate, partitions_cache } from "./partitions.js";

// Generates partition files and gets cache
await partitions_generate();
const partitions = await partitions_cache();

await startTestRunner({
	autoExitProcess: true,
	config: {
		files: [
			`${import.meta.dirname}/test.js`,
			`${import.meta.dirname}/button.html`
		],
		nodeResolve: true,
		coverage: true,
		reporters: [
			defaultReporter({ reportTestProgress: true }),
			summaryReporter({})
		],
		testFramework: {
			config: { ui: "tdd" }
		},
		middleware: [
			(context, next) => {
				const prefix_data = "/api/data/";
				if (context.path.startsWith(prefix_data)) {
					const name = context.path.slice(prefix_data.length);
					const partition = partitions.get(name);
					if (partition) {
						context.body = partition.data;
						return;
					}
				}

				// Serves address of requested NVS partition
				const prefix_addr = "/api/addr/";
				if (context.path.startsWith(prefix_addr)) {
					const name = context.path.slice(prefix_addr.length);
					const partition = partitions.get(name);
					if (partition) {
						context.body = partition.addr.toString();
						return;
					}
				}

				return next();
			}
		]
	}
});
