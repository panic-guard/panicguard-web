declare module "fili" {
  export interface BandpassParams {
    order: number;
    characteristic: string;
    Fs: number;
    Fc: number;
    BW: number;
    gain?: number;
    preGain?: boolean;
  }

  export interface EdgeFilterParams {
    order: number;
    characteristic: string;
    Fs: number;
    Fc: number;
    gain?: number;
    preGain?: boolean;
  }

  export class CalcCascades {
    constructor();
    bandpass(params: BandpassParams): unknown[];
    lowpass(params: EdgeFilterParams): unknown[];
    highpass(params: EdgeFilterParams): unknown[];
  }

  export class IirFilter {
    constructor(coeffs: unknown);
    singleStep(input: number): number;
    multiStep(input: number[], overwrite?: boolean): number[];
    filtfilt(input: number[], overwrite?: boolean): number[];
  }

  const Fili: {
    CalcCascades: typeof CalcCascades;
    IirFilter: typeof IirFilter;
  };
  export default Fili;
}
