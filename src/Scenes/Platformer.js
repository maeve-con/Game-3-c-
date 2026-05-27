// =====================================================================
// Platformer.js — Main gameplay scene
// =====================================================================
// This scene implements all gameplay for "The Climb": tilemap rendering,
// player movement, object spawning/collision, HUD, particles, sounds,
// level transitions, death/respawn, and UI overlays.
//
// Organization:
//   1. PlayerController class — encapsulates player sprite, state, and
//      movement logic (walking, jumping, wall slide, double jump, ladders)
//   2. HUDManager class — manages score/lives/key/level display
//   3. Platformer scene class — orchestrates everything with clean
//      create() and update() methods that delegate to helpers

// =====================================================================
// 1. PLAYER CONTROLLER
// =====================================================================
// Manages the player sprite and all movement-related state.
// Keeps the Platformer scene's update() short by encapsulating the
// complex platformer physics (coyote time, jump buffer, wall slide, etc.)

class PlayerController {

    /**
     * @param {Phaser.Scene} scene  The owning scene
     * @param {number} x            Spawn x (center)
     * @param {number} y            Spawn y (center)
     * @param {object} abilities   { hasWallJump, hasDoubleJump }
     */
    constructor(scene, x, y, abilities) {
        this.scene = scene;

        // --- Create the player sprite ---
        this.sprite = scene.physics.add.sprite(x, y, "char-idle");
        this.sprite.setScale(1.5);               // 18×18 → 27×27 rendered
        this.sprite.setDepth(10);                 // Above tiles, below HUD
        this.sprite.setCollideWorldBounds(false);  // Player can fall off

        // Slightly shrink the physics body for better platformer feel:
        // a narrower body prevents the player from catching on tile edges.
        // The body stays centered; we offset by half the shrink amount.
        this.sprite.body.setSize(20, 24);
        this.sprite.body.setOffset(4, 3);

        // Play the idle animation on spawn
        this.sprite.play("player-idle");

        // --- Abilities (unlocked per level) ---
        this.hasWallJump = abilities.hasWallJump;
        this.hasDoubleJump = abilities.hasDoubleJump;

        // --- Coyote-time & jump-buffer timers (ms) ---
        this.groundCoyoteTimer = 0;   // 80 ms grace after leaving a platform
        this.jumpBufferTimer = 0;     // 120 ms early-jump window
        this.wallCoyoteTimer = 0;     // 100 ms grace after leaving a wall

        // --- Jump state flags ---
        this.hasDoubleJumped = false; // Prevents double-jumping twice
        this.wallJumped = false;      // Prevents re-wall-jumping in same air

        // --- Ladder state ---
        this.isOnLadder = false;

        // --- Invulnerability ---
        // 2000 ms of invulnerability on every spawn (initial & respawn)
        this.invulnTimer = 2000;

        // --- Ground-tracking for landing sound ---
        this.wasOnGround = false;

        // --- Sound throttling flags ---
        this.walkSoundCooldown = 0;
        this.ladderSoundCooldown = 0;
    }

    /** Whether the player sprite is touching the ground this frame */
    get isOnGround() {
        return this.sprite.body.blocked.down || this.sprite.body.touching.down;
    }

    /** Whether the player is touching a wall on either side */
    get isTouchingWall() {
        return this.sprite.body.blocked.left || this.sprite.body.blocked.right
            || this.sprite.body.touching.left || this.sprite.body.touching.right;
    }

    /** Whether the player is falling (positive vertical velocity) */
    get isFalling() {
        return this.sprite.body.velocity.y > 0;
    }

    // ── Per-frame update ─────────────────────────────────────────
    /**
     * @param {number} delta  Frame delta in ms
     * @param {object} input  { left, right, up, down, jumpJustDown }
     */
    update(delta, input) {
        // Decrement invulnerability timer
        if (this.invulnTimer > 0) this.invulnTimer -= delta;

        // If the player is on a ladder, handle ladder logic instead
        if (this.isOnLadder) {
            this.handleLadder(input, delta);
            return;
        }

        // --- Reset ground/wall state BEFORE jump processing ---
        // This is critical: if we reset coyote timers after jump checks,
        // a buffered jump can be lost on the exact frame the player lands.
        if (this.isOnGround) {
            this.wallJumped = false;
            this.hasDoubleJumped = false;
            this.groundCoyoteTimer = 80;
            this.wallCoyoteTimer = 100;
        }
        if (this.isTouchingWall) {
            this.wallCoyoteTimer = 100;
        }

        // --- Horizontal movement ---
        this.handleHorizontalMovement(input);

        // --- Timers ---
        this.updateTimers(delta, input);

        // --- Jumping (coyote + buffer) ---
        this.handleJumping(input);

        // --- Wall sliding ---
        this.handleWallSlide(input);

        // --- Landing sound ---
        this.handleLandingSound();

        // --- Walk sound ---
        this.handleWalkSound(delta, input);

        // --- Flip sprite to face movement direction ---
        if (input.left && !input.right) this.sprite.setFlipX(true);
        else if (input.right && !input.left) this.sprite.setFlipX(false);
    }

    // ── Horizontal movement (walking & deceleration) ─────────────
    handleHorizontalMovement(input) {
        const MOVE_SPEED = 150;
        const GROUND_DECEL = 0.75;
        const AIR_DECEL = 0.9;
        const DEADZONE = 5;

        if (input.left && !input.right) {
            this.sprite.setVelocityX(-MOVE_SPEED);
        } else if (input.right && !input.left) {
            this.sprite.setVelocityX(MOVE_SPEED);
        } else {
            // No input: apply friction/deceleration
            const decel = this.isOnGround ? GROUND_DECEL : AIR_DECEL;
            this.sprite.setVelocityX(this.sprite.body.velocity.x * decel);
            if (Math.abs(this.sprite.body.velocity.x) < DEADZONE) {
                this.sprite.setVelocityX(0);
            }
        }
    }

    // ── Timer updates (coyote, jump buffer, wall coyote) ─────────
    updateTimers(delta, input) {
        // Ground coyote timer — counts down when off the ground
        if (!this.isOnGround && this.groundCoyoteTimer > 0) {
            this.groundCoyoteTimer -= delta;
        }

        // Wall coyote timer — counts down when not touching a wall
        if (!this.isTouchingWall && this.wallCoyoteTimer > 0) {
            this.wallCoyoteTimer -= delta;
        }

        // Jump buffer — set when jump is first pressed, then counts down
        if (input.jumpJustDown) {
            this.jumpBufferTimer = 120;
        } else if (this.jumpBufferTimer > 0) {
            this.jumpBufferTimer -= delta;
        }
    }

    // ── Jump logic (coyote time + jump buffer) ───────────────────
    handleJumping(input) {
        // A jump fires when the buffer is active AND the player still
        // has coyote time remaining (ground or wall).
        const canGroundJump = this.groundCoyoteTimer > 0;
        const canWallJump = this.hasWallJump && this.wallCoyoteTimer > 0
            && !this.wallJumped;
        let jumpedThisFrame = false;

        if (this.jumpBufferTimer > 0 && (canGroundJump || canWallJump)) {
            if (canWallJump && !this.isOnGround) {
                this.doWallJump();
            } else {
                this.doJump();
            }
            this.jumpBufferTimer = 0;
            this.groundCoyoteTimer = 0;
            jumpedThisFrame = true;
        }

        // --- Double jump (separate from coyote/buffer system) ---
        // Only allowed if no other jump fired this same frame
        if (!jumpedThisFrame && this.hasDoubleJump && input.jumpJustDown
            && !this.isOnGround && !this.hasDoubleJumped
            && this.groundCoyoteTimer <= 0) {
            this.doDoubleJump();
        }
    }

    /** Perform a normal ground jump */
    doJump() {
        this.sprite.setVelocityY(-300);
        this.scene.sound.play("jump");
        // Emit jump particles at the player's feet
        this.scene.emitJumpParticles(this.sprite.x, this.sprite.y, false);
    }

    /** Perform a wall jump (away from the wall) */
    doWallJump() {
        // Determine which wall we're touching and launch away from it
        const wallDir = (this.sprite.body.blocked.left || this.sprite.body.touching.left)
            ? 1 : -1;
        this.sprite.setVelocityX(wallDir * 100);
        this.sprite.setVelocityY(-250);
        this.wallJumped = true;
        // After a wall jump, the player can still double jump
        this.hasDoubleJumped = false;
        this.scene.sound.play("jump");
        this.scene.emitJumpParticles(this.sprite.x, this.sprite.y, false);
    }

    /** Perform a double jump in mid-air */
    doDoubleJump() {
        this.sprite.setVelocityY(-300);
        this.hasDoubleJumped = true;
        this.scene.sound.play("jump");
        // Double jump emits a centered burst
        this.scene.emitJumpParticles(this.sprite.x, this.sprite.y, true);
    }

    // ── Wall slide ───────────────────────────────────────────────
    handleWallSlide(input) {
        if (!this.hasWallJump) return;

        // Wall slide conditions: in air, pressing toward wall, falling
        const touchingLeft = this.sprite.body.blocked.left
            || this.sprite.body.touching.left;
        const touchingRight = this.sprite.body.blocked.right
            || this.sprite.body.touching.right;

        const pressingLeft = input.left && !input.right;
        const pressingRight = input.right && !input.left;

        const isSliding = !this.isOnGround
            && ((pressingLeft && touchingLeft) || (pressingRight && touchingRight))
            && this.isFalling;

        if (isSliding) {
            // Clamp fall speed to a slow descent
            if (this.sprite.body.velocity.y > 50) {
                this.sprite.setVelocityY(50);
            }
        }
    }

    // ── Ladder climbing ──────────────────────────────────────────
    handleLadder(input, delta) {
        const CLIMB_SPEED = 150;

        // While on a ladder, gravity is disabled
        this.sprite.setVelocityX(0);
        this.sprite.setVelocityY(0);

        if (input.up) {
            this.sprite.setVelocityY(-CLIMB_SPEED);
        } else if (input.down) {
            this.sprite.setVelocityY(CLIMB_SPEED);
        }

        // Allow horizontal movement on ladders too (slower)
        if (input.left) this.sprite.setVelocityX(-CLIMB_SPEED * 0.5);
        else if (input.right) this.sprite.setVelocityX(CLIMB_SPEED * 0.5);

        // Ladder movement sound (throttled)
        if (input.up || input.down) {
            this.ladderSoundCooldown -= delta;
            if (this.ladderSoundCooldown <= 0) {
                this.scene.sound.play("ladder");
                this.ladderSoundCooldown = 300;
            }
        }

        // Flip sprite on ladder
        if (input.left && !input.right) this.sprite.setFlipX(true);
        else if (input.right && !input.left) this.sprite.setFlipX(false);
    }

    /** Enter ladder mode (called from the scene's overlap check) */
    enterLadder() {
        this.isOnLadder = true;
        this.sprite.setAllowGravity(false);
        // Reset jump state when entering ladder
        this.hasDoubleJumped = false;
        this.wallJumped = false;
    }

    /** Leave ladder mode (called when no longer overlapping or pressing up/down) */
    leaveLadder() {
        this.isOnLadder = false;
        this.sprite.setAllowGravity(true);
    }

    // ── Landing sound ────────────────────────────────────────────
    handleLandingSound() {
        if (this.isOnGround && !this.wasOnGround) {
            this.scene.sound.play("land");
            // Emit landing particles
            this.scene.emitJumpParticles(this.sprite.x, this.sprite.y, false);
        }
        this.wasOnGround = this.isOnGround;
    }

    // ── Walk sound (throttled) ───────────────────────────────────
    handleWalkSound(delta, input) {
        if (this.isOnGround && (input.left || input.right)) {
            const speed = Math.abs(this.sprite.body.velocity.x);
            if (speed > 60) {
                this.walkSoundCooldown -= delta;
                if (this.walkSoundCooldown <= 0) {
                    this.scene.sound.play("walk");
                    this.walkSoundCooldown = 300;
                }
            }
        }
    }

    // ── Animation selection ─────────────────────────────────────
    updateAnimation() {
        if (this.isOnLadder) {
            // On a ladder, use the walk frame (closest to "climbing" look)
            this.sprite.play("player-jump", true);
            return;
        }

        if (!this.isOnGround) {
            // In the air: always show jump animation
            this.sprite.play("player-jump", true);
        } else if (Math.abs(this.sprite.body.velocity.x) > 10) {
            // On ground and moving: walk cycle
            this.sprite.play("player-walk", true);
        } else {
            // On ground and still: idle
            this.sprite.play("player-idle", true);
        }
    }
}


// =====================================================================
// 2. HUD MANAGER
// =====================================================================
// Manages the heads-up display: score, lives, key status, level number.
// All text is fixed to the screen (scroll factor 0) at depth 99.

class HUDManager {

    /**
     * @param {Phaser.Scene} scene
     * @param {number} level  Current level number (for display)
     */
    constructor(scene, level) {
        this.scene = scene;

        const textStyle = {
            fontFamily: "monospace",
            fontSize: "18px",
            color: "#ffffff"
        };

        // Score (top-left)
        this.scoreText = scene.add.text(16, 16, "Score: 0", textStyle)
            .setScrollFactor(0).setDepth(99);

        // Lives (below score)
        this.livesText = scene.add.text(16, 40, "Lives: 3", textStyle)
            .setScrollFactor(0).setDepth(99);

        // Key status (below lives)
        this.keyText = scene.add.text(16, 64, "Key: X", textStyle)
            .setScrollFactor(0).setDepth(99);

        // Level number (top-right, right-aligned)
        this.levelText = scene.add.text(0, 16, `Level: ${level}`, textStyle)
            .setOrigin(1, 0)               // Right-align origin
            .setScrollFactor(0).setDepth(99);
        // Position will be updated each frame based on canvas width
    }

    /** Refresh all HUD text — call every frame */
    update(score, lives, hasKey, hasWallJump, hasDoubleJump) {
        this.scoreText.setText(`Score: ${score}`);
        this.livesText.setText(`Lives: ${lives}`);

        // Key status with gold color when collected
        if (hasKey) {
            this.keyText.setText("Key: \u2713");  // ✓ checkmark
            this.keyText.setColor("#ffbb00");
        } else {
            this.keyText.setText("Key: X");
            this.keyText.setColor("#ffffff");
        }

        // Position level text at right edge of the viewport
        this.levelText.x = this.scene.scale.width - 16;
    }
}


// =====================================================================
// 3. PLATFORMER SCENE
// =====================================================================

class Platformer extends Phaser.Scene {

    constructor() {
        super("platformerScene");
    }

    // ── init: receive level data from previous scene ──────────────
    init(data) {
        this.currentLevel = data.level || 1;
        this.score = data.score || 0;
        this.lives = data.lives || 3;
        this.hasWallJump = data.hasWallJump || false;
        this.hasDoubleJump = data.hasDoubleJump || false;
        this.hasKey = false;

        // Map key format matches the keys registered in Load.js
        this.mapKey = `level-${this.currentLevel}`;

        // Flags to prevent input during transitions
        this.isDying = false;
        this.isTransitioning = false;
    }

    // ── create: set up the entire level ───────────────────────────
    create() {
        this.setupTilemap();
        this.spawnObjects();
        this.createPlayer();
        this.setupPhysics();
        this.setupCamera();
        this.createParticles();
        this.setupInput();
        this.hud = new HUDManager(this, this.currentLevel);
        this.showLevelAnnouncement();
    }

    // ── update: per-frame game loop ──────────────────────────────
    update(time, delta) {
        // Don't process gameplay during death/transition sequences
        if (this.isDying || this.isTransitioning) return;

        // Build an input snapshot for the player controller
        const input = {
            left: this.cursors.left.isDown || this.keyA.isDown,
            right: this.cursors.right.isDown || this.keyD.isDown,
            up: this.cursors.up.isDown || this.keyW.isDown || this.space.isDown,
            down: this.cursors.down.isDown || this.keyS.isDown,
            jumpJustDown: Phaser.Input.Keyboard.JustDown(this.space)
                || Phaser.Input.Keyboard.JustDown(this.cursors.up)
                || Phaser.Input.Keyboard.JustDown(this.keyW)
        };

        // Update the player controller
        this.player.update(delta, input);

        // Ladder overlap check (imperative, every frame per DESIGN.md)
        this.checkLadderOverlap(input);

        // Animation
        this.player.updateAnimation();

        // Move-trail particle when running on ground
        if (this.player.isOnGround
            && Math.abs(this.player.sprite.body.velocity.x) > 60) {
            this.moveTrail.emitParticleAt(
                this.player.sprite.x,
                this.player.sprite.y + 12,
                1
            );
        }

        // Death check: fall below the world
        this.checkDeath();

        // HUD refresh
        this.hud.update(
            this.score,
            this.lives,
            this.hasKey,
            this.hasWallJump,
            this.hasDoubleJump
        );
    }

    // =================================================================
    //  SETUP HELPERS (called from create)
    // =================================================================

    /** Load the tilemap and create the collision-enabled ground layer */
    setupTilemap() {
        this.map = this.make.tilemap({ key: this.mapKey });
        // The tileset name must match the "name" field in the TMJ file
        this.tileset = this.map.addTilesetImage("tilemap_packed");

        // Create the visual tile layer
        this.groundLayer = this.map.createLayer("Ground-n-Platforms", this.tileset);

        // Enable collision on every tile that has the custom "collides" property
        this.groundLayer.setCollisionByProperty({ collides: true });
    }

    /** Spawn all interactive objects from the Tiled Objects layer */
    spawnObjects() {
        const objectLayer = this.map.getObjectLayer("Objects");
        if (!objectLayer) return;

        // Physics groups for each object type
        this.coins = this.physics.add.staticGroup();
        this.spikes = this.physics.add.staticGroup();
        this.springs = this.physics.add.staticGroup();
        this.ladders = this.physics.add.staticGroup();

        // Default spawn position (in case no PlayerStart object)
        const worldHeight = this.map.heightInPixels;
        this.spawnX = 100;
        this.spawnY = worldHeight - 100;

        // The Door is a single dynamic sprite, not a group member
        this.door = null;
        this.doorBlocker = null;  // Collider that blocks before key is collected

        // Iterate all objects placed in Tiled
        for (const obj of objectLayer.objects) {
            const name = obj.name.toLowerCase();

            // Skip objects with no name (stray Tiled objects)
            if (!name) continue;

            // Center position using Tiled's bottom-left convention
            const cx = obj.x + (obj.width || 0) / 2;
            const cy = obj.y - (obj.height || 0) / 2;
            const frame = obj.gid ? obj.gid - 1 : 0;

            switch (name) {
                case "playerstart":
                    this.spawnX = obj.x + (obj.width || 18) / 2;
                    this.spawnY = obj.y - 36;  // Per DESIGN.md vertical offset
                    break;

                case "coin":
                    this.createCoin(cx, cy, frame);
                    break;

                case "key":
                    this.createKey(cx, cy, frame);
                    break;

                case "door":
                    this.createDoor(cx, cy, frame);
                    break;

                case "spike":
                    this.createSpike(cx, cy, frame);
                    break;

                case "spring":
                    this.createSpring(cx, cy, frame);
                    break;

                case "ladder":
                    this.createLadder(cx, cy, frame);
                    break;
            }
        }
    }

    // --- Individual object factory methods ---

    /** Create a single coin with a bobbing animation */
    createCoin(x, y, frame) {
        const coin = this.coins.create(x, y, "tilemap_packed", frame);
        // Bobbing tween: oscillate 4 px upward, 700–900 ms duration
        const duration = 700 + Math.random() * 200;
        this.tweens.add({
            targets: coin,
            y: coin.y - 4,
            duration: duration,
            ease: "Sine.easeInOut",
            yoyo: true,
            repeat: -1
        });
    }

    /** Create the key with a bobbing animation */
    createKey(x, y, frame) {
        this.keySprite = this.physics.add.staticSprite(x, y, "tilemap_packed", frame);
        // Bobbing tween: 5 px upward, 900 ms
        this.tweens.add({
            targets: this.keySprite,
            y: this.keySprite.y - 5,
            duration: 900,
            ease: "Sine.easeInOut",
            yoyo: true,
            repeat: -1
        });
    }

    /**
     * Create the door — a dynamic sprite with dual collision:
     *   - Before key: collider blocks the player
     *   - After key: collider is destroyed, overlap triggers level completion
     */
    createDoor(x, y, frame) {
        this.door = this.physics.add.sprite(x, y, "tilemap_packed", frame);
        this.door.setScale(2.0);              // Twice the base SCALE
        this.door.setAlpha(0.4);             // Translucent before key
        this.door.body.setAllowGravity(false);
        this.door.setImmovable(true);
        this.door.setDepth(5);
    }

    /** Create a spike hazard */
    createSpike(x, y, frame) {
        const spike = this.spikes.create(x, y, "tilemap_packed", frame);
        spike.setImmovable(true);
        spike.refreshBody();
    }

    /** Create a spring (overlap-only, no blocking collision) */
    createSpring(x, y, frame) {
        const spring = this.springs.create(x, y, "tilemap_packed", frame);
        spring.setImmovable(true);
        spring.refreshBody();
    }

    /** Create a ladder tile (overlap-only, no blocking collision) */
    createLadder(x, y, frame) {
        const ladder = this.ladders.create(x, y, "tilemap_packed", frame);
        ladder.setImmovable(true);
        ladder.refreshBody();
    }

    /** Create the player sprite and PlayerController */
    createPlayer() {
        // Create player animations first so the controller can reference them
        // immediately. Guarded so re-creating the scene doesn't throw
        // duplicate-key warnings on the global animation manager.
        if (!this.anims.exists("player-idle")) {
            this.anims.create({
                key: "player-idle",
                frames: [{ key: "char-idle" }],
                frameRate: 1,
                repeat: -1
            });
        }
        if (!this.anims.exists("player-walk")) {
            this.anims.create({
                key: "player-walk",
                frames: [
                    { key: "char-walk" },
                    { key: "char-idle" }
                ],
                frameRate: 10,
                repeat: -1
            });
        }
        if (!this.anims.exists("player-jump")) {
            this.anims.create({
                key: "player-jump",
                frames: [{ key: "char-walk" }],
                frameRate: 1,
                repeat: -1
            });
        }

        // Now create the player controller (which starts playing "player-idle")
        this.player = new PlayerController(
            this, this.spawnX, this.spawnY,
            { hasWallJump: this.hasWallJump, hasDoubleJump: this.hasDoubleJump }
        );
    }

    /** Wire up all physics colliders and overlaps */
    setupPhysics() {
        // Player vs. ground tiles
        this.physics.add.collider(this.player.sprite, this.groundLayer);

        // Door: blocking collider (before key) + completion overlap (after key)
        if (this.door) {
            this.doorBlocker = this.physics.add.collider(
                this.player.sprite, this.door
            );
            this.physics.add.overlap(
                this.player.sprite, this.door,
                this.onDoorOverlap, null, this
            );
        }

        // Coins: overlap collection
        this.physics.add.overlap(
            this.player.sprite, this.coins,
            this.onCoinCollect, null, this
        );

        // Key: overlap collection
        if (this.keySprite) {
            this.physics.add.overlap(
                this.player.sprite, this.keySprite,
                this.onKeyCollect, null, this
            );
        }

        // Springs: overlap bounce (only when falling)
        this.physics.add.overlap(
            this.player.sprite, this.springs,
            this.onSpringBounce, null, this
        );

        // Spikes: overlap death (unless invulnerable)
        this.physics.add.overlap(
            this.player.sprite, this.spikes,
            this.onSpikeHit, null, this
        );

        // Ladders: no collider (overlap is checked imperatively in update)
    }

    /** Configure the camera to follow the player */
    setupCamera() {
        this.cameras.main.setBounds(
            0, 0,
            this.map.widthInPixels,
            this.map.heightInPixels
        );
        this.cameras.main.startFollow(
            this.player.sprite,
            false,          // Don't round pixel positions (smoother at low lerp)
            0.02, 0.02      // Lerp: very low = deliberate "floaty" feel per DESIGN.md
        );
        this.cameras.main.setDeadzone(0, 0);
    }

    /** Create particle emitters (all set to manual emission, frequency: -1) */
    createParticles() {
        // Dust trail while running on ground
        this.moveTrail = this.add.particles(0, 0, "dirt_01", {
            frequency: -1,
            speed: { min: 10, max: 40 },
            angle: { min: 160, max: 200 },
            scale: { start: 0.05, end: 0 },
            alpha: { start: 0.8, end: 0 },
            lifespan: { min: 120, max: 250 }
        });
        this.moveTrail.setDepth(9);

        // Jump / land / double-jump star burst
        this.jumpBurst = this.add.particles(0, 0, "star_01", {
            frequency: -1,
            speed: { min: 60, max: 160 },
            angle: { min: 0, max: 360 },
            scale: { start: 0.05, end: 0 },
            alpha: { start: 1, end: 0 },
            lifespan: { min: 250, max: 500 }
        });
        this.jumpBurst.setDepth(9);

        // Coin / key collection sparkle
        this.collectBurst = this.add.particles(0, 0, "star_08", {
            frequency: -1,
            speed: { min: 80, max: 200 },
            angle: { min: 0, max: 360 },
            scale: { start: 0.08, end: 0 },
            alpha: { start: 1, end: 0 },
            lifespan: { min: 300, max: 600 }
        });
        this.collectBurst.setDepth(9);
    }

    /** Set up keyboard input */
    setupInput() {
        // Arrow keys
        this.cursors = this.input.keyboard.createCursorKeys();
        // WASD + Space
        this.keyW = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
        this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
        this.keyS = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
        this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
        this.space = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    }

    // =================================================================
    //  UPDATE HELPERS
    // =================================================================

    /**
     * Imperative ladder overlap check — runs every frame.
     * The DESIGN.md specifies ladders are checked this way
     * rather than using a persistent overlap handler.
     */
    checkLadderOverlap(input) {
        // Only check if the player is pressing up or down
        if (!input.up && !input.down) {
            if (this.player.isOnLadder) {
                this.player.leaveLadder();
            }
            return;
        }

        // Use Phaser's physics overlap test against the ladders group
        const overlapping = this.physics.overlap(
            this.player.sprite, this.ladders
        );

        if (overlapping) {
            if (!this.player.isOnLadder) {
                this.player.enterLadder();
            }
        } else {
            if (this.player.isOnLadder) {
                this.player.leaveLadder();
            }
        }
    }

    /** Check if the player fell below the world boundary */
    checkDeath() {
        const worldBottom = this.map.heightInPixels + 50;
        if (this.player.sprite.y > worldBottom) {
            this.handleDeath();
        }
    }

    // =================================================================
    //  COLLISION / OVERLAP HANDLERS
    // =================================================================

    /** Coin collection: add score, destroy coin, emit particles + sound */
    onCoinCollect(playerSprite, coin) {
        coin.destroy();
        this.score += 100;
        this.sound.play("collect");
        this.collectBurst.emitParticleAt(coin.x, coin.y, 8);
    }

    /** Key collection: remove key, unlock door, start door tween + sound */
    onKeyCollect(playerSprite, key) {
        key.destroy();
        this.hasKey = true;

        // Unlock the door: remove the blocking collider
        if (this.doorBlocker) {
            this.doorBlocker.destroy();
            this.doorBlocker = null;
        }

        // Make the door fully opaque and start its bobbing animation
        if (this.door) {
            this.door.setAlpha(1.0);
            this.tweens.add({
                targets: this.door,
                y: this.door.y - 4,
                duration: 500,
                ease: "Sine.easeInOut",
                yoyo: true,
                repeat: -1
            });
        }

        this.sound.play("openDoor");
        this.collectBurst.emitParticleAt(key.x, key.y, 8);
    }

    /** Door overlap: if the player has the key, complete the level */
    onDoorOverlap(playerSprite, door) {
        if (this.hasKey) {
            this.completeLevel();
        }
    }

    /**
     * Spring bounce: only activates when the player is falling.
     * Springs use overlap (no blocking), so the player passes through
     * them and is launched upward when falling onto one.
     */
    onSpringBounce(playerSprite, spring) {
        if (playerSprite.body.velocity.y > 0) {
            playerSprite.setVelocityY(-550);
            this.sound.play("spring");
            this.emitJumpParticles(playerSprite.x, playerSprite.y, false);
        }
    }

    /** Spike hit: kill the player (unless invulnerable) */
    onSpikeHit(playerSprite, spike) {
        if (this.player.invulnTimer > 0) return;
        this.handleDeath();
    }

    // =================================================================
    //  GAME STATE: LEVEL COMPLETION & DEATH
    // =================================================================

    /** Complete the current level — add bonus score and transition */
    completeLevel() {
        if (this.isTransitioning) return;
        this.isTransitioning = true;
        this.score += 500;
        this.sound.play("openDoor");

        if (this.currentLevel >= 3) {
            // Final level complete — show the win screen
            this.showWinScreen();
        } else {
            this.showLevelComplete();
        }
    }

    /** Player death sequence — reduce lives, decide restart or game over */
    handleDeath() {
        if (this.isDying) return;
        this.isDying = true;

        this.sound.play("death");
        this.score = 0;       // Harsh penalty: score resets on death
        this.lives -= 1;

        // Freeze the player sprite
        this.player.sprite.setVelocity(0, 0);
        this.player.sprite.setAllowGravity(false);

        // After a short delay, fade out and restart
        this.time.delayedCall(700, () => {
            if (this.lives > 0) {
                // Restart current level with remaining abilities
                this.cameras.main.fadeOut(300, 0, 0, 0);
                this.cameras.main.once("camerafadeoutcomplete", () => {
                    this.scene.start("platformerScene", {
                        level: this.currentLevel,
                        score: 0,
                        lives: this.lives,
                        hasWallJump: this.hasWallJump,
                        hasDoubleJump: this.hasDoubleJump
                    });
                });
            } else {
                // Game over: reset everything back to level 1
                this.cameras.main.fadeOut(400, 0, 0, 0);
                this.cameras.main.once("camerafadeoutcomplete", () => {
                    this.scene.start("platformerScene", {
                        level: 1,
                        score: 0,
                        lives: 3,
                        hasWallJump: false,
                        hasDoubleJump: false
                    });
                });
            }
        });
    }

    // =================================================================
    //  UI OVERLAYS
    // =================================================================

    /** Show the level number + abilities announcement when a level starts */
    showLevelAnnouncement() {
        // Build the ability description text
        let abilityText = "No special abilities";
        if (this.currentLevel >= 3) {
            abilityText = "Double Jump + Wall Jump";
        } else if (this.currentLevel >= 2) {
            abilityText = "Wall Jump";
        }

        const text = this.add.text(
            this.scale.width / 2,
            this.scale.height / 2,
            `Level ${this.currentLevel}\n${abilityText}`,
            {
                fontFamily: "monospace",
                fontSize: "24px",
                color: "#ffffff",
                stroke: "#000000",
                strokeThickness: 4,
                align: "center"
            }
        ).setOrigin(0.5).setScrollFactor(0).setDepth(99).setAlpha(0);

        // Fade in → hold → fade out → destroy
        this.tweens.add({
            targets: text,
            alpha: 1,
            duration: 500,
            ease: "Linear",
            onComplete: () => {
                this.time.delayedCall(2000, () => {
                    this.tweens.add({
                        targets: text,
                        alpha: 0,
                        duration: 500,
                        ease: "Linear",
                        onComplete: () => { text.destroy(); }
                    });
                });
            }
        });
    }

    /** Show "LEVEL COMPLETE" overlay with a Next Level button */
    showLevelComplete() {
        // Fade the camera for a smooth transition
        this.cameras.main.fadeOut(500, 0, 0, 0);
        this.cameras.main.once("camerafadeoutcomplete", () => {
            this.createOverlayContent(
                "LEVEL COMPLETE!",
                `Score: ${this.score}`,
                "[ NEXT LEVEL ]",
                () => {
                    // Transition to the next level, unlocking new abilities
                    const nextLevel = this.currentLevel + 1;
                    this.scene.start("platformerScene", {
                        level: nextLevel,
                        score: this.score,
                        lives: this.lives,
                        hasWallJump: nextLevel >= 2,
                        hasDoubleJump: nextLevel >= 3
                    });
                }
            );
            this.cameras.main.fadeIn(500, 0, 0, 0);
        });
    }

    /** Show "YOU WIN!" overlay with a Play Again button */
    showWinScreen() {
        this.cameras.main.fadeOut(500, 0, 0, 0);
        this.cameras.main.once("camerafadeoutcomplete", () => {
            this.createOverlayContent(
                "YOU WIN!",
                `Final Score: ${this.score}`,
                "[ PLAY AGAIN ]",
                () => {
                    // Full reset to level 1
                    this.scene.start("platformerScene", {
                        level: 1,
                        score: 0,
                        lives: 3,
                        hasWallJump: false,
                        hasDoubleJump: false
                    });
                },
                56  // Larger title for the win screen
            );
            this.cameras.main.fadeIn(500, 0, 0, 0);
        });
    }

    /**
     * Build a full-screen overlay with title, score, and button.
     * Used by both level-complete and win screens.
     *
     * @param {string} title       Big heading text
     * @param {string} scoreText   Score display text
     * @param {string} buttonLabel  Button text
     * @param {function} onClick    Callback when button is clicked
     * @param {number} [titleSize=48] Font size for the title
     */
    createOverlayContent(title, scoreText, buttonLabel, onClick, titleSize = 48) {
        const cx = this.scale.width / 2;
        const cy = this.scale.height / 2;

        // Semi-transparent black backdrop
        this.add.rectangle(cx, cy, this.scale.width, this.scale.height, 0x000000, 0.6)
            .setScrollFactor(0).setDepth(100);

        // Title
        this.add.text(cx, cy - 60, title, {
            fontFamily: "monospace",
            fontSize: `${titleSize}px`,
            color: "#f1c40f"
        }).setOrigin(0.5).setScrollFactor(0).setDepth(100);

        // Score
        this.add.text(cx, cy, scoreText, {
            fontFamily: "monospace",
            fontSize: "28px",
            color: "#f1c40f"
        }).setOrigin(0.5).setScrollFactor(0).setDepth(100);

        // Interactive button
        const button = this.add.text(cx, cy + 60, buttonLabel, {
            fontFamily: "monospace",
            fontSize: "32px",
            color: "#f1c40f"
        }).setOrigin(0.5).setScrollFactor(0).setDepth(100);

        button.setInteractive({ useHandCursor: true });
        button.on("pointerover", () => button.setColor("#ffffff"));
        button.on("pointerout", () => button.setColor("#62dd99"));
        button.on("pointerdown", onClick);
    }

    // =================================================================
    //  PARTICLE HELPERS
    // =================================================================

    /**
     * Emit jump/land/double-jump particles around the player.
     * @param {number} x          Player x
     * @param {number} y          Player y
     * @param {boolean} isDouble  If true, emit a centered 10-particle burst;
     *                             otherwise split 5+5 on each side of the player
     */
    emitJumpParticles(x, y, isDouble) {
        if (isDouble) {
            this.jumpBurst.emitParticleAt(x, y, 10);
        } else {
            this.jumpBurst.emitParticleAt(x - 6, y, 5);
            this.jumpBurst.emitParticleAt(x + 6, y, 5);
        }
    }
}
