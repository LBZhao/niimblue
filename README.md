# NiimBlue — Linbo's edition

> An unofficial, edited version of [NiimBlue](https://github.com/MultiMote/niimblue) by **MultiMote**.
> All credit for the original app and the printer protocol goes to MultiMote and the NiimBlue contributors.
> For the official app, go to [niim.blue](https://niim.blue) or the [original repository](https://github.com/MultiMote/niimblue).

Tested on a **NIIMBOT M2_H** (300 dpi, 36.5 × 9.5 mm split labels: a 25 mm rounded piece plus a 9.5 mm round dot) with a **Redmi Note 17 Pro**, using the Android app built from `standalone-apps/capacitor`.

### What this edition changes

- **Split labels with a dot**: a main piece and a second piece can each be a rectangle, rounded rectangle or circle. The main text, a copy for the dot and today's date are fitted automatically. Short names (one or two words) are stacked one word per line in the dot, and wrapped words never run into the date.
- **Editor**: the gap between split pieces shows as a 1 mm strip with a dashed line, and the label zooms to fit the phone's screen width.
- **Label fonts**: Barlow Semi Condensed, Roboto Condensed, IBM Plex Sans Condensed and Atkinson Hyperlegible Next are bundled for offline use. Changing the main font also updates the dot and the date.
- **Recently printed**: every printed label is listed under the toolbar, once each (reprints and date changes don't add copies); tap one to load it (Undo restores the previous label). Saved and imported labels always print with today's date.
- **Save to phone**: on Android, labels saved with a button go to `Documents/NiimBlue/Saved`, and every label printed for the first time is kept quietly in `Documents/NiimBlue/History` as `YYYYMMDD_<first line>.json`. Both survive reinstalling the app.
- **Easier on a phone**: saved labels and label presets are shown in two columns with real-shape previews, and an Edit mode with large delete buttons and a confirmation.
- **Fixes**: label thumbnails are drawn at the real label size, and M2 printers are detected and set to the top print direction.

### Install and build

- **Android app:** download the APK from this repository's [Releases](https://github.com/LBZhao/niimblue/releases). Pushing a tag like `v2026.11.0` builds it with GitHub Actions (`.github/workflows/build-android-app.yml`).
- **Checks:** `npm run lint`, `npm run sv-check` and `npm test` (browser tests in Chrome) run on every push.

### Credits

- **[NiimBlue](https://github.com/MultiMote/niimblue)** by MultiMote and its contributors, MIT License — the app this edition is built on. Translations by the NiimBlue community on [Weblate](https://weblate.mmote.ru/engage/niimblue/).
- **[NiimBlueLib](https://github.com/MultiMote/niimbluelib)** by MultiMote — NIIMBOT printer communication, and the [NIIMBOT Community Wiki](https://printers.niim.blue) protocol documentation.
- Libraries: [Svelte](https://svelte.dev), [Fabric.js](https://fabricjs.com), [Capacitor](https://capacitorjs.com), [Bootstrap](https://getbootstrap.com), [Zod](https://zod.dev), [Day.js](https://day.js.org), [Fontsource](https://fontsource.org), [Material Icons](https://fonts.google.com/icons) (Apache 2.0).
- Fonts, all under the [SIL Open Font License 1.1](https://openfontlicense.org):
  - Noto Sans — Copyright 2022 The Noto Project Authors
  - Barlow Semi Condensed — Copyright 2017 The Barlow Project Authors
  - Roboto Condensed — Copyright 2011 Google Inc.
  - IBM Plex Sans Condensed — Copyright 2019 IBM Corp.
  - Atkinson Hyperlegible Next — Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors
- The changes in this edition were made by Linbo Zhao, assisted by **Claude Opus 5.5** (Anthropic) through Claude Code.

This edition keeps the original MIT License (see [LICENSE](LICENSE)). It is not affiliated with NIIMBOT or with the NiimBlue project.

---

*The original NiimBlue README follows.*

<div align="center">

[![logo](about/logo.svg)](https://niim.blue)

# NIIMBOT printers webui

![ux](about/ux.png)

Design and print labels right from your browser

[FAQ](https://github.com/MultiMote/niimblue/wiki/Frequently-asked-questions) | [Discord](https://discord.gg/jXPAfZVd8a) | [Telegram](https://t.me/niimblue) |  [NIIMBOT Community Wiki](https://printers.niim.blue)

[NiimBlueLib](https://github.com/MultiMote/niimbluelib) is used for communication

Deployments:

[niim.blue](https://niim.blue) ![de](https://github.com/user-attachments/assets/07e72fdf-dd32-47a6-9071-43e77e9be7fa) main | [dev.niim.blue](https://dev.niim.blue) ![de](https://github.com/user-attachments/assets/07e72fdf-dd32-47a6-9071-43e77e9be7fa) dev | [2.niim.blue](https://2.niim.blue) ![ru](https://github.com/user-attachments/assets/b85647b0-4fb3-4b39-9da0-c31ec171067c) main

Give thanks:

[Boosty](https://boosty.to/multimote) | [Lava](https://app.lava.top/mithriss_art?tabId=donate) (less fees)


</div>

## Features

* Privacy first! This application works completely offline (at browser side) and does not send any data (except for downloading application files and importing ZPL labels). Label data is stored in your browser.
* Support for both Bluetooth and USB connections.
* Rich label editor. Label saving, import/export.
* Print preview. You can see how your label will look like after post-processing. Several post-processing algorithms are available.
* [Standalone apps](https://github.com/MultiMote/niimblue/releases):
    - Android (Capacitor based)
    - Windows (Tauri based, uses Edge backed)
* Most complete implementation of [NIIMBOT protocol](https://printers.niim.blue/interfacing/proto/).

You can see more complete list of implemented and planned features [on the Wiki](https://github.com/MultiMote/niimblue/wiki#features).

Demonstration video:

[![demo video](https://img.youtube.com/vi/u8QX-5e3W_A/mqdefault.jpg)](https://www.youtube.com/watch?v=u8QX-5e3W_A)

## Supported printers

There is no exact list of supported models in this project. This project aims to support the maximum number of models.

You can check [a list of tested models here](https://github.com/MultiMote/niimbluelib/issues/1). If you own other model, please write a comment.

If your (new) printer model does not print, please make a [packet dump](https://github.com/MultiMote/niimblue/wiki/Making-packet-capture) of print with official application.

> [!NOTE]
> If you have printing problems, try different print task versions in print preview dialog. Make if default by pressing "Lock" button.


## Supported browsers

Your browser must support Web Bluetooth API: [supported browsers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API#browser_compatibility).

For serial communication: [supported browsers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API#browser_compatibility).

Modern Chrome-based browsers should usually work.

In some systems you need to enable Chrome `Web Bluetooth` or `Experimental Web Platform Features` (navigate to `chrome://flags`).

Safari: while, this browser has no native `Web Bluetooth`, there is [beacio extension](https://beacio.com/) that enables Web Bluetooth under Safari.
Setup details available [here](https://beacio.com/setup).

## Images

Images may be outdated.

![ui](about/ui.png)

<details>
<summary>⬇ More images ⬇</summary>

Label properties:

![labels](about/labels.png)

Save/load menu:

![save_load](about/save_load.png)

Print preview dialog:

![print_preview](about/print_preview.png)

Post-processing:

![dither](about/dither.png)

Templating:

![templating](about/templating.png)

Dynamic data:

![batch](about/batch.png)

In real life:

![printed_b1](about/printed_b1.jpg)

![printed_d110](about/printed_d110.jpg)
</details>


## Development

### Launching development server

Skip steps you have done.

1. Install [git](https://git-scm.com)

2. Install [nodejs](https://nodejs.org)

3. Clone repository

    ```bash
    git clone https://github.com/MultiMote/niimblue.git
    ```

4. Install dependencies

    ```bash
    npm i
    ```

5. Run dev server

    Check code and run:

    ```bash
    npm run dev-check
    ```

    Or just run:

    ```bash
    npm run dev
    ```

### Deployment

Here are some options. HTTPS is required for non-localhost deployments.

#### Serving static files

To get static files run `npm run build` (result builds to `dist`) or download `niimblue-dist.zip` from [Releases](https://github.com/MultiMote/niimblue/releases).

#### Using Docker Image

Follow the instructions in the [wiki](https://github.com/MultiMote/niimblue/wiki/Running-own-instance-with-Docker).

### IDE setup

Project uses path aliases.

VSCode (settings.json):

```json
{
  "typescript.preferences.importModuleSpecifier": "non-relative",
  "javascript.preferences.importModuleSpecifier": "non-relative"
}
```

## Translations (click to contribute)

[![translation](https://weblate.mmote.ru/widget/niimblue/web/multi-auto.svg)](https://weblate.mmote.ru/engage/niimblue/)
