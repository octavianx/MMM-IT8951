# MMM-IT8951

This is a module for the [MagicMirror²](https://github.com/MichMich/MagicMirror/).

This module communicates with a IT8951 card to display MagicMirror² on a e-ink screen.
It opens MagicMirror² page on a Chrome browser (with Puppeteer) and observes each DOM update.
The e-ink is partially refreshed on DOM update and fully refreshed periodically.

Partial refresh is done in a flashy way by default (that is needed to support the 16 gray levels) but if image is only B/W or has only colors in the 4 gray-levels (`gray4levels-x`), the refresh mode is changed to have a direct update without flash.
Another way to have a fast refresh without flash is by adding the CSS class `eink-4levels` to a module. Thus, the refresh is forced to 4-level gray only.

The IT8951 is typically used by some Waveshare e-paper screens.

## Supported Displays

| Display | Resolution | VCOM | Notes |
|---------|------------|------|-------|
| Waveshare 7.8" | 1872x1404 | 1380 | Check FPC cable for exact VCOM |
| Waveshare 6" HD | 1448x1072 | ~1530 | Use `force6inch: true` if needed |
| Kindle Paperwhite 6" | 1448x1072 | 1530 | Requires `force6inch: true` |

## Using the module

To use this module, add the following configuration block to the modules array in the `config/config.js` file:

```js
var config = {
	modules: [
		{
			module: "MMM-IT8951",
			config: {
				updateInterval: 60 * 1000, // 1 minute // Full refresh screen
				bufferDelay: 1000, // 1 second // Delay before taking updated items
				defaultTo4levels: false,
				driverParam: {
					MAX_BUFFER_SIZE: 32768,
					ALIGN4BYTES: true,
					VCOM: 1380,        // Check your screen's FPC cable for correct value
					force6inch: false  // Set to true for 6" displays
				},
				mock: false,
			},
		},
		{
			module: "foo", // One of your module you want to be refreshed in B/W only
			classes: "eink-4levels", // This class forces non flashy (but only on 4-levels gray) update of this module by MMM-IT8951 (only useful if defaultTo4levels == false)
		},
		{
			module: "bar", // One of your module you want to be refreshed in 16-levels of gray
			classes: "no-eink-4levels", // This class forces on 16-levels gray (but flashy) update of this module by MMM-IT8951 (only useful if defaultTo4levels == true)
		},
	]
}
```

### Example: 6" Kindle Paperwhite Display

```js
{
	module: "MMM-IT8951",
	config: {
		updateInterval: 60 * 1000,
		bufferDelay: 1000,
		driverParam: {
			MAX_BUFFER_SIZE: 32768,
			ALIGN4BYTES: true,
			VCOM: 1530,       // Kindle Paperwhite voltage
			force6inch: true  // Required for 6" displays
		},
	},
},
```

To use a specific color within the 4 levels of gray, these colors are defined in CSS and can be used:

```css
:root {
	/* Gray levels for IT8951 */
	--gray4levels-1: #fff;
	--gray4levels-2: #aaa;
	--gray4levels-3: #666;
	--gray4levels-4: #000;
}
```

When a refresh is done on an area that contains only these 4 colors, the refresh will not be flashy.

## Installation

```sh
cd ~/MagicMirror/modules # Change path to modules directory of your actual MagiMirror² installation
git clone https://github.com/octavianx/MMM-IT8951
cd MMM-IT8951
```

If nodejs version is compliant:

```
npm install --no-audit --no-fund --no-update-notifier --only=prod --omit=dev
```

Else, a full install + rebuild dependency may be needed:

```
npm install --no-audit --no-fund --no-update-notifier; npm rebuild rpio --update-binary
```

### OS configuration related

To be able to communicate with IT8951 card, SPI must be activated and permissions to communicate with.

**On Raspberry OS:**

This module requires `root` user to access `/dev/mem` for SPI communication.

```sh
sudo raspi-config
```

Then, enable SPI:
- Interfacing options
- P4 SPI Enable / Disable automatic loading of SPI core module

Run MagicMirror as root:

```sh
sudo npm run start
# or with pm2
sudo pm2 start mm
```

## Configuration options

| Option | Description |
|--------|-------------|
| `updateInterval` | *Optional* Full refresh screen interval<br><br>**Type:** `int` (milliseconds)<br>Default: 60000 (1 minute) |
| `bufferDelay` | *Optional* Delay before taking updated items in DOM to refresh parts of screen (only applied to no 4-levels parts. 4-levels parts are always instantly refreshed)<br><br>**Type:** `int` (milliseconds)<br>Default: 1000 (1 second)<br>Set `undefined` to ignore partial refresh, 0 to refresh immediately |
| `defaultTo4levels` | *Optional* If `true`, it considers all modules are on 4-levels gray unless modules having class "no-eink-4levels"<br>If `false`, it considers all modules are on 16-levels gray unless modules having class "eink-4levels"<br><br>**Type:** `boolean`<br>Default: `false` |
| `driverParam` | *Optional* Parameter to initialize IT8951 driver (see below)<br>Default: `{MAX_BUFFER_SIZE: 32768, ALIGN4BYTES: true, VCOM: 1530}` |
| `mock` | *Optional* `true` to not initialize IT8951 driver and store png files of changed areas in `/tmp` instead<br><br>**Type:** `boolean`<br>Default: `false` |

### driverParam Options

| Option | Description |
|--------|-------------|
| `MAX_BUFFER_SIZE` | SPI transfer buffer size. Recommended: 32768 |
| `ALIGN4BYTES` | Force X and Width to be multiples of 32. Required for some displays |
| `VCOM` | Display VCOM voltage. **Check the label on your screen's FPC cable**<br>Common values: 1380 (7.8"), 1530 (6" Kindle) |
| `force6inch` | Set to `true` for 6" displays. Uses different refresh mode (GLD16 instead of DU4) |

## Display Modes

The driver automatically selects the appropriate display mode:

| Mode | Value | When Used |
|------|-------|-----------|
| DU4 | 7 | 4-level gray content (fast, no flash) |
| GLD16 | 5 | 4-level gray on 6" displays (`force6inch: true`) |
| GC16 | 2 | 16-level grayscale (flashy, full gray range) |

## Notifications

To force a full refresh of the e-ink screen, the notification `IT8951_ASK_FULL_REFRESH` must be sent.
Payload can be set to force a refresh with 4-levels (`false`) or 16-levels (`undefined` or `true`).

Examples to send it from another module:

```js
// Refresh with 16-levels
this.sendNotification("IT8951_ASK_FULL_REFRESH");
// [...]

// Refresh with 16-levels
this.sendNotification("IT8951_ASK_FULL_REFRESH", true);
// [...]

// Refresh with 4-levels
this.sendNotification("IT8951_ASK_FULL_REFRESH", false);
// [...]
```

## Dependencies

- [node-it8951](https://github.com/octavianx/node-it8951-epaper) - IT8951 SPI/GPIO driver
- [puppeteer](https://pptr.dev/) - Headless Chrome for screenshot capture
- [sharp](https://sharp.pixelplumbing.com/) - Image processing (grayscale conversion)

## License

MIT - Based on original work by Sébastien Mazzon
