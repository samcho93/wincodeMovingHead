// models/index.js — fixture model registry.
//
//  ADDING A MODEL
//   1. Copy the closest existing file in this folder to models/<id>.js and edit it from the model's manual.
//   2. Import it below and add it to LIST. Nothing else needs to change.
//
//  A model definition (default export) provides:
//   id, code, name, title, lcdTitle
//   heads       number of heads (default 1). Multi-head models return `heads: [targets…]` from decode() next to the
//               shared top-level fields; channel keys carry the head number as a suffix (tilt3, r5 …)
//   spec        { panRange, tiltRange, zoomMin, zoomMax, ledWhite[3], cd, focus[a,b], tempRise }
//   colors      [{ name, rgb }]            colour wheel slots, slot 0 = open
//   gobos       { fix:[names], rot:[names], draw(ctx, 'fix'|'rot', index, R) }   (['Open'] + draw:null when there are none)
//   ch          { key: 'Display name' }    every channel key used in modes
//   modes       { id: { id, label, channels:[keys in DMX order] } }, defaultMode
//   decode(v)   channel values → targets   { pan, tilt (0..1), panSpin (deg/s, continuous rotation), ptSpeed, dimmer, strobe{mode,hz}, zoom, focus, frost,
//                                            color{pos|null,spin}, gobo, rotGobo, goboRot, prismRot,
//                                            prismIndex (deg, instead of prismRot),
//                                            prism: true (3-facet) | { id, rings:[[count,radius]], line:count, scale, colors },
//                                            cmy[3], cto, blades[8], bladeRot, reset: false|true|'all'|'xy'|'effect',
//                                            rgb[3] + level (colour-mixing LEDs), ring{blocks|color,macro,strobe},
//                                            apply: {setting: value} (function channel) }
//                                           (leave out whatever the fixture does not have)
//   describe(key, value)                   short text for a channel value
//   features    { prism, gobos, cmy, cto, blades, scenes, ms, lamp, rgbl, ring }
//   noSignal    'manual' (Manual-menu values) | 'hold' (Data hold setting / post-reset state)
//   manualDefaults | sceneDefault, homeValues, resetHold (s), settings (model-specific defaults), offsets(S)
//   program     { base, steps[] }          built-in auto / sound program
//   panel       { type: 'buttons' | 'touch', menu?(helpers) → items, … }   which LCD/menu implementation to use (menu.js / menu-touch.js)
//   rdm         { modelId, description, software }
//   body        dimensions for the procedural 3D model (machine.js)
//   assumptions [strings]                  shown in the Guide tab
import lm1012b from './lm1012b.js';
import lm500wf from './lm500wf.js';
import tb5 from './tb5.js';
import apexpointe420 from './apexpointe420.js';

export const LIST = [lm1012b, lm500wf, tb5, apexpointe420];
export const MODELS = Object.fromEntries(LIST.map(m => [m.id, m]));
export const DEFAULT_MODEL = LIST[0].id;

/** Model chosen by ?model=, else the last one used, else the first in LIST */
export function currentModelId() {
  let id = new URLSearchParams(location.search).get('model');
  try { id = id || localStorage.getItem('wmh.model'); } catch (e) {}
  return MODELS[id] ? id : DEFAULT_MODEL;
}
export function rememberModel(id) { try { localStorage.setItem('wmh.model', id); } catch (e) {} }
