# Invited family demo implementation plan

Execution: superpowers:executing-plans. User selected demo plus detailed instructions, authorized implementation, and requires the actual product interface.
Spec: ../specs/2026-10-26-invited-family-demo.md

Architecture: FamilyGuide composes existing production presentation components with synthetic data and local callbacks. Only explanatory overlays have new styles. Shared album/gift presentations are used by both production and guide. No API/auth/ACL change. IncomingInvite owns entry/exit; FamilyGuideEntry reopens the same guide in Family overview.

1. Replace standalone demo mockup with FeedPresentation, MemoryCardPresentation, PhotoImage, MixedMediaViewer and actual AddSheetPanel/VoiceOrVideoPanel.
2. Extract existing album/gift presentation markup without changing live behavior; reuse it for local examples.
3. Provide collapsible sequential hints and detailed role-aware help in existing modal/sheet primitives. Preserve focus on close and explicit invitation acceptance.
4. Extend existing MAX family E2E: real component selectors, local reactions/photo viewer, album/gift examples, full add sheet, viewer help, retry, and no automatic acceptance/private prejoin history. Capture mobile and desktop screenshots.
5. Run STANDARD and webapp tests, independent Luna review of final diff, bounded fixes and final evidence.
6. Commit/push/PR/merge after gates. Deployment requires configured credentials and release gates; unavailable credentials are a blocker, not a request for redundant approval.

Validation: old mockup-only screenshots and temporary component tests are superseded by the user's correction and are not evidence for this implementation. Permanent coverage remains in the existing MAX audit. No classification policy or permanent harness configuration changed. Browser extension tooling is unavailable in this environment; use project Playwright with Chromium against local synthetic MAX/backend fixtures.
