# Game Design Document — The Climb

## Overview

**The Climb** is a 2D side-scrolling platformer with 3 levels. The player navigates a character through tile-based environments, collecting coins and a key to unlock the exit door. Each level progressively introduces new movement abilities: level 1 has basic running and jumping; level 2 unlocks wall jumping; level 3 unlocks double jumping. The game has a retro pixel-art aesthetic with an 18×18 pixel tile grid.

---

## Game Structure

### Level Progression

| Level | Map Key | Map Size (tiles) | Map Size (px) | Abilities Unlocked |
|-------|---------|-----------------|---------------|--------------------|
| 1 | `level-1` | 150 × 50 | 2700 × 900 | None |
| 2 | `level-2` | 70 × 50 | 1260 × 900 | Wall Jump |
| 3 | `level-3` | 60 × 80 | 1080 × 1440 | Wall Jump, Double Jump |

- Completing level 3 triggers the win screen.
- Each level must be completed in order. There is no level select.

### Scene Flow

```
Load Scene → Platformer Scene (Level 1) → Platformer Scene (Level 2) → Platformer Scene (Level 3) → Win Screen
```

- The Platformer scene is reused for every level, receiving level data via scene transition parameters.
- On death with lives remaining, the current level restarts (same level, same abilities, reduced lives).
- On death with zero lives, the game resets to level 1 with default abilities and 3 lives.

### Win/Lose Conditions

- **Win:** Reach the door while holding the key in level 3.
- **Death:** Touch spikes, or fall below the bottom of the world by more than 50 pixels.
- **Lives:** The player starts with 3 lives. Dying costs 1 life. At 0 lives, full reset to level 1.

---

## Player Character

### Visual Representation

- **Idle sprite:** `tile_0045.png` (loaded as `char-idle`)
- **Walk sprite:** `tile_0046.png` (loaded as `char-walk`)
- Both sprites are part of the same character tileset in `assets/Characters/`. They are single-frame images (not a spritesheet), each 18×18 px source size.
- The player sprite is displayed at **scale 1.5×** (rendered size ~27×27 px).
- The player faces right by default. `flipX` is toggled to face the direction of movement.
- The player's render depth is 10 (above tiles, below HUD).

### Animations

| Animation Key | Frames | Frame Rate | Repeat | Used When |
|---|---|---|---|---|
| `player-idle` | `char-idle` (1 frame) | 1 fps | Infinite | Standing still on ground |
| `player-walk` | `char-walk`, `char-idle` (2 frames) | 10 fps | Infinite | Moving horizontally on ground |
| `player-jump` | `char-walk` (1 frame) | 1 fps | Infinite | In the air (not on ground) |

Priority: if the player is not on the ground, `player-jump` plays regardless of horizontal movement. The idle animation only plays when standing still on the ground.

### Movement Parameters

| Parameter | Value | Description |
|---|---|---|
| Horizontal move speed | 150 px/s | Instant setVelocityX (no acceleration ramp) |
| Jump velocity | -300 px/s (upward) | Applied instantaneously |
| Double jump velocity | -300 px/s (upward) | Same magnitude as normal jump |
| Wall jump horizontal | 100 px/s | Applied away from wall |
| Wall jump vertical | -250 px/s (upward) | Slightly less than normal jump |
| Spring launch velocity | -550 px/s (upward) | Applied when falling onto a spring |
| Ladder climb speed | 150 px/s (up or down) | Applied while on a ladder |
| Wall slide speed cap | 50 px/s | Fall speed is clamped while sliding on a wall |
| Gravity | 600 px/s² | Downward (y-axis) |
| Ground deceleration | velocity × 0.75 per frame | Friction when no directional input on ground |
| Air deceleration | velocity × 0.9 per frame | Less friction in air (preserves momentum) |
| Velocity deadzone | 5 px/s | Below this, horizontal velocity snaps to 0 |

### Coyote Time & Jump Buffering

These are critical for platformer feel. Both use millisecond timers decremented by the frame delta each update.

| Mechanic | Duration | Description |
|---|---|---|
| Ground coyote time | 80 ms | After leaving a platform, the player can still jump for this duration |
| Jump buffer | 120 ms | If jump is pressed just before landing, the jump executes on contact |
| Wall coyote time | 100 ms | After leaving a wall, the player can still wall-jump for this duration |

- Coyote timer resets to its full value when the player touches the ground or a wall.
- Jump buffer is set when the jump key is newly pressed (`JustDown`), and counts down each frame.
- A buffered jump fires if the player's coyote timer is still active when the buffer has remaining time.

### Wall Sliding

**Prerequisites:** The player must have the wall jump ability unlocked.

A player is wall-sliding when all of the following are true:
1. Not on the ground
2. Holding a directional key toward the wall (left key + touching left wall, or right key + touching right wall)
3. Falling (vertical velocity > 0)

**Behavior:** While wall sliding, vertical velocity is clamped to 50 px/s maximum. This produces a slow descent along the wall.

### Wall Jumping

**Prerequisites:** The player must have the wall jump ability unlocked and must not have already used a wall jump since leaving the ground.

**Trigger:** While wall-sliding (or within wall coyote time after leaving a wall), press jump. The player launches away from the wall: horizontal velocity is set to the wall's opposite direction at 100 px/s, and vertical velocity is set to -250 px/s. The `wallJumped` flag is set to true, preventing another wall jump until the player touches the ground.

**Interaction with double jump:** After a wall jump, `hasDoubleJumped` is reset to false, so the player can still use their double jump in mid-air after a wall jump (if the double jump ability is unlocked).

### Double Jumping

**Prerequisites:** The player must have the double jump ability unlocked, be in the air (not on ground), not have already double-jumped since leaving the ground, and the ground coyote timer must be expired (so the double jump doesn't fire during normal coyote time).

**Behavior:** Sets vertical velocity to -300 px/s. The `hasDoubleJumped` flag is set to true and only resets when the player touches the ground.

### Ladder Climbing

**Detection:** The player is considered "near a ladder" when overlapping a ladder object and pressing up or down. This check happens every frame using an imperative overlap test.

**Behavior:**
- Gravity is disabled while on a ladder (`setAllowGravity(false)`).
- Vertical velocity is set to 0 each frame, then overridden if up/down is pressed.
- Up key: velocity = -150 px/s. Down key: velocity = 150 px/s.
- The player cannot jump, wall slide, or double jump while on a ladder.
- When the player leaves the ladder (no longer overlapping or no longer pressing up/down), gravity is re-enabled.

### Invulnerability

On spawn (both initial level start and respawn after death), the player receives 2000 ms of invulnerability. During this time, spike overlaps do not trigger death. The timer decrements by the frame delta each update. There is no visual effect (no flashing or transparency change) in the current implementation.

---

## World & Collision

### Physics Configuration

- **Engine:** Arcade physics (axis-aligned bounding box only, no rotation)
- **Gravity:** x=0, y=600 px/s²
- **Player world bounds collision:** Disabled. The player can fall off the bottom of the world. Death is detected by checking `player.y > world.bounds.height + 50` each frame.

### Tile Layer

- **Layer name:** `Ground-n-Platforms`
- **Collision rule:** All tiles with the custom property `collides: true` (boolean) are solid. This is set per-tile in Tiled, not per-tile-type.
- **Tileset:** `tilemap_packed` (18×18 px tiles, 20 columns × 9 rows = 360×162 px atlas)
- The player collides with this layer using a standard physics collider.

### Object Types & Collision Behavior

All interactive objects are spawned from the `Objects` object layer in the Tiled map. Objects are placed as point rectangles in the editor; their visual sprite frame is determined by `gid - 1` (Tiled GIDs are 1-indexed, but the tileset frame indices used by the game engine are 0-indexed).

Object positions in Tiled use the bottom-left origin convention. The game centers each object by computing:

```
cx = obj.x + obj.width / 2
cy = obj.y - obj.height / 2
```

The player spawn point uses an additional y-offset of 36 pixels up from the object position:

```
playerStartY = obj.y - 36
```

#### Coins

| Property | Value |
|---|---|
| Physics group | Static |
| Sprite source | `tilemap_packed` tileset, frame = `gid - 1` |
| Display scale | 1.0 (SCALE constant) |
| Collision | Overlap with player (no blocking) |
| Effect on contact | Destroy coin, add 100 to score |
| Idle animation | Bobbing tween: y oscillates 4 px upward, duration 700–900 ms (700 + random 0–200), Sine.easeInOut, yoyo, infinite repeat |

#### Key

| Property | Value |
|---|---|
| Physics group | Static |
| Sprite source | `tilemap_packed` tileset, frame = `gid - 1` |
| Display scale | 1.0 |
| Collision | Overlap with player (no blocking) |
| Effect on contact | Destroy key, set `hasKey = true`, remove door's blocking collider, set door alpha to 1.0, start door bobbing tween, play "openDoor" sound |
| Idle animation | Bobbing tween: y oscillates 5 px upward, duration 900 ms, Sine.easeInOut, yoyo, infinite repeat |

#### Door (Exit)

| Property | Value |
|---|---|
| Physics type | Dynamic sprite (not a group) |
| Sprite source | `tilemap_packed` tileset, frame = `gid - 1` |
| Display scale | 2.0 (twice the SCALE constant) |
| Initial state | Alpha 0.4 (translucent), gravity disabled, immovable, does not move |
| Collision (before key) | Collider with player (blocks passage) |
| Collision (after key) | Collider is destroyed; overlap with player triggers level completion if `hasKey` is true |
| Animation (after key) | Alpha set to 1.0, bobbing tween: y oscillates 4 px upward, duration 500 ms, Sine.easeInOut, yoyo, infinite repeat |
| Effect on contact (with key) | Complete the level |

The door is unique among objects: it uses a dual-collision setup. Before the key is collected, a collider blocks the player. When the key is collected, the collider is removed and only the overlap detector remains, allowing the player to walk into the door to complete the level.

#### Springs

| Property | Value |
|---|---|
| Physics group | Static, immovable |
| Sprite source | `tilemap_packed` tileset, frame = `gid - 1` |
| Display scale | 1.0 |
| Collision | Overlap with player (no blocking from above — player falls through) |
| Effect on contact | If player's vertical velocity > 0 (falling), set vertical velocity to -550 px/s (launch upward), play "spring" sound, emit jump particles |

**Important collision note:** Springs use overlap, not collider. This means the player does not physically stand on springs — they fall through them. The spring only activates when the player is falling (positive vertical velocity). If the player walks horizontally into a spring while on the ground, it does not trigger.

#### Spikes

| Property | Value |
|---|---|
| Physics group | Static, immovable |
| Sprite source | `tilemap_packed` tileset, frame = `gid - 1` |
| Display scale | 1.0 |
| Collision | Overlap with player (no blocking) |
| Effect on contact | Kill the player (unless invulnerable) |

#### Ladders

| Property | Value |
|---|---|
| Physics group | Static, immovable |
| Sprite source | `tilemap_packed` tileset, frame = `gid - 1` |
| Display scale | 1.0 |
| Collision | Overlap with player (no blocking) — checked imperatively each frame in `update()` |
| Effect | Enables ladder climbing when player presses up or down while overlapping |

#### PlayerStart

| Property | Value |
|---|---|
| Not a physical object | Only sets the player spawn position |
| Spawn position | x = `obj.x`, y = `obj.y - 36` |
| Defaults | If no PlayerStart object exists: x=100, y = worldHeight - 100 |

---

## Scoring

| Event | Score Change |
|---|---|
| Collect a coin | +100 |
| Complete a level | +500 |
| Die | Score resets to 0 |

Score carries over between levels. On death, score is reset to 0 (harsh penalty). On full game over (0 lives), all progress is lost.

---

## Sound Design

| Sound Key | Source File | Trigger |
|---|---|---|
| `walk` | `footstep_concrete_000.ogg` | Player moves horizontally on ground (throttled: 300 ms cooldown) |
| `jump` | `impactWood_medium_001.ogg` | Any jump (normal, wall, double — via `doJump()`) |
| `land` | `footstep_wood_003.ogg` | Player transitions from airborne to ground contact |
| `collect` | `impactBell_heavy_000.ogg` | Coin collected |
| `death` | `impactBell_heavy_002.ogg` | Player dies |
| `openDoor` | `impactGlass_medium_001.ogg` | Key collected OR level completed |
| `spring` | `impactMetal_heavy_000.ogg` | Spring bounce activated |
| `ladder` | `impactWood_light_001.ogg` | Moving on a ladder (throttled: 300 ms cooldown) |

All sounds are single-play (no looping). The walk and ladder sounds use a boolean flag + delayed call timer to prevent rapid re-triggering.

---

## Visual Effects (Particles)

All particle emitters are created with `frequency: -1` (manual emission only). Particles are emitted at specific positions using `emitParticleAt(x, y, count)`.

| Emitter | Particle Image | Configuration | Emission Trigger |
|---|---|---|---|
| `moveTrail` | `dirt_01.png` | Speed: 10–40, Angle: 160–200° (rear-facing cone), Scale: 0.05→0, Alpha: 0.8→0, Lifespan: 120–250 ms | 1 particle when running on ground (speed > 60 px/s) |
| `jumpBurst` | `star_01.png` | Speed: 60–160, Angle: 0–360° (omnidirectional), Scale: 0.05→0, Alpha: 1→0, Lifespan: 250–500 ms | 5 particles at x-6 and 5 at x+6 on jump/land; 10 particles centered on double jump |
| `collectBurst` | `star_08.png` | Speed: 80–200, Angle: 0–360°, Scale: 0.08→0, Alpha: 1→0, Lifespan: 300–600 ms | 8 particles at collectible position on coin/key pickup |

---

## Camera

| Property | Value |
|---|---|
| Follow target | Player sprite |
| Follow mode | Lerp (smooth), lerpX = 0.02, lerpY = 0.02 |
| Bounds | Clamped to world/map dimensions |
| Fade transitions | 500 ms fade out on level complete; 300–400 ms fade out on death/respawn |

The camera lerp value of 0.02 is very low, producing a camera that trails significantly behind the player. This is a deliberate design choice for a "floaty" feel, though it may need adjustment if a tighter feel is desired.

---

## HUD

The HUD is fixed to the screen (scroll factor 0) and always visible. All text uses the `monospace` font family at 18px, white, no stroke. Depth = 99 (below overlays at depth 100 but above all game objects).

| Element | Position | Content | Updates |
|---|---|---|---|
| Score | (16, 16) | "Score: {n}" | Every frame |
| Lives | (16, 40) | "Lives: {n}" | Every frame |
| Key status | (16, 64) | "Key: X" / "Key: ✓" (gold #ffbb00 when collected) | On key collect |
| Level number | (right-16, 16), origin right-aligned | "Level: {n}" | On level start |

The level number text is right-aligned using `setOrigin(1)` and positioned at `scale.width - 16`.

---

## UI Overlays

### Level Start Announcement

When a level begins, a centered text displays the level number and current abilities (e.g. "Level 2\nWall Jump"). The text fades in over 500 ms, holds for 2000 ms, then fades out over 500 ms and is destroyed. It uses:
- Font: monospace, 24px, white
- Stroke: black, thickness 4
- Centered, scroll factor 0, depth 99

Ability messages:
- No abilities: "No special abilities"
- Level 2+: "Wall Jump"
- Level 3+: "Double Jump + Wall Jump"

### Level Complete Overlay

Appears when the player enters the door with the key (levels 1–2 only; level 3 goes directly to the win screen). Elements:
1. Semi-transparent black rectangle (60% opacity), covering the screen, depth 100
2. "LEVEL COMPLETE!" title: monospace 48px, gold (#f1c40f)
3. Score display: monospace 28px, gold
4. "[ NEXT LEVEL ]" button: monospace 32px, gold, interactive. Hover turns white; pointer-out turns green (#62dd99). Click triggers level transition with fade-out.

### Win Screen

Same overlay structure as level complete. Differences:
- Title: "YOU WIN!" in 56px
- Score: "Final Score: {n}" in 28px
- Button: "[ PLAY AGAIN ]" — resets to level 1 with default abilities

### Death & Respawn

On death:
1. `isDying` flag is set (prevents re-triggering).
2. Death sound plays.
3. Score resets to 0, lives decremented.
4. After 700 ms delay:
   - If lives > 0: fade out (300 ms), then restart current level with current abilities and remaining lives.
   - If lives = 0: fade out (400 ms), then restart from level 1 with 3 lives, 0 score, no abilities.

---

## Input

| Action | Key Bindings |
|---|---|
| Move left | Left arrow, A |
| Move right | Right arrow, D |
| Jump / Climb up | Up arrow, W, Space |
| Climb down | Down arrow, S |

- Jump is triggered by `JustDown` (single-press detection), not `isDown`. This prevents holding the key to jump repeatedly.
- Movement (left/right) uses `isDown` (continuous hold).
- Ladder climbing uses `isDown` for up/down.

---

## Art Assets

### Tileset

| Asset | File | Size | Usage |
|---|---|---|---|
| Main tileset | `assets/Tilemap/tilemap_packed.png` | 360 × 162 px | All tile art and object sprites. 18×18 px per tile, 20 columns × 9 rows = 180 tiles total. |
| Tileset (unpacked) | `assets/Tilemap/tilemap.png` | — | Alternate version (not loaded by the game) |
| Backgrounds | `assets/Tilemap/tilemap-backgrounds.png` | — | Not used by the current implementation |
| Characters | `assets/Tilemap/tilemap-characters.png` | — | Not used by the current implementation |

The game loads only `tilemap_packed` as a spritesheet with `frameWidth: 18, frameHeight: 18`. All tile layer tiles and all object sprites (coins, keys, spikes, springs, ladders, door) draw from this single atlas. The frame index for object sprites is `obj.gid - 1`.

### Character Sprites

| Asset Key | File | Notes |
|---|---|---|
| `char-idle` | `assets/Characters/tile_0045.png` | Single image, used for idle animation frame |
| `char-walk` | `assets/Characters/tile_0046.png` | Single image, used for walk and jump animation frames |

The other character images in the directory (tile_0040, 0041, 0042, 0051–0056) are not used by the current implementation.

### Particle Images

| Asset Key | File | Usage |
|---|---|---|
| `dirt_01` | `assets/Particles/dirt_01.png` | Running dust trail |
| `star_01` | `assets/Particles/star_01.png` | Jump/land/double-jump burst |
| `star_08` | `assets/Particles/star_08.png` | Coin/key collection burst |

The remaining ~70 particle images in `assets/Particles/` (flames, smoke, sparks, magic, slashes, etc.) are not used by the current implementation.

### Audio

All audio files are OGG Vorbis format, located in `assets/Audio/`. The game loads 8 specific files (see Sound Design table above). The directory contains many more impact and footstep sounds organized by surface/material type (carpet, concrete, grass, snow, wood) and impact type (bell, glass, metal, plank, plate, punch, soft, tin, wood) — these are available for future use but are not loaded.

### Level Files

| File | Format | Notes |
|---|---|---|
| `Level1.tmj` | Tiled JSON | Loaded by the game |
| `Level1.tmx` | Tiled XML | Editor format; not loaded |
| `Level2.tmj` | Tiled JSON | Loaded by the game |
| `Level2.tmx` | Tiled XML | Editor format; not loaded |
| `Level3.tmj` | Tiled JSON | Loaded by the game |
| `Level3.tmx` | Tiled XML | Editor format; not loaded |

The `.tmj` files are the export format consumed at runtime. The `.tmx` files are the Tiled editor's native format. Both must be kept in sync when editing levels.

### Tiled Project

`Level1.tiled-project` is the Tiled project file. It references the current directory (`"."`) as its folder. The compatibility version is 1100.

---

## Adding a New Level

To add a level N beyond the existing 3:

1. Create `LevelN.tmj` (and `LevelN.tmx` for editing) in `assets/Tilemap/`.
2. The map must have a tile layer named `Ground-n-Platforms` with tiles having `collides: true` property.
3. The map must have an object layer named `Objects` with at minimum: a `PlayerStart` object, a `Door` object, and a `key` object.
4. Add the load call: `this.load.tilemapTiledJSON("level-N", "LevelN.tmj")` in the Load scene's preload method.
5. Update the `completeLevel()` method: change the `currentLevel >= 3` checks to `>= N` (there are two such checks).
6. Update the ability unlock logic in the level transition handler to grant wall jump and double jump at the desired levels.
7. Update the win condition: completing the final level should transition to the win screen instead of showing "NEXT LEVEL".
