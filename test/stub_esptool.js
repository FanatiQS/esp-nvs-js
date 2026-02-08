// @ts-check

import { ESPLoader } from "../src/esptool.js";

/**
 * @typedef {import("esptool-js").ROM} ROM
 * @typedef {{ buf?: ArrayBuffer, chip?: ROM }} ESPLoaderStub
 */

// Global variable to set the path of the firmware file to fetch
globalThis.ESPLoaderStubFilePath = "/nvs.bin";



// Deletes all methods on ESPLoader
for (const key of Object.getOwnPropertyNames(ESPLoader.prototype)) {
	delete /** @type {any} */(ESPLoader.prototype)[key];
}

/**
 * @param {number} addr
 * @param {number} size
 * @this {ESPLoaderStub}
 */
ESPLoader.prototype.readFlash = async function (addr, size) {
	// Ensures loader was connected before reading flash
	if (!this.buf) {
		throw new Error("Loader not connected");
	}

	// Returns requested slice from buffer
	return new Uint8Array(this.buf.slice(addr, addr + size));
};

/**
 * @this {ESPLoaderStub}
 */
ESPLoader.prototype.connect = async function () {
	if (this.buf) {
		throw new Error("Loader already open");
	}
	const response = await fetch(ESPLoaderStubFilePath);
	this.buf = await response.arrayBuffer();
};

ESPLoader.prototype.runStub = async function () {
	this.chip = /** @type {ROM} */({});
	return this.chip;
};

ESPLoader.prototype.info = function () {
};
