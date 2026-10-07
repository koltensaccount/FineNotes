# Clipboard and context menus

Independent branch: `feature/clipboard-context-menu`, based on upstream FineNotes 1.5.0.

A stationary finger hold (500 ms) or mouse right-click on the page opens the existing floating action UI. Empty paper offers Paste; a hold/right-click inside the selected group's bounds opens its existing menu, with Cut, Copy, Duplicate, Delete and Paste. A locked picture retains Unlock. Ordinary Pencil input never enters the new recognizer. Existing Pencil lasso/circle/shape hold behavior is preserved.

The recognizer watches touch modality explicitly and never captures pointers. Movement over 8 CSS px, a second finger anywhere, a landing pen, cancellation, blur, hiding and disposal cancel a pending hold. A pinch does not rearm it. Editable fields retain their own behavior. Right/middle mouse buttons cannot start a drawing stroke. The surface's existing touch-start cancellation now covers paper holds with any tool, so WebKit's native page callout does not claim the hold; text boxes and selection menus retain their exemptions.

## Paste routing

Clipboard PNG, JPEG and WebP use the existing image decode/downscale, vault attachment save, InsertImage history command and selection pipeline. Menu Paste centres the image at the held/right-clicked page point. Cmd/Ctrl+V uses the latest valid page interaction point; without one it uses the visible page centre. Normal image fitting and page-edge clamping still apply. A stable page ID and note/surface checks keep delayed reads out of a different note or deleted page.

FineNotes' existing window-local InkClipboard remains the only selection payload. Copy/Cut best-effort writes a plain-text session/version marker to the system clipboard; a lone image includes this marker alongside its PNG representation. A matching marker gives the actual local selection priority. An external image without that marker wins even while a local copy is fresh. The marker is a reference, not a transferable notebook/selection format: selections do not transfer to another Obsidian window or device through it. If clipboard writes/reads are denied, the established local buffer remains available; freshness cannot be inferred perfectly on a platform that exposes no clipboard data.

Clipboard reads begin directly inside the user's Paste gesture. A request gate arbitrates the asynchronous read, native paste event and keyboard fallback, so overlapping deliveries do not insert twice. A new request or document replacement invalidates older callbacks. Editable text fields retain native text paste.

## iPad fallback and limitations

When a menu Paste read is unavailable/denied and there is no usable fresh local selection, a small native Paste dialog opens. Tap and hold in its field and choose the system Paste action. If the OS supplies picture data, the same attachment pipeline places it at the captured page point. This is a user-activated native edit-menu fallback, not a permission bypass. If the OS supplies no image representation, FineNotes cannot obtain the screenshot; use the existing image import instead.

WebKit documents stricter user-gesture requirements for clipboard reads and PNG clipboard representation support: [Async Clipboard API](https://webkit.org/blog/10855/async-clipboard-api/). JPEG/WebP support here means accepting those MIME types when exposed; an OS may normalize them to PNG. Clipboard permission prompts, native edit-menu behavior, Photos screenshot copying and Pencil/finger arbitration still require physical iPad testing. No claim of physical iPad verification is made.

## Device checks

- Copy a screenshot in another app; hold empty paper and Paste. Check the attachment exists, placement is near the hold, the image is selected, and Undo/Redo removes/restores one insertion.
- Repeat with JPEG/WebP where exposed, including an annotated PDF page; save/reopen and export PDF.
- Copy a lasso group containing strokes/text/images; hold on its selection and exercise Copy, Cut, Duplicate, Delete, Paste and Undo/Redo. Copy a lone cropped image and check local versus external pastes.
- Cmd/Ctrl+V after touching different page locations; reopen a note and paste without a prior interaction, checking visible-centre placement.
- Confirm one insertion when both API and native event arrive; repeat Paste intentionally and confirm a second insertion.
- Deny clipboard access, use the native field, and inspect the result. Cancel/close the dialog or switch notes during a pending read; nothing should appear in another note.
- Pan, pinch, release before the hold threshold, cancel a pointer, switch tabs and reopen the notebook repeatedly. No delayed menu or duplicate handler should remain.
- Hold a Pencil stroke and use established draw-and-hold/lasso gestures; the new finger/mouse menu must not fire. Rest another finger while drawing.
