// @ts-check

import { SerialPortStub } from "./stub_serialport.js";

class SerialStub {
	async requestPort() {
		return new SerialPortStub();
	}

	async getPorts() {
		return [ await this.requestPort() ];
	}
}

// Defines serial using defineProperty since, it is read-only if it exists
Object.defineProperty(navigator, "serial", { value: new SerialStub() });
