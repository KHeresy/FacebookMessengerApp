# Changelog

All notable changes to this project will be documented in this file.

Note: If only the date suffix at the end of the version changes (e.g., v1.3.0.YYYYMMDD), it represents a release with only third-party package (Electron) updates.


## [v1.3.1.20260710] - 2026-07-10
- feat: Dynamically generate User-Agent and add User-Agent header when fetching updates from GitHub API

## [v1.3.0.20260707] - 2026-07-07
- build: Bump Electron to 43.0.0 (along with other dependency updates)

## [v1.3.0.20260425] - 2026-04-25
- feat: Add option to ignore current update version in update dialog

## [v1.2.2.20260327] - 2026-03-27
- fix: Resolve ERR_TOO_MANY_REDIRECTS (-310) load failure by clearing session storage and retrying

## [v1.2.1.20260317] - 2026-03-17
- fix: Resolve issue where copying entire message sometimes only copies the link

## [v1.2.0.20260311] - 2026-03-11
- feat: Change appId to `com.heresy.fbmessenger`
- feat: Add "Send Test Notification" option to Debug menu
- improve: Overall stability improvements

## [v1.1.2.20260303] - 2026-03-03
- fix: Fix message selection and copying behaviors

## [v1.1.1.20260302] - 2026-03-02
- improve: Decrease duplicate notifications and improve notification status check

## [v1.1.0.20260224] - 2026-02-24
- build: Bump Electron from 40.4.1 to 40.6.0

## [v1.1.0.20260222] - 2026-02-22
- main page URL changed to https://www.facebook.com/messages
- If redirected to Facebook homepage after login, please restart the app

## [v1.0.10.20260107] - 2026-01-07
- feat: improve context menu to distinguish between editable and non-editable areas
- feat: add "Copy Entire Message" option to context menu

## [v1.0.9-20251229] - 2025-12-29
- fix: fix shortcuts issue on macOS
- build: bump github actions dependencies

## [v1.0.8-20251223] - 2025-12-23
- feat: localize no-update-available message
- feat: move update settings to help menu and add manual check
- feat: use semver-compatible date version and add auto update check
- feat: add GitHub repository link to About dialog

## [v1.0.7] - 2025-12-19
- feat: upgrade to v1.0.7, add multi-language support (English/Traditional Chinese)
- feat: context menu enhancements (copy image, open link in browser)
- docs: update README with installation instructions for macOS

## [v1.0.6] - 2025-12-16
- feat: add more information to About dialog
- docs: fix typo in project name

## [v1.0.5] - 2025-12-15
- Initial release
