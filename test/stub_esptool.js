// @ts-check

import { ESPLoader } from "../src/esptool.js";
import { Loader } from "./loader.js";

/**
 * @typedef {{loader:Loader?}} ESPLoaderStub
 * @typedef {import("esptool-js").ROM} ROM
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
	if (!this.loader) {
		throw new Error("Loader not connected");
	}
	return this.loader.readFlash(addr, size);
};

/**
 * @this {ESPLoaderStub}
 */
ESPLoader.prototype.connect = async function () {
	if (!this.loader) {
		const response = await fetch(ESPLoaderStubFilePath);
		this.loader = new Loader(await response.arrayBuffer());
	}
	this.loader.connect();
};

ESPLoader.prototype.runStub = async function () {
	return /** @type {ROM} */({});
};

ESPLoader.prototype.info = function () {
};
