/**
 * MediaPipe FaceLandmarker (468/478-point canonical face mesh) landmark indices.
 *
 * IMPORTANT — mirroring: landmark "left"/"right" naming below refers to the
 * SUBJECT's own left/right, not screen-left/screen-right. A front camera feed
 * is naturally mirrored on screen, so the subject's left cheek appears on the
 * right side of the video element. Draw/consume these polygons in landmark
 * space (normalized video coordinates); do not manually flip left/right.
 *
 * IMPORTANT — accuracy: these polygons are a reasonable first approximation
 * built from landmark points that are consistently documented across public
 * MediaPipe references (eye corners, mouth corners, eyebrow points, hairline
 * center, face-oval edges). They have NOT been pixel-verified against the
 * live camera feed yet. Run the app with ?debug=1, confirm the drawn ROI
 * polygons actually track forehead/cheek skin (not hairline, eyes, nostrils,
 * or mouth), and adjust the index lists here if they drift.
 */

// Single high-confidence anchor points.
export const NOSE_TIP = 1;
export const GLABELLA = 9; // between the eyebrows
export const FOREHEAD_HAIRLINE_TOP = 10;
export const CHIN = 152;

export const LEFT_EYE_OUTER = 33;
export const LEFT_EYE_INNER = 133;
export const RIGHT_EYE_OUTER = 263;
export const RIGHT_EYE_INNER = 362;

export const LEFT_EYEBROW_OUTER = 70;
export const LEFT_EYEBROW_INNER = 107;
export const RIGHT_EYEBROW_OUTER = 300;
export const RIGHT_EYEBROW_INNER = 336;

export const LEFT_NOSE_ALA = 129;
export const RIGHT_NOSE_ALA = 358;

export const LEFT_MOUTH_CORNER = 61;
export const RIGHT_MOUTH_CORNER = 291;

export const LEFT_FACE_EDGE = 234;
export const RIGHT_FACE_EDGE = 454;

/**
 * Forehead ROI is NOT this raw eyebrow-to-hairline hexagon — confirmed via
 * the debug overlay that vertices sitting right on the eyebrow landmarks
 * include eyebrow hair, not just skin. See computeForeheadPolygon() in
 * roiExtractor.ts, which insets these same anchor points before use.
 */

/** Left cheek (subject's left): under the eye, beside the nose, above the mouth. */
export const LEFT_CHEEK_POLYGON = [
  LEFT_EYE_OUTER,
  LEFT_EYE_INNER,
  LEFT_NOSE_ALA,
  LEFT_MOUTH_CORNER,
  LEFT_FACE_EDGE,
];

/** Right cheek (subject's right): mirror of the left cheek polygon. */
export const RIGHT_CHEEK_POLYGON = [
  RIGHT_EYE_OUTER,
  RIGHT_EYE_INNER,
  RIGHT_NOSE_ALA,
  RIGHT_MOUTH_CORNER,
  RIGHT_FACE_EDGE,
];

/** A small stable set of points tracked frame-to-frame for the SQI motion metric. */
export const MOTION_TRACK_SET = [
  NOSE_TIP,
  CHIN,
  FOREHEAD_HAIRLINE_TOP,
  LEFT_EYE_OUTER,
  LEFT_EYE_INNER,
  RIGHT_EYE_OUTER,
  RIGHT_EYE_INNER,
];

/** Face bounding box approximation, used for the background/exposure ROI. */
export const FACE_BBOX_SET = [
  FOREHEAD_HAIRLINE_TOP,
  CHIN,
  LEFT_FACE_EDGE,
  RIGHT_FACE_EDGE,
];
