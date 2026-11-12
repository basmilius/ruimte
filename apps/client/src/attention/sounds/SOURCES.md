# Notification sounds

`scripts/make-sounds.ts` writes every file here. Each pack is a folder with the same five motifs: `rise`, `chime`, `fall`, `knock` and `trio`.

`bar`, `glass`, `wood`, `string` and `air` are synthesized by the script and hold no recording.

The other five play the motifs on recordings from the instrument pack AfterMotion builds, all CC0-1.0:

| Pack | Instrument | Source |
| --- | --- | --- |
| `grand` | Steinway B grand piano | Versilian Community Sample Library (VCSL), https://github.com/sgossner/VCSL |
| `felt` | Osiris upright piano | Osiris Piano (Karoryfer with Versilian), https://github.com/sfzinstruments/Osiris_Piano |
| `nylon` | Spanish classical guitar | FreePats, https://freepats.zenvoid.org/Guitar/acoustic-guitar.html |
| `steel` | Martin HD28 steel-string guitar by Jeff Learman | Discord SFZ GM Bank, https://github.com/sfzinstruments/Discord-SFZ-GM-Bank |
| `duo` | The grand with the nylon guitar under it | VCSL and FreePats, as above |
