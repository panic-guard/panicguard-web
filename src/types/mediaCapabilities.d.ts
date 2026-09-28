export {};

/**
 * Extended (non-standard-but-real) camera capabilities used for exposure /
 * white-balance locking. Missing from this TS lib's lib.dom.d.ts.
 */
declare global {
  interface MediaTrackCapabilities {
    exposureMode?: string[];
    whiteBalanceMode?: string[];
    exposureTime?: DoubleRange;
    colorTemperature?: DoubleRange;
  }

  interface MediaTrackConstraintSet {
    exposureMode?: ConstrainDOMString;
    whiteBalanceMode?: ConstrainDOMString;
    exposureTime?: ConstrainDouble;
    colorTemperature?: ConstrainDouble;
  }

  interface MediaTrackSettings {
    exposureMode?: string;
    exposureTime?: number;
    colorTemperature?: number;
  }
}
