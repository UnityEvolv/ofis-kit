---
'@unityevolv/ofiskit-realtime-core': minor
---

Nudge a colleague (UO-277) and follow a colleague (UO-278). New events `person:nudge`, `follow:request`, `follow:accept`, `follow:decline`, `follow:stop` and `follow:remove`, sending `nudge:received`, `follow:requested`, `follow:resolved`, `follow:state`, `follow:moved`, `follow:held` and `follow:ended`. A nudge is delivered now to somebody available, held for somebody in a call or a meeting, and refused for do not disturb, away and offline; nothing is stored. Following is asked for, never chained, at most five followers per person, and a declined asker waits ten minutes. The limits are the engine options `nudge` and `follow` (defaults in `NUDGE_DEFAULTS` and `FOLLOW_DEFAULTS`), and the snapshot's `you.follow` carries your own side of following.
