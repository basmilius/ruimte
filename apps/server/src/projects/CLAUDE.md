# Project, drawing and diagram files

The invariants of this folder. The repository root's `CLAUDE.md` has the map, the wire protocol and the rules that hold everywhere.

- A drawing or diagram file follows its view between `.ruimte/<kind>s/` and `.ruimte/private/<kind>s/`, so a private drawing never sits in git either.
- A project file whose `version` is newer than this build is refused (`project-too-new`) and left untouched, never set aside as `.corrupt`. Same for a drawing and a diagram.
