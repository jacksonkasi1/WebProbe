# Visual Audit Capabilities & To-Do List

## 🟢 Category 1: Mathematical DOM Analysis (Playwright / JavaScript)
*These are issues we can reliably detect using `getBoundingClientRect`, `getComputedStyle`, and DOM traversal without any AI cost.*

- [x] **Off-Screen Elements & Horizontal Scroll:** Elements extending beyond `window.innerWidth`.
- [x] **Element Overlap:** Sibling or floating text/containers intersecting mathematically without intentional `z-index` stacking.
- [x] **Touch Target Size Violations:** Buttons, links, or inputs smaller than Apple's HIG standard (44x44px).
- [ ] **Uncentered Modals/Popups:** `position: absolute` or `fixed` elements where the left and right distance to the viewport edges differ significantly.
- [ ] **Invisible Text:** Text where `color` exactly matches the `background-color`.
- [ ] **Container Text Overflow:** Text nodes where `scrollWidth` is greater than `clientWidth`, indicating text is spilling out of its box or causing a scrollbar inside a card.
- [ ] **Proximity Violations:** Interactive elements (like two buttons) placed too close together (e.g., < 8px gap).
- [ ] **Basic Contrast Ratio:** Comparing CSS `color` against CSS `background-color` (only works on solid backgrounds, not images).

## 🟣 Category 2: AI Vision Model Required (Gemini 1.5 Flash / GPT-4o)
*These are aesthetic or pixel-level issues that the DOM structure cannot understand. They require passing a screenshot to an AI Vision model.*

- [ ] **Cropped / Cut-off Content Inside Images:** Text embedded inside a PNG/JPG that is cut off (like the top card in your screenshot).
- [ ] **Poor Contrast on Background Images:** Text sitting on top of a background image or gradient where the CSS DOM cannot determine the pixel colors behind the text.
- [ ] **Aesthetic Imbalance:** Awkward white space, text wrapping too narrowly, or components looking visually unbalanced on one side.
- [ ] **Bad Image Cropping (`object-fit: cover`):** Images where the focal point (like a person's head) is chopped off by the container bounds.
- [ ] **Legibility of Fonts:** Fonts that render too thin, are heavily stylized, or become unreadable at smaller sizes despite passing technical contrast tests.
- [ ] **Icon / Content Mismatch:** Detecting if an icon visually clashes with or contradicts the button text.

## 🟡 Category 3: Hybrid (Math Flags it, AI Confirms it)
- [ ] **Broken Layout Structures:** Playwright flags elements that wrap unexpectedly (e.g., a 4-column grid turning into 1 column on tablet instead of 2). Vision model looks at it to determine if it's intentional or ugly.