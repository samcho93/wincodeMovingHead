You are adding one new fixture model to the Wincode moving head simulator in this repository.
Read `CLAUDE.md` first: its rules apply (English only, one file per model, no model-specific branches in the core,
everything the manual does not state goes into `assumptions`).

## Inputs

- Product page: {{URL}}
- User manual: {{MANUAL}}
- Mechanical drawing (optional): {{DRAWING}}
- Notes from the user: {{NOTES}}
- Model id to use: {{ID}}
- Scratch folder for this job: {{WORK}}

## Steps

1. **Read the manual.** If it is a PDF run `python tools/pdf-pages.py <manual.pdf> {{WORK}}/manual` — it writes
   `text.txt` and one PNG per page. A scanned manual has almost no text: read the page images instead.
   Read every page of the DMX channel tables and of the menu / display chapter. Do not guess a channel you did not read.
2. **Read the product page** with WebFetch: zoom range, pan / tilt range, light source, effects, dimensions, weight.
   If the page and the manual disagree, the manual wins; note the difference in `assumptions`.
3. **Drawing.** If one is given, read it (render a PDF with `tools/pdf-pages.py` into `{{WORK}}/drawing`; PNG / JPG
   can be read directly; DXF / SVG are text). Take the overall width, depth and height and as many body dimensions as it
   shows (base height, yoke arm height, tilt axis height, head length and diameter, lens diameter, display and button
   positions) and use them for `body`. Without a drawing, use the dimensions from the manual or the product page and
   estimate the proportions from the product photos — and say so in `assumptions`.
4. **Study the contract and the closest existing model.** The contract is at the top of `web/js/models/index.js`.
   Existing models: `lm1012b.js` (single head, colour and gobo wheels, prism, button menu), `lm500wf.js` (single head,
   CMY, framing blades, touch panel + encoder, scenes), `apexpointe420.js` (two prism wheels with
   prism shapes, CMY + colour wheel + virtual colour presets, continuous pan via `panSpin`), `tb5.js` (five heads on a bar, RGBL, pixel rings, generated
   channel modes, own menu tree). Copy the closest one and change it.
   The `program` steps you write are also what the stage editor's showcase plays for this model (one look per step),
   so make them show the fixture's main features: colours, gobos, prism, zoom, movement.
   The 3D body is described by `body` (read the header of `web/js/machine.js`): `yoke` for the U-shaped yoke, `head` loft
   sections (rounded boxes and circles; repeat a `y` to make a step), and the optional `rings`, `ribs`, `vents`, `hood`, `sink`, `logo` (lettering as it appears in the photos),
   `base.handle` and `controls` ('cross5', 'col4' or 'encoder'). Shape it after the manual's drawing and the product
   photos, not after another model.
5. **Write `web/js/models/<id>.js`** and register it in `web/js/models/index.js` (one import, one entry in `LIST`).
   - Every channel mode in the manual, in DMX order, with the manual's channel names.
   - `decode()` must follow the manual's value ranges exactly; `describe()` gives a short label for each value.
   - `body` in metres. `style`: `box` (moulded head), `round` (cylindrical head) or `bar` (several heads on a bar).
   - `panel.type`: `buttons` (LCD + keys; supply `panel.menu` with the menu tree from the manual) or `touch`.
   - `assumptions`: one sentence per thing you had to decide yourself.
6. **Validate**: run `node tools/check-model.mjs <id>` and fix the model until it prints `OK`.
   Also run `node tools/check-model.mjs` once to make sure the other models still pass.

## Limits

- Change only `web/js/models/<id>.js` and `web/js/models/index.js`. Do not edit the simulator core, the editor,
  the server or the tools. If the fixture needs something the core cannot do yet (a new kind of effect, a new kind of
  front panel, a body shape none of the three styles can approximate), model what is possible, list what is missing
  in `assumptions`, and say so clearly in your final message.
- Do not commit, push, install packages or touch files outside this repository.
- Do not copy the manual's text or pictures into the repository.

## Final message

End with a short summary: the model id and name, the channel modes with their channel counts, where the body
dimensions came from (drawing / manual / estimate), the validator result, and the list of assumptions.
