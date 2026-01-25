/**
 * This MagicMirror² module communicates with a IT8951 card to display MagicMirror² on a e-ink screen using IT8951 drivers.
 * @module MMM-IT8951
 * @class NodeHelper
 * @see `README.md`
 * @author Sébastien Mazzon
 * @license MIT - @see `LICENCE.txt`
 */
"use strict";

const NodeHelper = require("node_helper");
const Log = require("logger");
const Puppeteer = require("puppeteer");
const IT8951 = require("node-it8951");
const Sharp = require("sharp");

// E-ink display update modes (IT8951)
// See: https://www.waveshare.net/w/upload/c/c4/E-paper-mode-declaration.pdf
const DISPLAY_UPDATE_MODE_DU = 1;     // Fast, black/white only, no flash
const DISPLAY_UPDATE_MODE_GC16 = 2;   // High quality, 16 grays, flashy
const DISPLAY_UPDATE_MODE_GL16 = 3;   // 16 grays, little ghosting
const DISPLAY_UPDATE_MODE_GLR16 = 4;  // 16 grays, heavy ghosting
const DISPLAY_UPDATE_MODE_GLD16 = 5;  // 16 grays, for 6" displays
const DISPLAY_UPDATE_MODE_A2 = 6;     // Fast animation, 2 grays, flashy
const DISPLAY_UPDATE_MODE_DU4 = 7;    // Fast, 4 grays, rare ghosting

module.exports = NodeHelper.create({
	url: (config.useHttps ? "https://" : "http://") + config.address + ":" + config.port + config.basePath,
	isInitialized: false,
	config: {},
	stackAreas: [],
	IT8951_sysrun: undefined,

	start: function () {
		const isCurrentUserRoot = process.getuid() == 0;
		Log.log(`Starting node helper for: ${this.name}`);
		(async () => {
			let puppeteerArgs = ["--disable-gpu", "--single-process", "--disable-dev-shm-usage"];
			if (isCurrentUserRoot) {
				puppeteerArgs.push("--no-sandbox");
			}
			this.browser = await Puppeteer.launch({ executablePath: "/usr/bin/chromium-browser", args: puppeteerArgs });
			this.page = await this.browser.newPage();
			// Capture console output from the page for debugging
			this.page.on('console', msg => Log.debug(`[Puppeteer Console] ${msg.type()}: ${msg.text()}`));
			this.page.on('pageerror', err => Log.error(`[Puppeteer Error] ${err.message}`));
			const url = this.url;
			// Wait for Chromium to stabilize before navigating (Pi Zero 2W memory constraint)
			await new Promise(r => setTimeout(r, 5000));
			await this.page.goto(url, { waitUntil: "load" });
			Log.log(`Puppeteer launched on ${url}`);
			// Wait for MagicMirror modules to fully initialize
			await this.page.waitForFunction(() => typeof MM !== 'undefined' && MM.getModules().length > 0, { timeout: 60000 });
			Log.log(`MagicMirror modules loaded: ${await this.page.evaluate(() => MM.getModules().length)}`);
		})();
	},

	initializeEink: async function () {
		this.display = new IT8951(this.config.driverParam);
		if (!this.config.mock) {
			this.display.init();
			this.IT8951_sleep();
			Log.log(`IT8951 initialized (${this.display.width}x${this.display.height})`);
		} else {
			this.display = {
				width: config.electronOptions.width ? config.electronOptions.width : 1872,
				height: config.electronOptions.height ? config.electronOptions.height : 1404,
			}
		}
		await this.page.setViewport({ width: this.display.width, height: this.display.height, deviceScaleFactor: 1 });
		this.isInitialized = true;
		await this.fullRefresh(true);
		if (typeof (this.config.bufferDelay) === "number") {
			await this.initObservers();
		}
	},

	processStack: async function () {
		await new Promise(r => setTimeout(r, this.config.bufferDelay));
		let rectDone = [];
		this.IT8951_activate();
		while (this.stackAreas.length > 0) {
			const rect = this.stackAreas.shift();
			const rectStr = JSON.stringify(rect);
			if (!rectDone.includes(rectStr)) {
				rectDone.push(rectStr);
				Log.debug("Display IT8951:", rectStr);
				const imageDesc = await this.captureScreen(rect);
				await this.IT8951_draw(imageDesc);
			}
		}
		this.IT8951_sleep();
	},

	initObservers: async function () {
		await this.page.exposeFunction("puppeteerMutation", (rect, hasClass4levels, hasClassNo4levels) => {
			if (this.refreshTimeout) {
				if (hasClass4levels || this.config.defaultTo4levels && !hasClassNo4levels) {
					(async () => {
						const imageDesc = await this.captureScreen(rect);
						this.IT8951_activate();
						await this.IT8951_draw(imageDesc, true);
						this.IT8951_sleep();
					})();
				} else {
					this.stackAreas.push(rect);
					if (this.stackAreas.length == 1) {
						this.processStack();
					}
				}
			}
		});

		await this.page.evaluate(() => {
			const observer = new MutationObserver((mutations, observer) => {
				const ceil32 = (x) => Math.ceil(x / 32) * 32;
				const floor32 = (x) => Math.floor(x / 32) * 32;
				var rect = { left: Number.MAX_SAFE_INTEGER, top: Number.MAX_SAFE_INTEGER, right: 0, bottom: 0 };
				for (const mutation of mutations) {
					rectMut = mutation.target.getBoundingClientRect();
					is4levels = (mutation.target.closest(".eink-4levels") !== null);
					isNo4levels = (mutation.target.closest(".no-eink-4levels") !== null);
					if (rectMut.width !== 0 && rectMut.height !== 0) {
						rect = {
							left: floor32(Math.min(rect.left, rectMut.left)),
							top: Math.floor(Math.min(rect.top, rectMut.top)),
							right: ceil32(Math.max(rect.right, rectMut.right)),
							bottom: Math.ceil(Math.max(rect.bottom, rectMut.bottom))
						};
					}
				}
				if (rect.left < rect.right && rect.top < rect.bottom) {
					const domRect = new DOMRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
					puppeteerMutation(domRect, is4levels, isNo4levels);
				}
			});

			const target = document.querySelector("body");
			observer.observe(target, { childList: true, subtree: true });
		});
	},

	stop: function () {
		(async () => {
			await this.browser.close();
		})();
		if (this.config.mock === false && this.display !== undefined) {
			this.IT8951_activate();
			this.display.clear();
			this.display.close();
		}
	},

	getNbVisibleModules: async function () {
		return await this.page.evaluate(() => {
			return {
				nbModules: MM.getModules().filter(m => !m.hidden).length,
				nbModules4levels: MM.getModules().withClass("eink-4levels").filter(m => !m.hidden).length,
				nbModulesNo4levels: MM.getModules().withClass("no-eink-4levels").filter(m => !m.hidden).length
			};
		});
	},

	fullRefresh: async function (force16levels = false) {
		const self = this;
		clearTimeout(this.refreshTimeout);
		this.stackAreas.length = 0;
		Log.log("Full refresh eink");
		const imageDesc = await this.captureScreen();
		const nbModules = await this.getNbVisibleModules();
		const is4levels = !force16levels && ((this.config.defaultTo4levels && nbModules.nbModulesNo4levels == 0) || (!this.config.defaultTo4levels && nbModules.nbModules == nbModules.nbModules4levels));
		this.IT8951_activate();
		await this.IT8951_draw(imageDesc, is4levels);
		this.IT8951_sleep();
		// Trigger GC if available (requires --expose-gc flag)
		if (typeof global.gc === 'function') {
			global.gc();
		}
		this.refreshTimeout = setTimeout(function (self) {
			self.fullRefresh(false);
		}, this.config.updateInterval, self);
	},

	captureScreen: async function (rect) {
		if (rect === undefined || rect === "") {
			rect = { x: 0, y: 0, width: this.display.width, height: this.display.height };
		}
		const image = await this.page.screenshot({ type: "png", clip: rect });
		return { image: image, rect: rect };
	},

	IT8951_draw: async function (imageDesc, is4levels) {
		if (!this.config.mock) {
			const data = await Sharp(imageDesc.image)
				.gamma().greyscale().toColourspace("b-w")
				.raw()
				.toBuffer({ resolveWithObject: false });

			// Help GC by releasing the source image buffer
			imageDesc.image = null;

			if (is4levels !== true) {
				is4levels = this.isBufferOnlyGray4Levels(data);
			}
			// force6inch: Use GLD16 for 6" Kindle screens, DU4 for 7.8" Waveshare
			const driverParam = this.config.driverParam || {};
			const display_mode = driverParam.force6inch === true
				? (is4levels ? DISPLAY_UPDATE_MODE_GLD16 : false)
				: (is4levels ? DISPLAY_UPDATE_MODE_DU4 : false);

			this.display.draw(this.downscale8bitsTo4bits(data, is4levels),
				imageDesc.rect.x, imageDesc.rect.y,
				imageDesc.rect.width, imageDesc.rect.height,
				display_mode);
		} else {
			this.inc = (this.inc === undefined) ? 0 : (this.inc + 1) % 200;
			await Sharp(imageDesc.image)
				.gamma().greyscale().toColourspace("b-w")
				.png({ colours: is4levels ? 4 : 16 })
				.toFile("/tmp/screenshot-" + this.inc + ".png");
			// Help GC by releasing the source image buffer
			imageDesc.image = null;
		}
	},

	IT8951_activate: function () {
		if (!this.config.mock && this.IT8951_sysrun !== true) {
			this.display.wait_for_ready();  // Ensure previous operation (e.g., sleep) completed
			this.display.activate();
			this.display.wait_for_ready();  // Wait for activation to complete
		}
		this.IT8951_sysrun = true;
	},

	IT8951_sleep: function () {
		if (!this.config.mock && this.IT8951_sysrun !== false) {
			this.display.wait_for_display_ready();
			this.display.sleep();
		}
		this.IT8951_sysrun = false;
	},

	downscale8bitsTo4bits: function (buffer, is4levels) {
		let buffer4b = Buffer.alloc(buffer.length / 2);
		if (is4levels) {
			for (let i = 0; i < buffer.length / 2; i++) {
				buffer4b[i] = (parseInt((buffer[2 * i] >> 4) / 5) * 5)
					| ((parseInt((buffer[(2 * i) + 1] >> 4) / 5) * 5) << 4);
			}
		} else {
			for (let i = 0; i < buffer.length / 2; i++) {
				buffer4b[i] = (buffer[2 * i] >> 4) | (buffer[(2 * i) + 1] & 0xF0);
			}
		}
		return buffer4b;
	},

	isBufferOnlyGray4Levels: function (buffer) {
		for (let i = 0; i < buffer.length; i++) {
			const val = buffer[i] >> 4;
			if (val !== 0xF && val !== 0xA && val !== 0x6 && val !== 0) {
				return false;
			}
		}
		return true;
	},

	socketNotificationReceived: function (notification, payload) {
		if (!this.isInitialized && notification === "CONFIG") {
			this.config = payload;
			this.initializeEink();
		} else if (this.isInitialized && notification === "IT8951_ASK_FULL_REFRESH") {
			const force16levels = (typeof payload !== 'boolean' || payload);
			this.fullRefresh(force16levels);
		}
	},
});
