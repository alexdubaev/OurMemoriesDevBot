# Design QA — owner reference revision

Reference: owner attachment C9191000-2204-4380-A45F-D0885C60E783/1-Фото-1.jpg,
provided in this conversation. The private reference is not copied into the repository.
Implementation: FamilyHero, MemoryCard, BottomTabs and shared tokens under webapp/src/dev/ui-v2.
Screenshots: screenshots/feed-photo-320.png, feed-photo-390.png, feed-photo-430.png.

The supplied reference and a rendered 320px screenshot were inspected together in one tool output;
the 390px screenshot was also viewed at native capture size. The source is 720x1280 with OS chrome;
implementation captures are 320/390/430x844 CSS px without fake OS bars.

## Composition
Round child portrait and identity under centered brand; creamy rounded memory card, photographic
author avatar, large inset family image, caption/reactions and floating three-action navigation.
The generated demo photograph matches the tender father/daughter subject and warm natural lighting.
All controls and typography are live HTML/CSS. Existing icons are WebP; no SVG added.
One shared cream/sage palette. Alternate color options removed by the owner's latest request.

## Deliberate product differences
- Header illustration is pending owner-supplied covers; the empty slot is cream.
- Official existing memoLy logo is retained, including its existing dark-blue/pink coloring.
- Existing reaction choices remain; comments/bookmarks from the reference are not new features.
- A compact month/unread row retains the existing filter.
- Fictional child age comes from the fixture, not the reference photograph's subject.
- Body text and 44px controls remain readable; reference OS chrome is omitted.

## Findings and outcome
The 320px and 390px renderings show no clipping of identity, card or navigation.
The header swap is implemented as an independent raster background; it preserves component size
and semantic palette. Owner artwork must still be checked for cropping and contrast behind text.
Final visual acceptance is PENDING OWNER COVERS. Do not describe the empty header as a finished
match to the watercolor reference. Current screenshots show the actual interim implementation.
