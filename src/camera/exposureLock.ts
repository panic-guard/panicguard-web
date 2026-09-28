export interface ExposureLockResult {
  locked: boolean;
  details: string;
}

/**
 * Best-effort exposure/white-balance lock (spec §3): most webcams and
 * laptop/phone front cameras don't expose manual exposure/WB controls at
 * all, so this is expected to no-op on a lot of hardware — that's fine,
 * SQI's own snr_db gate is the real backstop either way. Where it IS
 * supported, continuous auto-exposure/auto-WB "hunting" injects a small
 * brightness/color-temperature step on every adjustment, which shows up
 * directly as broadband noise in the POS color-channel signal (this is
 * exactly the failure pattern of SQI starting clean and then oscillating
 * true/false over time as the camera keeps re-adjusting).
 *
 * Waits `warmupMs` first so autoexposure/AWB can converge on a reasonable
 * baseline before locking to whatever it settled on, per spec.
 */
export async function tryLockExposureAndWhiteBalance(
  track: MediaStreamTrack,
  warmupMs = 3000,
): Promise<ExposureLockResult> {
  if (typeof track.getCapabilities !== "function") {
    return { locked: false, details: "getCapabilities() unsupported on this browser" };
  }

  const capabilities = track.getCapabilities();
  const supportsExposure = Array.isArray(capabilities.exposureMode) && capabilities.exposureMode.includes("manual");
  const supportsWhiteBalance =
    Array.isArray(capabilities.whiteBalanceMode) && capabilities.whiteBalanceMode.includes("manual");

  if (!supportsExposure && !supportsWhiteBalance) {
    return { locked: false, details: "camera does not support manual exposure or white-balance" };
  }

  await new Promise((resolve) => setTimeout(resolve, warmupMs));

  const settings = track.getSettings();
  const advanced: MediaTrackConstraintSet[] = [];
  const lockedParts: string[] = [];

  if (supportsExposure) {
    const constraint: MediaTrackConstraintSet = { exposureMode: "manual" };
    if (typeof settings.exposureTime === "number") constraint.exposureTime = settings.exposureTime;
    advanced.push(constraint);
    lockedParts.push("exposure");
  }
  if (supportsWhiteBalance) {
    const constraint: MediaTrackConstraintSet = { whiteBalanceMode: "manual" };
    if (typeof settings.colorTemperature === "number") constraint.colorTemperature = settings.colorTemperature;
    advanced.push(constraint);
    lockedParts.push("white-balance");
  }

  try {
    await track.applyConstraints({ advanced });
    return { locked: true, details: `locked: ${lockedParts.join(", ")}` };
  } catch (err) {
    return { locked: false, details: `applyConstraints failed: ${(err as Error).message}` };
  }
}
