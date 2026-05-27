// ===================================================
// Load.js — Asset preloading scene
// ===================================================
// This scene runs first and loads every asset the game needs
// (images, spritesheets, tilemaps, audio) before handing off
// to the Platformer gameplay scene. A simple progress bar
// gives the player visual feedback during loading.

class Load extends Phaser.Scene {

    constructor() {
        super("loadScene");
    }

    // ── preload: queue every asset for loading ──────────────────
    preload() {
        // --- Loading bar visuals ---
        // A simple green bar that grows as assets load
        const barW = 400, barH = 32;
        const barX = (this.scale.width - barW) / 2;
        const barY = this.scale.height / 2;

        // Background slot for the bar
        this.add.rectangle(barX, barY, barW, barH, 0x222222)
            .setOrigin(0, 0.5);
        // The fill bar that stretches with load progress
        const barFill = this.add.rectangle(barX, barY, 0, barH, 0x62dd99)
            .setOrigin(0, 0.5);
        // Label
        this.add.text(this.scale.width / 2, barY - 36, "Loading…", {
            fontFamily: "monospace", fontSize: "20px", color: "#ffffff"
        }).setOrigin(0.5);

        // Update the bar width each time a file finishes loading
        this.load.on("progress", (value) => {
            barFill.width = barW * value;
        });

        // ── Tileset spritesheet ──
        // Single atlas for all tile art and object sprites (18×18 per frame)
        this.load.spritesheet(
            "tilemap_packed",
            "assets/Tilemap/tilemap_packed.png",
            { frameWidth: 18, frameHeight: 18 }
        );

        // ── Character sprites ──
        // Separate images for the player's idle and walk poses
        this.load.image("char-idle", "assets/Characters/tile_0045.png");
        this.load.image("char-walk", "assets/Characters/tile_0046.png");

        // ── Particle images ──
        this.load.image("dirt_01", "assets/Particles/dirt_01.png");
        this.load.image("star_01", "assets/Particles/star_01.png");
        this.load.image("star_08", "assets/Particles/star_08.png");

        // ── Tilemap JSON (Tiled export format) ──
        this.load.tilemapTiledJSON("level-1", "assets/Tilemap/Level1.tmj");
        this.load.tilemapTiledJSON("level-2", "assets/Tilemap/Level2.tmj");
        this.load.tilemapTiledJSON("level-3", "assets/Tilemap/Level3.tmj");

        // ── Audio ──
        // Sound keys and source files per the DESIGN.md sound table.
        // Note: "impactWood" files are not present in the assets folder,
        // so we substitute the closest available sounds (impactPlank).
        this.load.audio("walk",    "assets/Audio/footstep_concrete_000.ogg");
        this.load.audio("jump",    "assets/Audio/impactPlank_medium_001.ogg");
        this.load.audio("land",    "assets/Audio/footstep_wood_003.ogg");
        this.load.audio("collect", "assets/Audio/impactBell_heavy_000.ogg");
        this.load.audio("death",   "assets/Audio/impactBell_heavy_002.ogg");
        this.load.audio("openDoor","assets/Audio/impactGlass_medium_001.ogg");
        this.load.audio("spring",  "assets/Audio/impactMetal_heavy_000.ogg");
        this.load.audio("ladder",  "assets/Audio/impactPlank_medium_000.ogg");
    }

    // ── create: transition to the gameplay scene ────────────────
    create() {
        // Pass initial game state to the Platformer scene:
        // level 1, zero score, 3 lives, no special abilities unlocked yet
        this.scene.start("platformerScene", {
            level: 1,
            score: 0,
            lives: 3,
            hasWallJump: false,
            hasDoubleJump: false
        });
    }
}
