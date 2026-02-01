// @ts-check

export class SerialPortStub {
	getInfo() {
		return {};
	}
}

// Stubs SerialPort class to allow comparison between returned SerialPort from requestPort and global class
/** @type {typeof globalThis & { SerialPort?:typeof SerialPortStub }} */(globalThis).SerialPort = SerialPortStub;
