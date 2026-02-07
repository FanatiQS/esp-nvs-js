// @ts-check

export class Loader {
	/**
	 * @param {ArrayBufferLike} buf
	 * @param {(addr:number, size:number) => void|Promise<void>} [readFlashHook]
	 */
	constructor(buf, readFlashHook) {
		this.connected = false;
		this.buf = buf;
		this.readFlashHook = readFlashHook;
	}

	/**
	 * @param {number} addr
	 * @param {number} size
	 */
	async readFlash(addr, size) {
		// Ensures loader was connected before reading flash
		if (this.connected === false) {
			throw new Error("Loader not connected");
		}

		// Runs hook callback if defined
		if (this.readFlashHook) {
			await this.readFlashHook(addr, size);
		}

		// Ensures requested region exists in buffer
		if ((addr + size) > this.buf.byteLength) {
			throw new Error(`Firmware buffer does not contain requested page: 0x${addr.toString(16)}`);
		}

		// Returns requested slice of buffer
		return new Uint8Array(this.buf.slice(addr, addr + size));
	}

	async connect() {
		this.connected = true;
	}
	async runStub() {}
}

/**
 * @param {ArrayBufferLike} buf
 * @param {(addr:number, size:number) => void} [readFlashHook]
 */
export function createLoader(buf, readFlashHook) {
	return /** @type {import("esptool-js").ESPLoader} */(/** @type {unknown} */(new Loader(buf, readFlashHook)));
}
