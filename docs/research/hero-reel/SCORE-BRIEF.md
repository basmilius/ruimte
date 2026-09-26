# Scoring a film

Every film gets an original score, composed in code with Web Audio and rendered offline. No samples, no
library music. Add to your `Film.define({...})`:

```js
cuts: [4, 14, 24, ...],          // optional: your cut times in seconds, marked in the loudness picture
score(kit) {
    const drums = kit.bus({ gain: 0.9, send: 0.05 });
    const keys = kit.bus({ gain: 0.6, send: 0.3, pan: -0.1 });
    keys.sidechain(kickTimes, 0.5);             // pump the pads with the kick
    keys.automate([[0, 0], [2, 0.6], [58, 0.6], [60, 0]]);
    kit.kick(drums, time);  kit.snare(drums, time);  kit.hat(drums, time, { open: true });
    kit.bass(bassBus, time, 'A1', 0.4);
    kit.pad(keys, time, ['A3', 'C4', 'E4', 'G4'], 4);   // a chord held 4 s
    kit.pluck(keys, time, 'E5', { length: 0.2 });
    kit.bell(keys, time, 'A5');  kit.riser(fx, time, 2);  kit.impact(fx, time);  kit.tick(fx, time);
}
```

The kit is `score.js` (read it: every instrument has options). `kit.ac` is the OfflineAudioContext if you need
your own nodes; connect them to a bus's `input`.

`node film-score.mjs <id>` renders `renders/<id>.wav`, a loudness picture `renders/<id>-score.png` (seconds on
the x axis, your cuts in amber) and `renders/<id>-music.mp4` (your rendered film with the score).

You cannot listen, so compose with music theory and the picture:
- Pick a key and a tempo that fit the film (a calm film around 90 to 100 BPM with long pads and sparse
  plucks; a rhythm film exactly at its edit tempo). Write a real chord progression (for example i, VI, III, VII
  in a minor key, or a IV, I, V, vi lift for the ending), voice-led, not random notes.
- Structure follows the edit: an intro under the wordmark, a build, a stop or breakdown where the film stops,
  a lift for the ending, and a clean resolved last chord under the end card that decays out before 60 s.
- Hit the picture: a bell or pluck on the wordmark dot, ticks under clicks and checks (subtle), a riser into
  big reveals, an impact on the end card. Land changes on cuts.
- Mix: keep the peak under 0.95 (the tool prints it), leave room for the picture (music under a product film,
  not a club track), kick and bass not louder than everything else, pads sidechained if there is a kick.
- Check the loudness picture: the dynamic arc should follow the story, with no sudden jumps you did not mean.
