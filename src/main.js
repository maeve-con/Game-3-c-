// ============================================
// main.js — Game entry point and Phaser config
// ============================================
// This file creates the Phaser.Game instance with all configuration.
// Scenes are registered here and started in order.

// Game configuration object
const config = {
    // Rendering settings — pixelArt mode uses nearest-neighbor scaling
    // so pixel-art sprites stay crisp when the canvas is resized
    type: Phaser.AUTO,
    pixelArt: true,

    // Logical canvas dimensions; Phaser's Scale Manager will
    // fit this into the browser window while preserving aspect ratio.
    // "parent" attaches the canvas to the #phaser-game div in index.html.
    parent: "phaser-game",
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 960,
        height: 540
    },

    // Arcade physics — the only physics engine we need for a 2D platformer
    physics: {
        default: "arcade",
        arcade: {
            gravity: { y: 600 },  // 600 px/s² downward, per DESIGN.md
            debug: false
        }
    },

    // Scene list — Phaser instantiates and starts them in array order.
    // Load runs first (preloads assets), then Platformer (main gameplay).
    scene: [Load, Platformer]
};

// Create the game instance, attaching it to the #phaser-game div in index.html
const game = new Phaser.Game(config);
