
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  StatusBar,
  StyleSheet,
  View,
} from "react-native";

import {
  VideoView,
  useVideoPlayer,
} from "expo-video";

type Props = {
  onFinish: () => void;
};

const SPLASH_VIDEO = require(
  "../../../assets/videos/kshurak_splash.mp4"
);

export default function AnimatedSplashScreen({
  onFinish,
}: Props) {
  const finished = useRef(false);
  const [playedToEnd, setPlayedToEnd] = useState(false);

  const player = useVideoPlayer(SPLASH_VIDEO, (video) => {
    video.loop = false;
    video.muted = true;
  });

  const finish = useCallback(() => {
    if (finished.current) return;

    finished.current = true;
    onFinish();
  }, [onFinish]);

  useEffect(() => {
    const subscription = player.addListener(
      "playToEnd",
      () => setPlayedToEnd(true)
    );

    player.play();

    return () => subscription.remove();
  }, [player]);

  useEffect(() => {
    if (playedToEnd) finish();
  }, [playedToEnd, finish]);

  // Fallback only if video playback fails or never completes.
  useEffect(() => {
    const timeout = setTimeout(finish, 9000);
    return () => clearTimeout(timeout);
  }, [finish]);

  return (
    <View style={styles.container}>
      <StatusBar
        barStyle="light-content"
      />

      <VideoView
        player={player}
        style={styles.video}
        contentFit="contain"
        nativeControls={false}
        allowsPictureInPicture={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  video: {
    width: "100%",
    height: "100%",
    backgroundColor: "#000000",
  },
});
