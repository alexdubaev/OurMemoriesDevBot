# Demo asset provenance

No production/user media was read or copied. Three independent images generated with the
built-in image_gen tool for this task; entirely fictional people. Generated PNG masters stay
outside Git. Delivery copies in `webapp/src/dev/ui-v2/assets` were downscaled without cropping,
encoded WebP quality 82, max edge 1200px, metadata omitted. Each is below 180KB.
Dimensions, bytes and SHA256 are in the local asset manifest.

Prompts:

1. Portrait: “Create a photorealistic synthetic demo photograph for a private family album UI prototype. Entirely fictional people. Portrait vertical 3:4. A cheerful 3 year old girl with light brown curly hair wearing a muted oatmeal sweater, sitting on a rug and gently hugging a small shaggy terrier dog. Cozy contemporary home, natural window light, candid family snapshot, warm accurate natural colors, refined but authentic photograph. Full image edge to edge, no text, logos, borders, collage or UI. This is one standalone photograph.”
2. Family: “Create one photorealistic synthetic demo photograph for a family album prototype. All fictional people. Horizontal landscape 4:3. Mother, father and their 3 year old daughter walking together in a quiet grassy park in soft late afternoon sunlight. Daughter in the center holding both parents' hands laughing, natural candid moment, contemporary understated clothing in milk, sage and soft blue, believable joyful family photograph, warm natural colors. Edge to edge image. No text, logos, collage, border or UI.”
3. Painting: “Create one photorealistic synthetic demo photograph for a family album UI prototype. Fictional 3 year old girl with curly light brown hair wearing a cream cardigan is painting with watercolors at a kitchen table, focused and happy, colorful drawing of a little house and sun. Horizontal 4:3 composition, candid close photograph from a parent, natural window daylight, soft colors, genuine domestic moment. One standalone photo, edge to edge. No text, branding, collage, UI or border.”

Saved assets: `portrait.webp`, `family.webp`, `painting.webp`.
Video poster reuses painting, child avatar reuses portrait, carousel uses the same three assets.
Back/check are unchanged aliases of existing repository RGBA WebP icons, stored in the dev folder
because those names are not in production public assets. All other icons and official logo reuse
existing public repository files. No SVG, icon font, external font or icon dependency.
None of the Lab's imported local images are included in production output.
