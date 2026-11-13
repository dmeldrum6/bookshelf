# Anxiety Bookshelf

A small, glass-fronted wooden cabinet holding 200–260 miniature foam books, built in plain HTML and JavaScript. It's made for a simple, repetitive routine that eases stress: **shake it, then sort it.**
<img width="767" height="875" alt="image" src="https://github.com/user-attachments/assets/bcd5d325-a1ce-4427-bf0a-800de6ef81a5" />
<img width="770" height="881" alt="image" src="https://github.com/user-attachments/assets/72986dae-5a95-41e3-b0f2-50927aeb5422" />


## Running it

No build step is needed. Serve the folder with any static server:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Opening `index.html` directly from disk also works.

## How to use it

| Action | How |
| --- | --- |
| Shake | Grab the cabinet and jiggle it, press <kbd>Space</kbd>, click **Shake**, or shake your phone after tapping **Use phone motion** |
| Knock | Tap the wooden frame, or press <kbd>←</kbd> / <kbd>→</kbd> |
| Open or close the glass | Tap the brass knob, click **Open door**, or press <kbd>O</kbd> |
| Sort by hand | With the door open, pick up a book and drop it on any shelf. A book you place stands upright and slides into the nearest gap. Tapping a fallen book stands it back up where it is. |
| Sort automatically | **Straighten** keeps each book on its shelf, **Rainbow** sorts every book by colour, and **By height** lines each shelf up from tallest to shortest |
| Spill | Shake hard with the door open and books tumble out onto the desk. Pick them up from the desk and drop them back on a shelf. The auto-sort buttons put them back too. |
| Book count | Use the slider to pick 200–260 books, which starts a fresh shelf |

The counter at the top shows how many books are standing. Once every book is upright again after a real shake, a soft chime plays.

## How it works

- **Physics:** [Matter.js](https://brm.io/matter-js/) 0.20.0 (MIT), included in `vendor/` so the page works offline. Each book is a rigid body, and the shelves are fixed walls.
- **Shaking:** the simulation runs in the cabinet's own frame of reference. When you move the cabinet, it follows your hand on a springy "grip". The opposite of its acceleration is added to gravity, which is what the books inside would feel. Phone shakes come from `devicemotion`.
- **The desk:** spilled books move into a second physics world that doesn't shake, so they stay put on the desk while the cabinet moves.
- **Saving:** your shelf is saved in `localStorage` every few seconds and when you leave the page. Each book's look comes from a seed, so saving a book only takes its seed, its position, its angle and whether it's on the desk. That's about 35 bytes per book, or under 10 KB for a full shelf.
- **Graphics:** a single `<canvas>`. The wood grain, shelves and lighting are drawn once at each size and cached. The books and the hinged glass door are drawn every frame.
- **Sound:** generated with the Web Audio API, so there are no audio files. You hear woody taps when books collide, a glass "tink", knocks and a chime.

## Files

```
index.html          page shell and controls
css/style.css       layout, light and dark themes
js/main.js          physics, drawing, input, sound
vendor/matter.min.js
```
