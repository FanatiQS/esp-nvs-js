// @ts-check

import { register } from "node:module";

// Registers this file as a module import hook
register(import.meta.url);

/**
 * Redirects esptool-js URL import to installed module
 * @param {string} specifier
 * @param {void} context
 * @param {(specifier:string) => void} next
 */
export function resolve(specifier, context, next) {
	if (specifier.startsWith("https://cdn.jsdelivr.net/npm/esptool-js")) {
		return next("esptool-js");
	}
	return next(specifier);
}
