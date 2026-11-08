<div align="center">
  <h1>Facebook Zap Block</h1>
  <p>
    <img src="https://img.shields.io/badge/Facebook-Web-1877F2?style=flat&logo=facebook&logoColor=white" alt="Facebook" />
    <img src="https://img.shields.io/badge/Tampermonkey-Userscript_1.8.0-00485B?style=flat&logo=tampermonkey&logoColor=white" alt="Tampermonkey" />
    <img src="https://img.shields.io/badge/JavaScript-ES2019+-F7DF1E?style=flat&logo=javascript&logoColor=white" alt="JavaScript" />
  </p>
</div>

A userscript that adds a ⚡ button next to the author of every Facebook comment: one click and the profile is blocked in a background tab, without leaving the page you are reading. Built for anyone who moderates their own feed and is tired of the five-click block flow.

## Features

- **One-click block** – a ⚡ button is injected right after the author's name in every comment and reply.
- **Background automation** – the author's profile opens in a background tab, where the script clicks "…" → "Block" → "Confirm" on its own and then closes the tab.
- **Live status on the button** – ⚡ idle, ⏳ in progress, ✅ blocked, ⚠️ failed (on failure the tab stays open so you can check what happened).
- **Optional confirmation** – a `confirm()` dialog before every block to avoid accidental zaps.
- **Hides the blocked author's comments** – all comments by that author on the current page disappear immediately, including those loaded later while you scroll.
- **Lightning + ash effect** – the clicked comment gets struck by lightning, chars, dissolves into ash and collapses. It respects the system "reduce motion" setting and only plays for comments visible on screen.
- **Bilingual** – recognises the Facebook UI in Italian and English.
- **Robust profile detection** – handles vanity URLs, `profile.php?id=…` and group member links (`/groups/…/user/…`), and skips non-profile paths (pages, groups, events, photos, reels…).
- **Built-in diagnostics** – when a block fails, the background tab logs the buttons, menu items and dialog buttons it found, to make selector fixes easy.

## Tech Stack

- Plain JavaScript (ES2019+), no dependencies and no build step
- Userscript manager APIs: `GM_openInTab`, `GM_setValue`, `GM_deleteValue`, `GM_addValueChangeListener`
- Web Animations API for the incineration effect, inline SVG for the lightning bolt
- `MutationObserver` + `requestAnimationFrame` to process comments loaded dynamically

## Requirements

- A desktop browser (Chrome, Edge, Firefox, Brave…)
- A userscript manager that supports the `GM_*` APIs above, e.g. **Tampermonkey** or **Violentmonkey**
  (Greasemonkey 4 is not supported: it only exposes the asynchronous `GM.*` API and has no `GM_addValueChangeListener`)
- Being logged in to `https://www.facebook.com`

## Installation

1. Install Tampermonkey or Violentmonkey in your browser.
2. Create a new userscript in the manager's dashboard.
3. Paste the full content of the script (save it as e.g. `facebook-zap-block.user.js`) and save.
4. Make sure the script is enabled, then reload any Facebook page.
5. In Chromium-based browsers with Tampermonkey, you may need to enable "Allow user scripts" / Developer mode for the extension.

## Configuration

There is no `.env` file: options are constants at the top of the script, in the `Configurazione` section.

| Constant | Default | Description |
| --- | --- | --- |
| `REQUIRE_CONFIRMATION_BEFORE_BLOCK` | `true` | Ask for confirmation before blocking. |
| `HIDE_COMMENTS_AFTER_BLOCK` | `true` | Hide all comments of the blocked author from the current page. |
| `ENABLE_INCINERATION_EFFECT` | `true` | Play the lightning + ash animation when hiding comments. |
| `LIGHTNING_FLASH_DURATION_MS` | `380` | Duration of the lightning flash. |
| `CHARRING_DURATION_MS` | `200` | Duration of the charring phase. |
| `DISSOLVE_DURATION_MS` | `380` | Duration of the dissolve-into-ash phase. |
| `COLLAPSE_DURATION_MS` | `160` | Duration of the final collapse of the comment's space. |
| `ASH_PARTICLE_MAX_COUNT` | `140` | Maximum number of ash particles per comment. |
| `ASH_PARTICLE_MIN_LIFETIME_MS` / `ASH_PARTICLE_MAX_LIFETIME_MS` | `500` / `900` | Lifetime range of each ash particle. |
| `ELEMENT_WAIT_TIMEOUT_MS` | `15000` | Max wait for each element in the block flow. |
| `EXACT_LABEL_WAIT_TIMEOUT_MS` | `10000` | Max wait for the exactly-labelled "…" button before using the fallbacks. |
| `ELEMENT_POLL_INTERVAL_MS` | `300` | Polling interval while waiting for elements. |
| `PAUSE_AFTER_CONFIRM_MS` | `2000` | Delay before closing the background tab after a successful block. |

UI strings used to find Facebook's elements can be extended for other languages:

- `PROFILE_OPTIONS_BUTTON_LABELS` / `PROFILE_OPTIONS_PARTIAL_LABELS` – aria-labels of the "…" button in the profile header
- `BLOCK_MENU_ITEM_TEXTS` – text of the "Block" menu item
- `CONFIRM_BLOCK_BUTTON_TEXTS` – text of the confirm button in the block dialog
- `COMMENT_ARIA_LABEL_PREFIXES` – aria-label prefixes that identify comments and replies
- `NON_PROFILE_PATH_SEGMENTS` – first URL segments that are never profiles

## Available Scripts

None. The project is a single self-contained userscript: there is no package manager, build or test command.

## Testing

There are no automated tests. To verify the script manually:

1. Open a post with comments and check that a ⚡ appears next to each author.
2. Zap a test profile and watch the button go from ⏳ to ✅ (or ⚠️).
3. Open the browser DevTools console and filter by `[Zap Block]`:
   - in the original tab you'll see how many comments were hidden;
   - in the background profile tab (left open on failure) you'll see the step that failed and a table of the buttons, menu items and dialog buttons found, useful to update the label constants when Facebook changes its markup.

## Project Structure

```text
.
└── facebook-zap-block.user.js   # The whole userscript
```

Internally the script is organised in sections:

| Section | Responsibility |
| --- | --- |
| `Configurazione` | Feature flags, timings, UI labels, storage keys and marker attributes. |
| `Utility` | Waiting helpers, text normalisation, profile key/URL conversion (`id:…` / `user:…`). |
| `Scheda del profilo` | Runs in the background tab: finds "…" → "Block" → "Confirm" and writes the result to GM storage. |
| `Pagine con commenti` | Detects comments, injects the ⚡ button, opens the background tab and listens for the result. |
| `Effetto fulmine + cenere` | Overlay, lightning bolt, charring, ash particles and collapse animation. |
| `Avvio` | Chooses the mode from the initial URL: auto-block if it contains `#zap-block=…`, otherwise watch for comments. |

### How it works

1. Clicking ⚡ opens `https://www.facebook.com/<profile>#zap-block=<profileKey>` in an inactive tab.
2. The script, running at `document-start` in that tab, reads the hash before Facebook rewrites the URL and starts the block flow.
3. The outcome (`blocked` / `failed`) is saved with `GM_setValue` under `zapBlockResult:<profileKey>`.
4. The original tab, subscribed with `GM_addValueChangeListener`, updates the button, hides the author's comments and closes the background tab after `PAUSE_AFTER_CONFIRM_MS`.

## Deployment

To release a new version, bump `@version` in the userscript metadata block and update the script in your userscript manager. If you host the file somewhere public (e.g. a GitHub repo or Greasy Fork), you can add `@updateURL` / `@downloadURL` to the metadata so the manager picks up updates automatically.

> **Note:** the script depends on Facebook's markup and aria-labels, which change often. When blocking starts failing, check the diagnostics in the background tab's console and update the label constants accordingly.
