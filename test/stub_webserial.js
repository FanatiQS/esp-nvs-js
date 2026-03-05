// @ts-check

import { serialport_stub } from "./stub_serialport.js";

class SerialStub {
	// Requests a stubbed serial port
	async requestPort() {
		return serialport_stub();
	}

	// Always has a single stubbed port available
	async getPorts() {
		return [ await this.requestPort() ];
	}
}

// Defines serial using defineProperty since, it is read-only if it exists
Object.defineProperty(globalThis.navigator, "serial", { value: new SerialStub() });
