# MAX close confirmation

## Official API evidence (checked 2026-10-21)

The [MAX Bridge documentation](https://dev.max.ru/docs/webapps/bridge) describes `window.WebApp.enableClosingConfirmation()` as enabling a warning about losing entered data when closing a mini-app. It explicitly says methods in this category send a request to the MAX app one-way; the documentation does not define a native acknowledgement. The bridge therefore calls the feature-detected method once per `WebApp` object when `ready()` runs, before forwarding `ready()`. Missing or throwing methods do not block bridge startup. The reference lists no supported-version matrix for this method and makes no guarantee that behavior varies by launch entry point.

The documented `disableClosingConfirmation()` exists, but is intentionally not called: this app does not currently have a reliable unsaved-work lifecycle signal. The `disableVerticalSwipes` method observed in the CDN runtime is not documented in the official bridge reference and is not used; no swipe-prevention behavior is claimed. The SDK is loaded from MAX's CDN without an app-pinned version, so this integration makes no SDK-version or launch-mode guarantee.

## Native device acceptance

Run on a physical iPhone and Android device inside MAX. Repeat from a chat and from the tabbar when available, recording the observed entry point (including `default` or `tabbar` when `getLaunchContext()` is available). Record test date, device model, OS version, MAX app version, and entry point for every run. These are exploratory checks: the published API reference gives no iOS/Android version matrix for close confirmation, so support across OS/MAX versions remains unverified. Use synthetic data only.

1. Open the mini-app and test the visible X close control and the platform's close/back gesture. Confirm the expected native warning appears when MAX recognizes a close action.
2. Cancel the warning and verify the current screen remains usable. Trigger close again and accept the warning; confirm MAX closes the mini-app.
3. Reopen a fresh mini-app session and repeat cancel then accept, confirming the prompt is requested again in that new session.
4. Check feed scrolling, carousel swipes, comments, text input, and the app's back action to ensure normal interactions still work.

Record any absent warning, unexpected prompt, or interaction regression with the device/app details above. Browser tests can verify bridge setup and React lifecycle behavior but cannot validate native warning UI.

## Rollback test fixture note

The rollback regression's Selectel source fixture is pinned to accepted base `91f48719309e20456b1659092a1bf209c3aa3653`. That commit retains the expected `9afbb165…` production-runtime fingerprint and descends from the UI v4 rollback target. Pinning the fixture keeps the test's source tree stable when unrelated app runtime changes (such as this MAX bridge update) alter the current checkout fingerprint. The production rollback fingerprint and guards are unchanged; the existing test still mutates the fixture and asserts rejection before service changes.
