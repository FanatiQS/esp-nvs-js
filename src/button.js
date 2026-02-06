// @ts-check

// Tells CSS that webserial is not supported
if ("serial" in navigator) {
	document.documentElement.classList.add("webserial-available");
}

// Sets "aria-working" attribute when async event handlers are working
class AsyncButton extends HTMLButtonElement {
	constructor() {
		super();

		// How many event callbacks that are working
		this.working = 0;

		// Maps event handler argument to internal wrapper
		this.listeners = new WeakMap();

		// Registering callbacks wrap in async dispatch
		for (const key in AsyncButton.prototype) {
			if (key.startsWith("on")) {
				Object.defineProperty(this, key, {
					get: () => {
						return super[key]?.callback;
					},
					set: (callback) => {
						/** @param {Event} event */
						const wrapper = (event) => this.dispatch(callback, event);
						super[key] = wrapper;
						wrapper.callback = callback;
					}
				});
			}
		}
	}

	/**
	 * @param {(event: Event) => any | Promise<any>} listener
	 * @param {Event} event
	 * @param {EventListenerObject|this} self
	 */
	async dispatch(listener, event, self=this) {
		if (!this.working) {
			this.setAttribute("aria-working", "true");
		}
		this.working++;

		try {
			return await listener.call(self, event);
		}
		finally {
			this.working--;
			if (!this.working) {
				this.removeAttribute("aria-working");
			}
		}
	}

	/**
	 * Registers event listener with async wrapper
	 * @param {keyof HTMLElementEventMap} type
	 * @param {EventListenerOrEventListenerObject} listener
	 * @param {boolean | AddEventListenerOptions} [options]
	 */
	addEventListener(type, listener, options) {
		// Registers previously registered callback for an event
		const wrapper = this.listeners.get(listener);
		if (wrapper) {
			super.addEventListener(type, wrapper, options);
		}
		// Registers callback with wrapper
		else if (typeof listener === "function") {
			/** @param {Event} event */
			const wrapper = (event) => this.dispatch(listener, event);
			super.addEventListener(type, wrapper, options);
			this.listeners.set(listener, wrapper);
		}
		// Registers event handler object with wrapper
		else if (listener && typeof listener.handleEvent === "function") {
			/** @param {Event} event */
			const wrapper = (event) => this.dispatch(listener.handleEvent, event, listener);
			super.addEventListener(type, wrapper, options);
			this.listeners.set(listener, wrapper);
		}
		// Registers invalid types for native errors
		else {
			super.addEventListener(type, listener, options);
		}
	}

	/**
	 * Un-registers event listener using async wrapper
	 * @param {keyof HTMLElementEventMap} type
	 * @param {EventListenerOrEventListenerObject} listener
	 * @param {boolean | AddEventListenerOptions} [options]
	 */
	removeEventListener(type, listener, options) {
		super.removeEventListener(type, this.listeners.get(listener) || listener, options);
	}
}

// Registers async button as custom element
customElements.define("async-button", AsyncButton, {
	extends: "button",
});
