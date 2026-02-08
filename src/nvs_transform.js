// @ts-check

// cspell: ignore rowspan

import { nvs_iterate_ns, nvs_iterate_value } from "./nvs_parser.js";

/**
 * @typedef {{ type: "bigint", value: number, diff: number }} nvs_json_bigint
 * @typedef {number|string|number[]|nvs_json_bigint} nvs_json_value
 */

/**
 * Gets all cached data as JSON
 * @param {import("./nvs_parser.js").nvs_cache} cache
 */
export function nvs_transform_json(cache) {
	/** @type {Object<string,Object<string,nvs_json_value>>} */
	const output = {};
	for (const [ namespace, ns ] of nvs_iterate_ns(cache)) {
		/** @type {Object<string,nvs_json_value>} */
		const entries = {};
		output[namespace] = entries;
		for (const [ key, value ] of nvs_iterate_value(cache, ns)) {
			// Converts array buffer to plain array
			if (value instanceof Uint8Array) {
				entries[key] = Array.from(value);
			}
			// Converts bigint to object representation to be JSON.stringify safe
			else if (typeof value === "bigint") {
				const num = Number(value);
				entries[key] = {
					type: "bigint",
					value: num,
					diff: Number(value - BigInt(num))
				};
			}
			// No conversion for string or number
			else {
				entries[key] = value;
			}
		}
	}
	return output;
}

/**
 * Gets all cached data as HTML table
 * @param {import("./nvs_parser.js").nvs_cache} cache
 */
export function nvs_transform_html(cache) {
	// Creates HTML table
	const node_table = document.createElement("table");
	node_table.classList.add("nvs-table");
	const node_head = node_table.appendChild(document.createElement("thead"));
	node_head.appendChild(document.createElement("th")).textContent = "Namespace";
	node_head.appendChild(document.createElement("th")).textContent = "Key";
	node_head.appendChild(document.createElement("th")).textContent = "Value";

	// Adds every namespace to HTML table
	for (const [ namespace, ns ] of nvs_iterate_ns(cache)) {
		// Creates namespace container
		const node_body = node_table.appendChild(document.createElement("tbody"));

		// Adds every entry in namespace to HTML table
		for (const [ key, value ] of nvs_iterate_value(cache, ns)) {
			// Creates value label
			const node_value = document.createElement("div");
			if (ArrayBuffer.isView(value)) {
				node_value.classList.add("nvs-blob");
				node_value.innerHTML = Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
			}
			else {
				node_value.classList.add((typeof value === "string") ? "nvs-string" : "nvs-number");
				node_value.textContent = value.toString();
			}

			// Creates key label
			const node_key = document.createElement("div");
			node_key.classList.add("nvs-key");
			node_key.textContent = key;

			// Adds key and value to HTML table
			const node_row = node_body.appendChild(document.createElement("tr"));
			node_row.appendChild(document.createElement("td")).appendChild(node_key);
			node_row.appendChild(document.createElement("td")).appendChild(node_value);
		}

		// Creates namespace label and adds it to HTML table
		const node_ns_td = document.createElement("td");
		const node_ns = document.createElement("div");
		node_ns.classList.add("nvs-namespace");
		node_ns.textContent = namespace;
		node_ns_td.appendChild(node_ns);
		if (node_body.firstElementChild) {
			node_ns_td.setAttribute("rowspan", cache[ns].size.toString());
			node_body.firstElementChild.prepend(node_ns_td);
		}
		else {
			node_body.appendChild(node_ns_td);
		}
	}

	return node_table;
}
