# Nyx art pipeline (v1)

How Nyx's screen art was made: from a 2D concept to a rigged 3D model, to a set of animated sprite sheets the frontend plays. Everything after the model is a script, so the look can be reproduced, changed and re-rendered without anyone drawing anything.

This doc covers the **screens** (Helios, Selene, the laptop). The stick has its own 48x48 pixel sprite and is not part of this pipeline (see PLAN.md, "Art per device").

Status: **v1 locked (Oct 9, 2026).** Clips: idle, sleep, eat, play. Eight eye moods, day and night.

---

## 1. Overview

```
2D concept art (ChatGPT)          the design: what she looks like
        │
clay reference views (ChatGPT)    front 3/4, side, back: shape only, no glow
        │
Tripo (image-to-3D, Pro)          multi-view model + quadruped auto-rig -> GLB
        │
tools/blender/nyxScene.py         the look: materials, eyes, crown, stardust, outline, glow
tools/blender/renderClip.py       the animation: poses per clip, body + eye passes
tools/blender/renderAll.sh        renders every clip and pass
        │
tools/blender/packSprites.py      sprite sheets (.webp) + nyx.json manifest
        │
frontend/src/assets/nyx/          what the frontend loads
```

The rule that made this work: **lock the look on stills first, animate second.** A still takes 5-30 s to render; the full animation set takes ~45 min. Every look change was judged on a still, against crops of the 2D art.

---

## 2. Why this approach

| Option | Verdict |
|---|---|
| Frame-by-frame drawing | Rejected. The most art per second of animation, and image models drift between frames. |
| Rigging tools (Rive, Spine) | Rejected. Built around a visual editor; an AI can't drive them, so Oz would have to learn the tool. |
| 2D puppet in canvas (layers moved by code) | Kept as the fallback. Cheap, but limited to small motions of the poses that exist as art. |
| **3D model rendered to sprite sheets** | **Chosen.** Everything in Blender is scriptable, so a model can drive the whole pipeline. Frames are perfectly consistent (same model, same camera). The screens only flip pre-rendered images, which is cheap on Selene's chip. |

Costs of the choice: the model itself (bought in, see section 3), a render step (~45 min for all clips), and sprite sheets that take memory when decoded (section 11).

---

## 3. The model

### 3.1 Design reference

The look was settled in ChatGPT image generation over several rounds (see PLAN.md, "Nyx's look"). The final sheet, `assets/source/nyxConceptDayNight.png`, has the DAY and NIGHT versions and face close-ups for four moods. It's the reference for everything below, including the traced eye shapes.

### 3.2 Clay views (input for image-to-3D)

Image-to-3D tools reconstruct *shape*. A dark cat on a dark background with stars and glow is hard to read as geometry, and the glow and stars aren't geometry anyway (they become materials later). So the input was the same cat as plain gray clay, three views, in ChatGPT:

> Using this exact cat design (the DAY version, sitting), create a 3D-modeling reference: the same cat as a smooth sculpted figure in plain matte gray clay. Same pose, same proportions (slim neck, tall pointed ears, long tail curving around the side), but with no stars, no glow, no crown and no stardust. Neutral studio lighting, plain white background. Show three views side by side, the same size: front three-quarter view, exact side view (profile), and back view.

Check the views agree with each other before using them. A second attempt had the tail on the same screen side in the front and back views, which is physically impossible; contradictory views give a confused model.

### 3.3 Tripo settings (tripo3d.ai, Pro plan)

- **Multi-view** input: front = the 3/4 view, left = the side view (she faces screen-left, so that's her left side), back = the back view. Right left empty (the tool mirrors).
- **HD Model**, Ultra Mesh Quality on, **Topology: Quad**, **Polycount ~50,000**. Quads deform evenly when bones bend; 2M polys would make rigging and rendering slow for detail nobody sees.
- **Texture: off**, 8K texture off. Her surface is replaced by materials in Blender.
- **Generate in Parts: off.** One continuous mesh deforms better; separate parts open gaps at joints.
- Privacy: Private. The Pro plan also matters for licensing: free-plan models are public (CC BY 4.0) and Tripo keeps broad rights.
- **Rig:** the skeleton presets (Mixamo, UE5...) are human standards; pick **Other**, which rigs her as a quadruped.
- Export: **GLB with the skeleton.** Saved as `assets/source/nyxTripo.glb`.

The first, single-image run had a good front view but a flat, mask-like profile. The multi-view run fixed the profile, which matters because she'll be seen from the side when she moves between screens (M5).

### 3.4 What's in the GLB

- One mesh: ~45.5k vertices, 91k triangles (the quad option still came out triangulated), no UVs, not watertight (40 open edges). Hollow inside.
- One armature, **45 bones**. The useful ones:

| Bone | Role |
|---|---|
| `tripo::Spine_0..2` | lower back to chest (`Spine_1` breathing, `Spine_2` leaning forward) |
| `tripo::Head_0` | neck/head turn and nod (most head motion goes here) |
| `tripo::Head_2` | the head itself: eyes, crown and mouth are parented to it |
| `tripo::Head_3`, `bone_9` | the two ears |
| `tripo::Tail_0..8`, `bone_35` | tail, base to tip |
| `bone_14..25`, `bone_36..40` | legs (unreliable, see 3.5) |

- An extra `Icosphere` object comes along in the GLB; the scene script deletes it.

### 3.5 Known flaws of the model

- **Rigged from a sitting pose.** Auto-riggers want a neutral standing pose; the leg bones exist, but bending them gives broken shapes. Standing and walking need a second, standing model (section 13).
- **The tail bends in the image plane**, so a big sway would swing it across her body. Tail motion stays small.
- **Cheek tufts are crumpled** in profile, and the **eye sockets are sculpted** (raised lids, recessed eyes). Both caused visual problems that are handled in the scene script (sections 5.6 and 6).
- **Bone rolls are arbitrary.** A bone's local X axis is not "nod". Rotations are done in armature space instead (section 7.2).

---

## 4. Environment

- **Blender as a Python module:** `pip install bpy` (each bpy release has wheels for one Python version; here bpy 5.2.2 on Python 3.13, so use the Python that matches). Everything runs headless, no window. Alternatively, with the Blender app: `blender -b --python renderClip.py -- <args>`; the scripts read arguments after `--` either way.
- **Pillow** (`pip install Pillow`) for the still composites, eye tracing and packing.
- **ffmpeg** on the PATH, for the preview videos only.
- Rendering is **Cycles on CPU**. Timings below are from a 2-core machine; more cores scale roughly linearly.

Scripts live in `tools/blender/` and find the model at `assets/source/nyxTripo.glb` relative to themselves. Output goes to `tools/blender/out/` (gitignored).

| Script | What it does |
|---|---|
| `nyxScene.py` | Builds the whole scene: imports the GLB, materials, eyes, crown, effects, camera, glow, outline. Imported by the others. |
| `renderStill.py` | One still: `python renderStill.py out/look.png day full` (or `night`, or `face` for an eye close-up). Writes the transparent PNG and a `_dark` composite. |
| `renderClip.py` | One clip, one pass, a frame range: `python renderClip.py idle body 0 95 out/anim/idle/body`. |
| `renderAll.sh` | Every clip and pass in order (~45 min). Skips frames already on disk, so it can be restarted. |
| `packSprites.py` | Renders -> sprite sheets + `nyx.json`, plus preview videos in `out/previews/`. |
| `traceEyes.py` | Re-traces the eye shapes from the concept art (section 5.4). |

---

## 5. The look (`nyxScene.py`)

### 5.1 Render setup

- Cycles, CPU, **24 samples**, no denoiser, **transparent film** (her background is alpha 0).
- Color management **Standard** (not Filmic/AgX): the colors were matched by hex values to the 2D art, so no tone mapping.
- Base size **480x560**; stills for review at 2x.
- **No lights at all.** Every surface is *emissive*: it shines its own color, like the 2D illustration. Shading comes from the material, not from lamps.
- **Orthographic camera** (no perspective), body turned ~18° from the camera (`add_camera(yaw_deg=-18)`), and the head turned back toward the camera by -22° on `Head_0`. That gives the 2D composition: face looking at you, body three-quarters, tail visible.

### 5.2 Body material (`night_material`)

All patterns are mapped on a **`rest_pos`** attribute (each vertex's position in the rest pose), so stars and nebula stick to her skin when bones move instead of sliding across her.

From the bottom layer up:

1. **Volume:** near-black at the center, deep navy only toward the silhouette (`000002` -> `01020c` -> `040a35`, driven by the facing ratio). These values were *measured* from the 2D head crop; the early versions were several times too bright.
2. **Chest nebula:** distorted noise through a narrow band of colors sampled from the 2D chest: navy -> electric blue `0025a8` -> `2a2ef0` -> violet `884bdd` -> pale `c8c4ff`. A low-frequency mask places it on her front, around chest height.
3. **Tail nebula:** a separate noise stretched *along* the tail (its coordinate is the `tailness` attribute, see below), so the streaks flow from base to tip instead of the body's blotches. Richer toward the tip, plus a violet glow (`5a3cd8`) building up near the tip.
4. **Stars:** two Voronoi layers with hard edges (constant interpolation): many small points and a few bigger ones, white `fff6ff`. Soft-edged stars looked like smudges at this size. More stars toward the tail tip.
5. **Edge glow:** a deep blue (`3d4cf0`) at grazing angles, turned off around the eyes (`eye_zone`, section 5.6).
6. **Alpha:** back faces are always transparent (the mesh is hollow; seeing its inside looked broken), and the last part of the tail fades out raggedly.

Per-vertex attributes computed from the tail bones' skin weights:
- **`tailness`**: 0 on the body, rising along the tail to 1 at the tip.
- **`tip`**: only the end of the tail (weights on `Tail_5..8`, `bone_35`).
- **`eye_zone`**: 1 within ~9.5 cm of each eye center, fading to 0 at 11.5 cm.

### 5.3 Effects around her

- **Crown:** three cream-gold 4-point sparkles (`ffffff` core -> `fff1cf` -> `f3c873` -> `c9893a` tips) with soft halos, parented to `Head_2`, always facing the camera. They twinkle (slow scale pulse) and can be dimmed (`set_crown_glow`, used while sleeping).
- **Tail tip:** a big white-blue star sitting on the tip, a cloud of ~55 tiny dots, 9 medium and 3 big sparkles, 6 small purple orbs and 6 soft nebula wisps, all parented to the last tail bone. Each drifts away from the tip and fades on its own timer, so the tail keeps dissolving into stars.
- **Body sparkles:** 10 crisp 4-point sparkles placed on her visible surface, parented to the nearest bone, twinkling.
- **Food** (eat clip): 18 golden sparkles that rise from below and drift into a `Mouth` empty parented to the head.
- **Toy** (play clip): a small white-blue star with a halo.

All effect timing is a function of the loop phase `t` in [0, 1) (`animate_extras`), so every clip loops seamlessly.

### 5.4 Eyes

The eyes are the most-iterated part (v6 to v13). Each eye is **its own flat mesh in front of the head**, not part of the model's surface.

- **Shape: traced from the 2D art**, not a formula. `traceEyes.py` flood-fills each eye in the concept close-up starting from the pupil, takes the outline, normalises it and stores 64 points per eye in `EYE_OUTLINES`. Both eyes are traced separately. Formula shapes (symmetric almonds, tilted almonds, 28° and 38° tilts) always got one part wrong: the real shape has a high rounded arch on the outer top, a bowl bottom, and a pointed inner corner that dips toward the nose.
- **Placement:** `EYE_POINTS` are the sculpted socket centers, found by casting rays from the camera onto the mesh. Each eye faces a blend of the face's front, the socket normal and the camera, and is moved 2.5 cm *toward the camera*. With an orthographic camera that doesn't move it on screen at all; it only lifts it clear of the recessed socket, which was hiding part of the near eye.
- **Iris** (`eye_material`), from top to bottom: navy under the lid, electric blue, a pale blue crescent at the bottom (`b8e4ff`), violet-pink on the outer lower side (`c07cf2`), a blue glow behind the base of the pupil, nebula swirls and small cyan-white stars.
- **Pupil:** a vertical lens shape, pointed top and bottom, width controlled by `pupil` (0.2 = about a fifth of the eye's width at its widest).
  - **Day:** near-black `01010a`.
  - **Night:** a warm cream core fading to amber at its edge, the crown's color. It's an emission brighter than 1, so it blooms slightly.
- **Edge:** a thin dark-navy line (`0a1060`) drawn by the eye's own material near its outline. (An earlier border mesh, a scaled copy of the eye, stuck out as a hook at the pointed corner; don't bring it back.)
- **Lids** (for moods and blinks): the material darkens everything above a lid line. Controls:
  - `lid`: 0 open .. 1 closed. Fully closed shows only a soft curved lavender line.
  - `lid_angle`: > 0 lowers the inner side (grumpy V), < 0 lowers the outer side (sad droop).
  - The lid line bends into an arc as it closes.

Script API: `set_night_eyes(on)`, `set_eyes(lid, lid_angle, pupil)`.

### 5.5 Glow (compositor)

A Bloom glare at **threshold 0.85**, so only truly bright things glow (stars, crown, tip star, night pupils); a lower threshold lifted her dark body. Because the glow lands on transparent pixels, the compositor gives every pixel an **alpha equal to its brightness** (max of R, G, B and the original alpha). Without that, the glow disappears when the PNG is drawn over anything.

### 5.6 Outline (Freestyle)

The 2D art's thin light rim is drawn with Blender's line renderer, in `b4c0ff`, 1.25 px. Two line sets:

1. **Outer silhouette** (external contour): always drawn, never filtered, so it's one unbroken line.
2. **Inner lines** (legs in front of the body, ears): only lines at least 34 px long, so small bumps on the mesh don't become stray dashes on her chest.

Faces flagged in the `freestyle_face` attribute (Blender 5's face marks) get no lines: the dissolving tail end, and everything within ~8.8 cm of the eyes, so the sculpted socket edges don't draw a second eye shape around the real one.

### 5.7 Palette

| Use | Hex |
|---|---|
| Body center / edge | `000002` / `040a35` |
| Nebula blues | `000a3a`, `0025a8`, `2a2ef0` |
| Nebula violet / highlight | `884bdd` / `c8c4ff` |
| Stars | `fff6ff` |
| Edge glow | `3d4cf0` |
| Outline | `b4c0ff` |
| Crown core / gold / tips | `fff1cf` / `f3c873` / `c9893a` |
| Iris top / middle / bottom | `060a50` / `2c3ce8` / `b8e4ff` |
| Iris violet | `c07cf2` |
| Eye edge | `0a1060` |
| Screen background (previews) | `05060a` |

---

## 6. Gotchas we hit (read before changing things)

Each of these cost a round or more:

- **Judge against the reference, numerically.** "Too bright" and "the purple is bluish" were settled by sampling pixel colors from crops of the 2D art and from the render, not by eye.
- **Holes in the tail showed the hollow mesh.** Breaking the tail into chunks exposed the inside. Back faces are now always transparent, and the tail fades instead of breaking up.
- **Freestyle draws every bump.** Short dashes on the chest were mesh bumps outlined. Hence the two line sets (5.6). Filtering short lines on the outer silhouette too made it break into gaps.
- **Eye problems, in order:** round discs (wrong shape), eyes sinking into the head (sockets face sideways), a black patch in the near eye (hidden by the face edge: fixed by the move toward the camera), diagonal pupils (the tilt rotated them: only the outline is tilted now), a stray line at the inner corner (two causes stacked: the border mesh hook and the lid edge catching edge glow).
- **Debug by hiding one thing at a time.** The last eye-corner line was found by rendering the eye close-up with the body hidden, then the eye border hidden, then outlines off.
- **Blender 5 API changes:** the compositor is `scene.compositing_node_group` (a node group with a Group Output), not `scene.node_tree`; Glare type and quality are menu *inputs*; face marks are the `freestyle_face` attribute, not `polygon.use_freestyle_mark`.
- **Call `view_layer.update()` before reading `matrix_world`** of an object you just moved (e.g. before parenting to a bone), or you get the old position.
- **Create the camera before the eyes**; eye placement uses the camera direction.

---

## 7. Animation (`renderClip.py`)

### 7.1 Clips

All clips loop seamlessly: every motion is a sine of the loop phase, with whole numbers of cycles per loop. Rendered at **12 fps**; the frontend crossfades between frames, which looks like 24 fps.

| Clip | Frames | Length | What happens |
|---|---|---|---|
| `idle` | 96 | 8 s | Two breaths, slow head drift and small nod, tail sway travelling to the tip, one ear flick, two blinks. |
| `sleep` | 96 | 8 s | Head lowered, slow deep breaths, lazy tail, ears relaxed, crown dimmed to ~35% with a slow glow. |
| `eat` | 48 | 4 s | Three nibbles in step with the stream of golden starlight flowing into her mouth, happy tail. |
| `play` | 48 | 4 s | The star toy loops a figure-eight in front of her; she follows it with her head, ears perked, lively tail, one blink. |

Tempo rule from the review: the first idle (2 s loop, everything fast) looked like she was "tweaking". Calm means long loops, small angles and few events.

### 7.2 Rotating bones

`set_rot(bone, pitch, yaw, side)` rotates in **armature space** and converts to the bone's local space: pitch about the armature's X (nod forward/back), side about Y (lean), yaw about the bone's own length axis (turn). This is needed because the auto-rig's bone rolls are arbitrary; a local X rotation on `Head_0` turned her head sideways instead of nodding. Positive pitch = forward/down.

### 7.3 Eye states

| State | `lid` | `lid_angle` | `pupil` |
|---|---|---|---|
| calm | 0 | 0 | 0.20 |
| happy | 0 | 0 | 0.34 |
| sad | 0.34 | -0.45 | 0.24 |
| grumpy | 0.38 | 0.50 | 0.09 |
| content | 0.30 | 0 | 0.22 |
| sleepy | 0.50 | 0 | 0.20 |
| closed | 1.0 | 0 | 0.20 |

Blinks raise `lid` briefly over whatever state is active.

### 7.4 Layered passes

Rendering the whole cat once per mood and day/night would be ~10x the work. Instead each clip is rendered as:

- **Body pass:** everything except the eyes. One per clip.
- **Eye passes:** only the eyes, with the body set as a **holdout** (it's invisible but still blocks what's behind it), so the head still hides exactly what it should. Rendered with a **render border** around the eyes only, which makes them ~3x faster; the frame stays full size, so it lines up with the body pass.

The frontend draws the eye layer over the body (section 10).

Eye passes rendered per clip:

| Clip | Eye passes |
|---|---|
| idle | calm, happy, sad, grumpy, each day and night (8) |
| sleep | closed (day only; a closed lid looks the same at night) |
| eat | content, day and night |
| play | happy, day and night |

---

## 8. Rendering

```
cd tools/blender
sh renderAll.sh          # or PYTHON=py sh renderAll.sh on Windows
```

- Body pass ~5.2 s/frame, eye pass ~1.2 s/frame on 2 cores. All clips: 288 body frames + 1056 eye frames, **~45 minutes**.
- Output: `out/anim/<clip>/<pass>/f000.png ...`, transparent PNGs at 480x560.
- Frames already on disk are skipped. To re-render something, delete its folder.

To check the look without animating: `python renderStill.py out/look.png day full` and `... night face`.

---

## 9. Packing (`packSprites.py`)

```
python packSprites.py out/anim ../../frontend/src/assets/nyx
```

- **One shared crop for every clip** (the union of every body frame's visible area, plus 4 px), so all clips have the same frame size and anchor and switching clips never makes her jump. v1: **453x531**.
- **Body sheets:** 12 columns, WebP quality 90. About 4 MB for an 8 s clip, 2 MB for a 4 s clip.
- **Eye sheets:** cropped to the union of that clip's eye passes, with the offset recorded in the manifest. About 0.05-0.2 MB each.
- **Previews** (not shipped): `out/previews/*.mp4`, body + eyes composited on the screen color, crossfaded at 24 fps, two loops, 2x size; and `moods.png` with every idle eye state.

### Manifest (`nyx.json`)

```json
{
  "frameWidth": 453,
  "frameHeight": 531,
  "fps": 12,
  "columns": 12,
  "crossfade": true,
  "clips": {
    "idle": {
      "frames": 96,
      "sheet": "idle.webp",
      "eyes": {
        "calm_day": { "sheet": "idle_eyes_calm_day.webp", "x": 255, "y": 213, "width": 133, "height": 77 }
      }
    }
  }
}
```

Frame `i` of a sheet is at column `i % columns`, row `floor(i / columns)`. Eye frames use the same index, at their own size, and are drawn at `(x, y)` inside the body frame.

---

## 10. Playing it in the frontend

- **Frame:** `i = floor(seconds * fps) % frames`. **Crossfade:** draw frame `i`, then frame `i + 1` on top with alpha = the fractional part. At 12 fps that looks like 24.
- **Eyes:** draw the eye sheet's frame `i` at `(x, y)` over the body frame, with the same crossfade.
- **Clip by activity** (from `core`): idle -> `idle`, sleeping -> `sleep`, eating -> `eat`, playing -> `play`.
- **Eye variant:** idle uses the mood: happy -> `happy`, content -> `calm`, sad -> `sad`, grumpy -> `grumpy`. The other clips have a fixed state (sleep `closed`, eat `content`, play `happy`). Then `_day` or `_night` by `dayPhase()` (night 19:00-06:59).
- **Smoothing on**: these are rendered illustrations, not pixel art.
- **Memory:** a decoded 8 s body sheet is ~92 MB (5436 x 4248 px x 4 bytes). Load the current clip and idle, not all four at once; Selene has 2 GB.

---

## 11. Common changes

- **Change a color or effect:** edit `nyxScene.py`, render a still with `renderStill.py` (day and night, full and face), compare with the 2D crops, then re-run `renderAll.sh` and `packSprites.py`.
- **Add an eye mood:** add a row to `MOODS` in `renderClip.py`, add an eye pass to `renderAll.sh`, render only that pass, re-pack, and add the mapping in the frontend.
- **Add a clip:** add it to `CLIPS` (frame count at 12 fps), write a `pose_<name>(t)` that returns a blink amount, register it in `POSES`, add its body and eye passes to `renderAll.sh`. Test a few frames with `renderClip.py <clip> body N N` before rendering all of it.
- **A new model** (e.g. standing, for M5): export a GLB the same way, replace `assets/source/nyxTripo.glb` or add a second one, then recompute `EYE_POINTS` (cast rays from the camera onto the eye sockets) and check the bone names (section 3.4). The materials and effects carry over as long as the tail bones exist.
- **Re-trace the eyes** (new concept art): `python traceEyes.py <concept.png> out/trace.png`, check the red outline in `trace.png`, paste the printed dict over `EYE_OUTLINES`.

---

## 12. Repo layout

```
assets/source/nyxTripo.glb            the rigged model from Tripo
assets/source/nyxConceptDayNight.png  the design reference (eye shapes are traced from it)
tools/blender/*.py, renderAll.sh      the pipeline
tools/blender/out/                    renders and previews (gitignored: add `tools/blender/out/`)
frontend/src/assets/nyx/              packed sprite sheets + nyx.json (committed)
docs/nyxArtPipeline.md                this file
```

The Python here follows Python conventions (snake_case functions), not the TS ones; file names are camelCase like the rest of the repo.

The concept art and clay views came from ChatGPT image generation, and the model from Tripo on a paid plan. Under both services' terms the output is ours to use; it must not be presented as hand-drawn (see PLAN.md).

---

## 13. Limits and next steps

- **No standing, walking or curling up.** The sitting-pose rig can't do it. M5 (moving between screens) needs either a standing model from Tripo with a walk, or the "drift" idea from PLAN.md: she glides with her tail streaming behind her, which this model could do.
- **Small tail motion** only (3.5).
- **Mood only shows in idle.** Eat, play and sleep use one eye state each; per-mood variants for them are a cheap addition (section 11).
- **Transitions** between clips are a cut (same anchor, so no jump). Short transition clips (sitting -> lying down) would need the leg problem solved first.
- Ideas for v2: a curled-up sleep pose, an ear twitch for grumpy, the goddess "true form" for Selene (PLAN.md, M7).
