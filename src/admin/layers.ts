/**
 * The dashboard's floating layers, in one place.
 *
 * Every one of these is `fixed` and portalled to the body, so the order they
 * paint in is decided by a single number rather than by where they sit in the
 * tree. Written down here because two of them open on top of each other: the
 * social-icon bubble opens a colour chart, and a chart painted under the bubble
 * it belongs to is unusable. The chart is therefore always the topmost thing on
 * screen, and every other overlay keeps the layer it had.
 */
export const LAYER = {
  /** Slide-over editors, image and file fields, the block palette. */
  panel: 80,
  /** Confirm dialogs, the countdown setup, the media lightbox. */
  dialog: 120,
  /** The social-icon bubble — a popover that opens from a row in the panel. */
  popover: 200,
  /**
   * The colour chart. Above everything, because it can be opened from inside
   * any of the layers above and must never be tucked behind its own trigger.
   */
  color: 400,
} as const;
