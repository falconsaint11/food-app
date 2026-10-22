import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Palette } from "@/constants/theme";

type StarRatingInputProps = {
  value: number;

  onChange: (value: number) => void;
};

export function getRatingLabel(value: number) {
  if (value === 0.5) return "Horrible";

  if (value === 1) return "Awful";

  if (value === 1.5) return "Bad";

  if (value === 2) return "Below Average";

  if (value === 2.5) return "Mid";

  if (value === 3) return "Decent";

  if (value === 3.5) return "Good";

  if (value === 4) return "Great";

  if (value === 4.5) return "Amazing";

  if (value === 5) return "Perfection";

  return "Tap or drag to rate";
}

// Five stars rated in half steps by tapping or dragging across them.
export function StarRatingInput({ value, onChange }: StarRatingInputProps) {
  const [ratingWidth, setRatingWidth] = useState(0);

  const [ratingLeftX, setRatingLeftX] = useState(0);

  const ratingRowRef = useRef<View>(null);

  function updateRatingFromPageX(pageX: number) {
    if (ratingWidth <= 0) {
      return;
    }

    const relativeX = pageX - ratingLeftX;

    const clampedX = Math.max(0, Math.min(relativeX, ratingWidth));

    const rawRating = (clampedX / ratingWidth) * 5;

    const snappedRating = Math.max(
      0.5,

      Math.min(5, Math.ceil(rawRating * 2) / 2),
    );

    onChange(snappedRating);
  }

  function measureRatingRow() {
    ratingRowRef.current?.measureInWindow((x) => {
      setRatingLeftX(x);
    });
  }

  return (
    <View style={styles.ratingSection}>
      <View
        ref={ratingRowRef}
        style={styles.ratingTouchArea}
        onLayout={(event) => {
          setRatingWidth(event.nativeEvent.layout.width);

          requestAnimationFrame(measureRatingRow);
        }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(event) => {
          updateRatingFromPageX(event.nativeEvent.pageX);
        }}
        onResponderMove={(event) => {
          updateRatingFromPageX(event.nativeEvent.pageX);
        }}
      >
        {[1, 2, 3, 4, 5].map((star) => {
          const starFill = value - (star - 1);

          const fillWidth = starFill >= 1 ? 50 : starFill >= 0.5 ? 25 : 0;

          return (
            <View key={star} style={styles.starContainer} pointerEvents="none">
              <Text style={[styles.star, styles.emptyStar]}>★</Text>

              <View
                style={[
                  styles.starFillClip,

                  {
                    width: fillWidth,
                  },
                ]}
                pointerEvents="none"
              >
                <Text style={[styles.star, styles.filledStar]}>★</Text>
              </View>
            </View>
          );
        })}
      </View>

      <Text style={styles.dragHint}>Tap or drag across the stars</Text>

      <View style={styles.ratingSummary}>
        <Text style={styles.ratingNumber}>
          {value > 0 ? value.toFixed(1) : "—"}
        </Text>

        <Text style={styles.ratingLabel}>{getRatingLabel(value)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ratingSection: {
    marginBottom: 22,
  },

  ratingTouchArea: {
    flexDirection: "row",

    alignSelf: "flex-start",

    alignItems: "center",

    width: 250,

    height: 52,
  },

  starContainer: {
    width: 50,

    height: 52,

    position: "relative",

    justifyContent: "center",
  },

  star: {
    color: Palette.text,
    fontSize: 42,

    lineHeight: 48,
  },

  emptyStar: {
    color: Palette.borderStrong,

    position: "absolute",

    left: 0,

    top: 2,
  },

  starFillClip: {
    position: "absolute",

    left: 0,

    top: 2,

    height: 48,

    overflow: "hidden",
  },

  filledStar: {
    color: Palette.accent,

    position: "absolute",

    left: 0,

    top: 0,

    width: 50,
  },

  dragHint: {
    fontSize: 12,

    color: Palette.textMuted,

    marginTop: 4,
  },

  ratingSummary: {
    marginTop: 12,

    flexDirection: "row",

    alignItems: "baseline",
  },

  ratingNumber: {
    color: Palette.accent,
    fontSize: 26,

    fontWeight: "700",

    minWidth: 52,
  },

  ratingLabel: {
    fontSize: 16,

    fontWeight: "600",

    color: Palette.textSecondary,

    marginLeft: 8,
  },
});
