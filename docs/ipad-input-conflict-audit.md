# Focused iPad input and contrast audit

Scope: current personal integration based on beta.4, limited to preset controls, color-bearing UI and competing input ownership. No notebook schema or ink color conversion changes.

## Findings

| Severity | Conflict                                                                                                 | Resolution                                                                                                                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HIGH     | Color taps only selected; editing needed hold/right-click                                                | Tap selected ID opens its exact editor, without a timing window. Existing stable color identity/editor pipeline retained.                                                                                                                        |
| HIGH     | Width activation could not edit the exact selected slot                                                  | Selected-again opens its editor, with Save targeting that ID; unselected tap selects.                                                                                                                                                            |
| HIGH     | Width sorting/deduplication changed slot order and identity                                              | Version-4 paired stable width IDs; editing replaces in position. Duplicate values remain separate. Migration retains stored order and active values.                                                                                             |
| HIGH     | Paste press bar had no outside dismissal; menu listener covered only expanded menu                       | Outside pointerdown closes press UI without prevention; Escape, keyboard popup activation, tool/page change and teardown handled. Held finger release click does not dismiss.                                                                    |
| HIGH     | Pencil-owned hold shared cancellation with touch pan/pinch; lasso Pencil hold could open legacy Paste UI | Touch callbacks preserve active circle hold; circle hold stops competing shape timer. Pencil lasso no longer starts Paste hold. Generic context adapter remains strictly touch-only; pen down starts no Paste timer.                             |
| HIGH     | Black/white controls lacked contrast on UI backgrounds                                                   | Actual-color swatches get subtle adaptive boundary and separate accent ring; picker wells also bounded. Actual-color stroke samples use small current-page surfaces. Main tool glyph/chooser chrome stays semantic foreground. No ink inversion. |
| HIGH     | Generic touch context candidate could precede selection/image/crop ownership                             | Exclude object overlays and active object/crop drags, plus circle hold. Existing object context actions remain owned by selection.                                                                                                               |
| MEDIUM   | Only three widths visible; hidden presets replaced by live value                                         | Show stored slots in a roughly five-wide native horizontal strip with reachable +; scrolling cancels activation and refresh preserves scroll.                                                                                                    |

Counts: BLOCKER 0, HIGH 7, MEDIUM 1, LOW 0. All findings fixed. These counts cover this focused audit, not a claim of exhaustive absence of device-specific conflicts.

## Relevant option inventory and ownership checks

Plugin settings: default tool/color/size, pressure-sensitive pens, Highlighter opacity, canvas behavior, custom colors, handwriting recognition/provider settings and notebook folder. Notebook settings: paper/layout and attachment folders, recordings, export folder and Companion PDF. No new gesture ownership in storage/recognition settings.

Toolbar: Pen/Fountain/Brush/Highlighter, pressure, colors, widths, line styles, Auto Shape, Scribble erase and Circle-to-Lasso; Eraser size/filter; Lasso mode/filter; Text formatting; Shapes; image/PDF insertion; audio; pages/sidebar; export and notebook settings. Each control owns its toolbar/menu target; generic Paste/multitouch excludes controls and object overlays.

Pen hold: Circle-to-Lasso gets the hold on the latest completed enclosing loop; shape hold is canceled there. Touch cannot cancel that hold and generic Paste never registers pen candidates. Pencil lasso owns selection rather than Paste. Touch hold: object interaction wins, then multitouch/pan movement invalidates generic context candidate. Mouse right-click remains separate.

Two/three fingers: existing MultiTouchDoubleTap rejects movement/pinch, extra fingers, controls and pointercancel; existing pointer controller still owns pan/pinch. Existing focused recognizer and integration tests reused, with no timing threshold changes.

Color/width scrolling: shared native pan helper cancels activation after 8 px, scroll or pointercancel. Color reorder continues to use stable IDs; widths retain user order and exact IDs (no new reorder UI added).

Outside input: document capture uses composedPath and never prevents/stops the outside action. Keyboard popup activation also closes press UI. Keyboard copy/cut/paste/Undo/Redo remains gated by editable targets/composition before notebook commands. Existing text/keyboard tests retained.

Companion PDF: existing integration tests exercise actual Undo/Redo, pasted images, styled ink, fingerprint changes and close/reopen exports; no exporter changes.

## Verification and physical limits

Focused tests cover exact selected color/width activation, in-place width edits, duplicate IDs, more than three slots and reload migration; shared scroll cancellation; actual-color paper-backed SVG previews; touch hold/no pen timer; outside dismissal and listener removal; actual enclosing-loop history withdrawal and selected ink. Existing multitouch, keyboard, clipboard and Companion PDF coverage retained. Final required suite is recorded with the release.

Browser component previews use the actual Toolbar/components/styles in a local host adapter, not the Obsidian app or a physical iPad. Physical iPad timing, Pencil/WebKit behavior, touch scrolling and theme appearance require device confirmation.
