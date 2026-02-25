// @ts-check

import { serialport_stub } from "./stub_serialport.js";

class SerialStub {
	async requestPort() {
		return serialport_stub();
	}

	async getPorts() {
		return [ await this.requestPort() ];
	}
}

// Defines serial using defineProperty since, it is read-only if it exists
Object.defineProperty(globalThis.navigator, "serial", { value: new SerialStub() });
