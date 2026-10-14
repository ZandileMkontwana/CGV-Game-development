/**
 * main.js — entry point.
 * Wires the Game class to the DOM and kicks everything off.
 */
import Game from './core/Game.js';
import './ui/ui.css';

const container = document.getElementById('game-container');
const game = new Game(container);
game.start();
