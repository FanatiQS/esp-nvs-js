# ESP32 Non-Volatile Storage reader

![Test](https://github.com/FanatiQS/esp-nvs-js/actions/workflows/deploy.yml/badge.svg)
![Coverage](https://fanatiqs.github.io/esp-nvs-js/coverage.svg)

A JavaScript browser library for reading ESP32 Non-Volatile Storage (NVS) entries over USB using WebSerial.

## Highlights

* Reads specified NVS partition or auto-detects using device's partition table
* Supports all NVS types (integers, strings, blobs)
* Communicates directly with the ESP32 over USB using WebSerial
* Efficiently reads just enough data to find what you are looking for
* Can retrieve specific entry or get all entries
* Provides both function-based and class-based interfaces
* Includes built-in output formats for JSON and HTML
* Easily customizable output via user-friendly iterator pattern

## Browser Support

WebSerial is a non-standard feature and is only supported in Chromium-based browsers.
See [CanIUse](https://caniuse.com/web-serial) for browser support.

## Live Demos

* [Single value example](https://fanatiqs.github.io/esp-nvs-js/examples/single_value.html)
* [JSON example](https://fanatiqs.github.io/esp-nvs-js/examples/json.html)
* [WiFi example](https://fanatiqs.github.io/esp-nvs-js/examples/wifi.html)
* [Table example](https://fanatiqs.github.io/esp-nvs-js/examples/table.html)

## Install

The library can either be downloaded using NPM or loaded on request from a CDN.
Local install is only required for full TypeScript types support.

### CDN

Import the library from CDN into your JavaScript code like this:

```js
import { NVS } from "https://cdn.jsdelivr.net/gh/FanatiQS/esp-nvs-js@master/src/index.js";
```

### NPM

Install the library through NPM and then import it into your JavaScript code like this:

```bash
npm install fanatiqs/esp-nvs-js
```

```js
import { NVS } from "esp-nvs-js";
```

## Usage

Other than the limited browser support mentioned [above](#browser-support), WebSerial also only works on HTTPS/localhost and can only be triggered by a [UserGesture](https://developer.mozilla.org/en-US/docs/Glossary/Transient_activation), not on load.
This means that all examples need to be called from some kind of user input, like a button press or other form of user initiated trigger.

### Example 1

Get the value for a specific entry.
Look at `examples/single_value.html` ([demo](https://fanatiqs.github.io/esp-nvs-js/examples/single_value.html)) for a complete example.

```js
const nvs = new NVS(await navigator.serial.requestPort());
const chan = await nvs.get("nvs.net80211", "sta.chan");
console.log(chan);
```

### Example 2

Get all values as JSON.
Look at `examples/json.html` ([demo](https://fanatiqs.github.io/esp-nvs-js/examples/json.html)) for a complete example.

```js
const nvs = new NVS(await navigator.serial.requestPort());
console.log(await nvs.toJSON());
```

### Example 3

Render all values in HTML table.
Look at `examples/table.html` ([demo](https://fanatiqs.github.io/esp-nvs-js/examples/table.html)) for a complete example.

```js
const nvs = new NVS(await navigator.serial.requestPort());
document.body.appendChild(await nvs.toHTML());
```

### Example 4

Get all values through iterator.
Look at `examples/iterator.html` ([demo](https://fanatiqs.github.io/esp-nvs-js/examples/iterator.html)) for a complete example.

```js
const nvs = new NVS(await navigator.serial.requestPort());
await nvs.all();
for (const [ namespace, key, value ] of nvs) {
	console.log(namespace, key, value);
}
```

## API
The API documentation is available [here](https://fanatiqs.github.io/esp-nvs-js/docs/modules.html).

## Limitations

* No support for encrypted NVS partitions
* No delete or write support

## Known bugs
The class implementation of the parser can not run overlapped.
If multiple calls to the parser are done without awaiting result from the previous one first, it will drop entries.

```js
// This silently drops data
const [ value1, value2 ] = await Promise.all([
	nvs.get("foo", "bar"),
	nvs.get("foo", "baz")
]);

// This works correctly
const value1 = await nvs.get("foo", "bar");
const value2 = await nvs.get("foo", "baz");
```
