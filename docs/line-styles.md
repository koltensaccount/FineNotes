# Pen line styles

Independent branch from upstream `1ebdfa3` (1.5.0), without writing presets.
A compact Pen option exposes Solid, Dashed and Dotted. Highlighter and the Shape
tool remain Solid; snapped Pen strokes retain their Pen style.

Optional `lineStyle` and partial-erase `dashOffset` travel with the existing
stroke model. Missing styles are Solid. No schema bump or rewrite of old Solid
notes: existing golden files stay exact. New optional-field fixtures accompany
the public contract extension. Copies are already deep copies; lasso movement,
cut/paste, undo/redo and recoloring preserve the optional attributes. Partial
standard erase copies the style and retains an arc-length phase origin.

Patterns apply in the shared renderer used by wet ink, dry tiles, drag previews,
thumbnails and PDF overlays, including PDF-backed vector pages. A whole stroke
has one arc-length pattern; pressure controls width, not spacing. Dots are real
filled circles. Dry geometry includes style/phase in its cache fingerprint.

Physical checks still pending: each style at fine/medium/wide widths and with
pressure; long curved writing; wet-to-dry transition and restart; snap a Pen
shape; lasso move/copy/cut/paste, undo/redo and partial erase; inspect thumbnails
and PDF exports with ordinary and PDF-backed pages. Check highlighter and Shape
tool still use Solid. Pattern phase on curved eraser fragments follows the
retained raw polyline origin; visual differences at newly cut/smoothed ends need
real-device inspection. Older FineNotes builds display Solid and may discard the
optional fields if they save the notebook. No upstream PR is opened.
