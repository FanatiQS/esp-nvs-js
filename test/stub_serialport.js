// @ts-check

// Creates prototype inheriting from serial port to keep `instanceof` correct
/** @type {SerialPort} */
const proto = Object.create(SerialPort.prototype);

// Overwrites method called from ESPLoader to prevent illegal invocation exception
proto.getInfo = function getInfo() {
	return {};
};

/**
 * Serial port stub constructor
 * @returns {SerialPort}
 */
export function serialport_stub() {
	return Object.create(proto);
}
