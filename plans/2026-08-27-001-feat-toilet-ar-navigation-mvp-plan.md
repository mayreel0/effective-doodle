---
title: Toilet AR Navigation MVP - Plan
type: feat
date: 2026-08-27
topic: toilet-ar-navigation-mvp
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Toilet AR Navigation MVP - Plan

## Goal Capsule

- **Objective:** Define the MVP for a mobile-first AR restroom navigation product for cafes and restaurants whose restrooms are outside the immediate storefront or hard to explain verbally.
- **Product authority:** This plan owns the first customer and guest experience: merchant-recorded restroom routes, QR or in-store Wi-Fi entry, AR navigation, restroom password display, and activation quality gates.
- **Current scope:** The MVP targets cafes and restaurants, including cafes and restaurants inside shopping buildings or mixed-use commercial buildings.
- **Open blockers:** Implementation planning must validate platform feasibility for web/App Clip-style AR entry, native AR tracking, and Wi-Fi-based in-store eligibility on current iOS and Android versions.

## Product Contract

### Summary

Build a restroom navigation app where a cafe or restaurant owner records the path from a store QR location to the restroom by walking it once, marks key points along the way, tests the result in guest mode, and then exposes the route to guests through QR or in-store Wi-Fi search.
Guests get a 20-minute authenticated session that shows real-time AR floor guidance, key-point arrows, short instructions, and the restroom password from the start of the route.

### Problem Frame

Many small cafes and restaurants use restrooms that are outside the immediate store area, around a corner, upstairs, down a corridor, or behind a shared building door.
Staff often have to explain the same route repeatedly, and guests who are in a hurry can miss a turn, return to ask again, or fail to find the restroom quickly.
Public restroom-search products are not the right identity for this MVP because many merchants want to help their current guests without advertising restroom access to everyone nearby.

### Actors

- A1. **Merchant:** A cafe or restaurant owner or staff member who registers the store, records the restroom path, marks key points, enters restroom password information, tests the route, and activates guest access.
- A2. **Guest:** A current store visitor who enters through QR or in-store Wi-Fi search and follows AR guidance to the restroom.
- A3. **Service:** The backend and app experience that validates access, stores route/password metadata, issues a short guest session, and serves navigation data.

### Key Decisions

- **Primary target is cafes and restaurants.** This includes stores inside larger commercial buildings, but the active customer is the individual store rather than the whole building. Governs R1, R2.
- **Overall experience is full AR navigation.** Photo/text is not the main product; supporting instructions exist to recover from tracking uncertainty and confirm landmarks. Governs R14, R15, R16, R17.
- **Entry is private by default.** Guests enter by QR or in-store Wi-Fi search; whole-market public search is outside the MVP identity. Governs R4, R10, R11.
- **Wi-Fi is an entry qualification, not a continuous requirement.** Once the guest session opens, navigation continues even if the guest leaves the Wi-Fi range. Governs R12.
- **Restroom password is available early.** Authenticated guests can view the password near the start of guidance so they can memorize it before reaching the door. Governs R8, R13.
- **Merchant testing gates activation.** Merchant-recorded routes do not become guest-visible until the merchant completes a guest-mode test. Governs R9.

### Requirements

**Merchant Setup**

- R1. The product must let a cafe or restaurant merchant register a store and create at least one restroom route for that store.
- R2. The product must support stores whose restroom path leaves the storefront, enters a shared building area, changes floors, or passes through a shared corridor.
- R3. The merchant must be able to generate or associate a QR entry point for the store route.
- R4. The merchant must be able to enable in-store Wi-Fi search as a private backup entry path without making the store available in public search.

**Route Recording**

- R5. The merchant must record the restroom path by starting at the QR location and physically walking to the restroom while the app tracks the route.
- R6. During recording, the merchant must be able to mark key points such as corners, stairs, elevators, doors, and the password-entry location.
- R7. Complex routes may support additional intermediate QR checkpoints later, but the MVP starts from one store QR entry point.
- R8. The merchant must be able to enter and edit the restroom password displayed to guests; the app does not control or change the physical password device.
- R9. Route activation must require a guest-mode test pass before QR or Wi-Fi entry can expose the route to guests.

**Guest Entry and Session**

- R10. Guests must enter through a store QR code or through in-store Wi-Fi search for registered stores that enabled it.
- R11. Public search that exposes stores to anyone nearby must not be part of the MVP.
- R12. After valid QR or Wi-Fi entry, the guest must receive a 20-minute session that can continue after Wi-Fi disconnects.
- R13. The guest must be able to view the restroom password near the start of the session through a clear password-view action.

**AR Guidance**

- R14. The primary guest guidance must be real-time AR navigation over the live camera view.
- R15. The AR view must show a floor path during normal travel and larger arrows with short text at key points.
- R16. The guidance must help with direction at confusing areas and final confirmation at the restroom rather than promising centimeter-level positioning.
- R17. If AR tracking becomes unreliable, the experience must provide recovery guidance or supporting landmark information without ending the session.

### Key Flows

- F1. Merchant records and activates a route
  - **Trigger:** A merchant wants to make restroom guidance available for a store.
  - **Actors:** A1, A3.
  - **Steps:** The merchant registers the store, sets the QR entry location, starts route recording, walks to the restroom, marks key points, enters the password, runs guest-mode testing, and activates the route after the test passes.
  - **Outcome:** The route becomes available through QR and any enabled in-store Wi-Fi search entry.
  - **Covers:** R1, R3, R5, R6, R8, R9.

- F2. Guest enters through QR
  - **Trigger:** A guest scans the store QR code.
  - **Actors:** A2, A3.
  - **Steps:** The service validates the route, opens a 20-minute guest session, shows the password-view action, and starts AR guidance from the QR location.
  - **Outcome:** The guest follows live AR navigation to the restroom even if network conditions change during the walk.
  - **Covers:** R10, R12, R13, R14, R15.

- F3. Guest enters through in-store Wi-Fi search
  - **Trigger:** A guest is on the store Wi-Fi and searches for the store in the app or web entry surface.
  - **Actors:** A2, A3.
  - **Steps:** The service confirms the in-store Wi-Fi eligibility, limits results to matching registered stores, opens a 20-minute guest session, and starts the same AR guidance used by QR entry.
  - **Outcome:** The guest can start guidance without scanning QR, while the store remains hidden from public search.
  - **Covers:** R4, R10, R11, R12.

- F4. Guest recovers from tracking uncertainty
  - **Trigger:** The AR session loses reliable tracking because of lighting, low visual detail, fast phone movement, or temporary camera interruption.
  - **Actors:** A2, A3.
  - **Steps:** The app prompts the guest to slowly scan the surroundings, uses marked key points and landmark text to re-orient the guest, and keeps the session active.
  - **Outcome:** The guest can continue guidance without restarting or returning to the store.
  - **Covers:** R6, R17.

### Acceptance Examples

- AE1. QR entry starts a private guidance session
  - **Covers:** R10, R12, R13, R14.
  - **Given:** A merchant has activated a tested route.
  - **When:** A guest scans the store QR code.
  - **Then:** The guest receives a 20-minute session, can view the password, and sees AR guidance from the QR location.

- AE2. Wi-Fi entry survives leaving the store signal
  - **Covers:** R4, R12.
  - **Given:** A guest opened guidance through in-store Wi-Fi search.
  - **When:** The guest walks outside Wi-Fi range while following the route.
  - **Then:** The current session remains available until its 20-minute expiry.

- AE3. Public search does not expose the store
  - **Covers:** R11.
  - **Given:** A registered store has not enabled any public listing.
  - **When:** A nearby non-guest searches without QR or eligible Wi-Fi context.
  - **Then:** The store route and password are not shown.

- AE4. Untested merchant route is blocked
  - **Covers:** R9.
  - **Given:** A merchant recorded a route but has not passed guest-mode testing.
  - **When:** The merchant tries to activate QR or Wi-Fi entry.
  - **Then:** The product keeps the route unavailable to guests and asks the merchant to complete testing.

### Success Criteria

- Guests can start guidance quickly from QR without account creation or unnecessary setup.
- A merchant can record, test, and activate a simple restroom path without operator assistance.
- A valid guest can see the restroom password early enough to memorize it before reaching the door.
- The product does not behave like a public restroom discovery app in the MVP.
- AR tracking uncertainty does not strand the guest without fallback context.

### Scope Boundaries

**Deferred for later**

- Paid pricing, subscription packaging, and merchant billing.
- Public restroom discovery or nearby restroom search.
- Multiple intermediate QR checkpoints for complex buildings.
- Operator-assisted route setup or admin approval workflow.
- Direct integration with electronic door locks or password devices.

**Outside this product's MVP identity**

- A general map of all available restrooms near the user.
- A public listing that encourages non-customers to visit a store only for restroom access.
- A product that depends on continuous Wi-Fi connectivity during the whole restroom trip.

### Dependencies / Assumptions

- The product assumes guests are current store visitors who can access the QR code or the store Wi-Fi.
- The product assumes merchants can manually enter the restroom password shown to guests and update it when the physical password changes.
- Planning must verify current iOS and Android support for no-install entry, App Clip or web entry surfaces, AR tracking behavior, and Wi-Fi-based eligibility checks.
- Planning must choose a platform approach that supports the full AR navigation promise without requiring a guest to install an app during an urgent restroom trip.

### Outstanding Questions

**Resolve Before Planning**

- What exact platform path will provide "installation-free" entry while preserving usable AR navigation on iOS and Android?
- How will in-store Wi-Fi eligibility be checked without creating confusing permission prompts for urgent guests?
- What minimum route length and complexity should the first prototype support?

**Deferred to Planning**

- Which AR framework, web/native split, and route-data model best fit the MVP.
- How merchant route testing should score a pass or fail.
- What visual design language should be used for floor paths, arrows, password display, and recovery prompts.

### Sources / Research

- Apple ARKit world tracking documentation describes camera and motion-sensor based world tracking and notes that lighting, visual detail, and motion affect tracking quality: https://developer.apple.com/documentation/arkit/understanding-world-tracking
- Google ARCore fundamentals describe SLAM-based motion tracking using camera feature points and inertial measurements: https://developers.google.com/ar/develop/fundamentals
- Apple Wi-Fi information documentation and Android Wi-Fi permission documentation indicate that current Wi-Fi information is permission- and capability-gated, so Wi-Fi-based eligibility must be planned carefully: https://developer.apple.com/documentation/SystemConfiguration/CNCopyCurrentNetworkInfo and https://developer.android.com/develop/connectivity/wifi/wifi-permissions
