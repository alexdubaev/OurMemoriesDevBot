# Consolidated acceptance matrix

**Scope/status:** MM-0…MM-4 complete. Historical import HI-0…HI-4 is `DEFERRED_POST_MVP` and is not an MVP release gate. The historical requirements below remain post-MVP acceptance criteria; they are not claims of implemented behavior. See [the post-MVP roadmap](POST_MVP_MAX_HISTORICAL_IMPORT.md).

## Mixed-media stage

| ID | Requirement |
|---|---|
| MX-01 | One Memory can contain ordered photo+video attachments |
| MX-02 | New mixed Memory uses additive neutral `media` kind |
| MX-03 | Legacy photo/video/note/voice continue |
| MX-04 | Max 10 total mixed attachments |
| MX-05 | One caption/author/like/unread/seen per Memory |
| MX-06 | Carousel preserves attachment order |
| MX-07 | Horizontal swipe does not break vertical Feed scroll |
| MX-08 | Video pauses when leaving active slide |
| MX-09 | No multiple simultaneous carousel video playback |
| MX-10 | Active slide readiness integrates with B6 seen |
| MX-11 | Fullscreen/detail opens current item |
| MX-12 | Protected media semantics preserved |
| MX-13 | `firstPublishedAt` immutable first publish time |
| MX-14 | `sourcePublishedAt` preserved source time |
| MX-15 | `occurredAt` remains editable event time |
| MX-16 | MAX live mixed message becomes one Memory |
| MX-17 | Duplicate MAX delivery does not duplicate Memory |
| MX-18 | Web mixed composer publishes one Memory |
| MX-19 | Six themes + mobile widths remain valid |
| MX-20 | No production deploy during implementation tasks |

## Historical import stage

| ID | Requirement |
|---|---|
| HI-01 | Explicit owner-authorized import |
| HI-02 | Explicit target family |
| HI-03 | Explicit target child/context |
| HI-04 | Provider history paginated safely |
| HI-05 | Source post provider ID durable |
| HI-06 | Original MAX timestamp preserved |
| HI-07 | One MAX post = one Memory |
| HI-08 | Mixed post order exact |
| HI-09 | Rerun creates zero duplicates |
| HI-10 | Existing live-captured post not duplicated |
| HI-11 | Import resumes after interruption |
| HI-12 | Bounded provider/media concurrency |
| HI-13 | Rate-limit/transient errors retried safely |
| HI-14 | Permanent media error not silently omitted |
| HI-15 | Progress/status visible in UI |
| HI-16 | User can leave/reopen progress UI |
| HI-17 | No provider secrets client-side |
| HI-18 | Viewer/non-authorized user denied |
| HI-19 | Feed carousel displays imported mixed posts |
| HI-20 | No production deploy until dedicated release task |
