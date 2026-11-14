import { useCallback, useEffect, useRef, useState } from "react";
import "./AnimatedSplashScreen.css";
 
type Props = {
  onFinish: () => void;
};
 
const VIDEO_URL = `${import.meta.env.BASE_URL}videos/kshurak_splash.mp4`;
 
const LAST_FRAME_HOLD_MS = 1000;
const MAX_SPLASH_DURATION_MS = 12000;
 
export default function AnimatedSplashScreen({ onFinish }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onFinishRef = useRef(onFinish);
  const finishedRef = useRef(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
 
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoError, setVideoError] = useState(false);
 
  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);
 
  const finishSplash = useCallback(() => {
    if (finishedRef.current) return;
 
    finishedRef.current = true;
 
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
 
    onFinishRef.current();
  }, []);
 
  const handleVideoEnd = useCallback(() => {
    if (finishedRef.current || holdTimerRef.current !== null) return;
 
    holdTimerRef.current = setTimeout(() => {
      finishSplash();
    }, LAST_FRAME_HOLD_MS);
  }, [finishSplash]);
 
  const handleVideoError = useCallback(() => {
    if (finishedRef.current) return;
 
    console.error("KSHURAK splash video failed:", VIDEO_URL);
 
    setVideoError(true);
  }, []);
 
  useEffect(() => {
    const video = videoRef.current;
 
    if (!video) return;
 
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
 
    // Allow browser-native autoplay first.
    // Avoid treating interrupted play() promises as video failure.
 
    const startupTimer = window.setTimeout(() => {
      if (video.paused && !finishedRef.current) {
        console.warn("Splash autoplay did not start.");
 
        // Attempt playback once after browser initialization.
        video.play().catch((error) => {
          console.warn("Splash playback unavailable:", error);
          setVideoError(true);
        });
      }
    }, 1000);
 
    const safetyTimer = window.setTimeout(() => {
      if (!finishedRef.current) {
        finishSplash();
      }
    }, MAX_SPLASH_DURATION_MS);
 
    return () => {
      clearTimeout(startupTimer);
      clearTimeout(safetyTimer);
 
      if (holdTimerRef.current !== null) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
    };
  }, [finishSplash]);
 
  return (
    <div className="ksh-splash">
      <video
        ref={videoRef}
        className={`ksh-splash-video ${
          isPlaying ? "ksh-splash-video-ready" : ""
        }`}
        src={VIDEO_URL}
        autoPlay
        muted
        playsInline
        preload="auto"
        loop={false}
        controls={false}
        disablePictureInPicture
        onPlaying={() => {
          setIsPlaying(true);
          setVideoError(false);
        }}
        onEnded={handleVideoEnd}
        onError={handleVideoError}
      />
 
      {!isPlaying && !videoError && (
        <div className="ksh-splash-loading">
          <div className="ksh-splash-spinner" />
        </div>
      )}
 
      {videoError && (
        <div className="ksh-splash-error">
          <p>Welcome to KSHURAK</p>
          <button type="button" onClick={finishSplash}>
            Continue to Login
          </button>
        </div>
      )}
    </div>
  );
}