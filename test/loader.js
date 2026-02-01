// @ts-check

class Loader {
	/**
	 * @param {ArrayBuffer} buf
	 * @param {(addr:number, size:number) => void} [readFlashHook]
	 */
	constructor(buf, readFlashHook) {
		this.buf = buf;
		this.readFlashHook = readFlashHook;
	}

	/**
	 * @param {number} addr
	 * @param {number} size
	 */
	async readFlash(addr, size) {
		// Runs hook callback if defined
		if (this.readFlashHook) {
			this.readFlashHook(addr, size);
		}

		// Ensures requested region exists in buffer
		if ((addr + size) > this.buf.byteLength) {
			throw new Error(`Firmware buffer does not contain requested page: ${addr.toString(16)}`);
		}

		// Returns requested slice of buffer
		return new Uint8Array(this.buf.slice(addr, addr + size));
	}

	async connect() {}
	async runStub() {}
}

/**
 * @param {ArrayBuffer} buf
 * @param {(addr:number, size:number) => void} [readFlashHook]
 */
export function createLoader(buf, readFlashHook) {
	return /** @type {import("esptool-js").ESPLoader} */(/** @type {unknown} */(new Loader(buf, readFlashHook)));
}
