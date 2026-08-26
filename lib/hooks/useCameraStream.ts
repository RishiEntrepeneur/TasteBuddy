"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Rear-camera access for the AR viewer.
 *
 * `getUserMedia` fails in a lot of ordinary ways on phones — a denied prompt,
 * an insecure origin, a camera already held by another tab, an in-app browser
 * with no camera entitlement at all. Each of those needs different copy for the
 * diner, so they are modelled as distinct states rather than one boolean.
 */

export type CameraStatus =
  | "idle"
  | "requesting"
  | "granted"
  | "denied"
  | "unsupported"
  | "insecure"
  | "unavailable";

export interface UseCameraStreamResult {
  status: CameraStatus;
  stream: MediaStream | null;
  errorMessage: string | null;
  request: () => Promise<void>;
  stop: () => void;
}

const CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    // Rear camera, but `ideal` rather than `exact` so laptops and front-only
    // devices still get a usable preview instead of an OverconstrainedError.
    facingMode: { ideal: "environment" },
    // 720p is plenty for the tracker and much kinder to thermals than 1080p.
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 30 },
  },
};

export function useCameraStream(): UseCameraStreamResult {
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
    setStatus("idle");
  }, []);

  const request = useCallback(async () => {
    if (typeof navigator === "undefined") return;

    // Camera access is gated on a secure context everywhere. Localhost counts.
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setStatus("insecure");
      setErrorMessage(
        "AR needs a secure connection. Open TasteBuddy over HTTPS and try again.",
      );
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      setErrorMessage(
        "This browser cannot open the camera. Try Safari on iOS or Chrome on Android.",
      );
      return;
    }

    setStatus("requesting");
    setErrorMessage(null);

    try {
      const media = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
      streamRef.current = media;
      setStream(media);
      setStatus("granted");
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";

      switch (name) {
        case "NotAllowedError":
        case "SecurityError":
          setStatus("denied");
          setErrorMessage(
            "Camera access was blocked. Enable it for this site in your browser settings, then reopen AR view.",
          );
          break;
        case "NotFoundError":
        case "OverconstrainedError":
          setStatus("unavailable");
          setErrorMessage("No usable camera was found on this device.");
          break;
        case "NotReadableError":
          setStatus("unavailable");
          setErrorMessage(
            "The camera is already in use by another app or tab. Close it and try again.",
          );
          break;
        default:
          setStatus("unavailable");
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "The camera could not be started.",
          );
      }
    }
  }, []);

  // Always release the camera on unmount — a live rear camera drains a phone
  // fast and leaves the privacy indicator lit.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  // Some Android browsers end the track when the app is backgrounded; reflect
  // that instead of showing a frozen frame.
  useEffect(() => {
    if (!stream) return;
    const [track] = stream.getVideoTracks();
    if (!track) return;

    const handleEnded = () => {
      setStatus("unavailable");
      setErrorMessage("The camera stream ended. Tap to restart AR view.");
    };

    track.addEventListener("ended", handleEnded);
    return () => track.removeEventListener("ended", handleEnded);
  }, [stream]);

  return { status, stream, errorMessage, request, stop };
}
