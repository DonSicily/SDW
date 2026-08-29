import React, { useRef, useEffect } from 'react';
import { StyleSheet, View, Dimensions, TouchableWithoutFeedback } from 'react-native';
import { PanGestureHandler, State } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedGestureHandler,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolate
} from 'react-native-reanimated';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAX_HEIGHT = SCREEN_HEIGHT * 0.85; // Expanded height
const MIN_HEIGHT = 120; // Collapsed height (just the handle + header)
const SNAP_POINTS = [MIN_HEIGHT, MAX_HEIGHT];

export default function BottomSheet({ children, isOpen, onClose, headerComponent }) {
  const translateY = useSharedValue(0);
  const isOpenValue = useSharedValue(isOpen ? 1 : 0);

  // Sync external isOpen state with animation
  useEffect(() => {
    if (isOpen) {
      translateY.value = withSpring(0, { damping: 20, stiffness: 90 });
      isOpenValue.value = withSpring(1);
    } else {
      translateY.value = withSpring(MAX_HEIGHT - MIN_HEIGHT, { damping: 20, stiffness: 90 });
      isOpenValue.value = withSpring(0);
    }
  }, [isOpen]);

  const gestureHandler = useAnimatedGestureHandler({
    onStart: (_, ctx) => {
      ctx.startY = translateY.value;
    },
    onActive: (event, ctx) => {
      const newY = ctx.startY + event.translationY;
      // Clamp between 0 (fully open) and MAX_HEIGHT - MIN_HEIGHT (fully closed)
      translateY.value = Math.min(Math.max(newY, 0), MAX_HEIGHT - MIN_HEIGHT);
    },
    onEnd: (event) => {
      const velocity = event.velocityY;
      const currentY = translateY.value;
      // Snap to nearest point based on velocity and position
      let snapTo;
      if (velocity > 500) {
        snapTo = MAX_HEIGHT - MIN_HEIGHT; // Close
      } else if (velocity < -500) {
        snapTo = 0; // Open
      } else {
        // Snap to the closer point
        const midPoint = (MAX_HEIGHT - MIN_HEIGHT) / 2;
        snapTo = currentY > midPoint ? MAX_HEIGHT - MIN_HEIGHT : 0;
      }

      translateY.value = withSpring(snapTo, { damping: 20, stiffness: 90 });
      const shouldBeOpen = snapTo === 0;
      isOpenValue.value = withSpring(shouldBeOpen ? 1 : 0);
      if (!shouldBeOpen && onClose) {
        runOnJS(onClose)();
      }
    },
  });

  const rBottomSheetStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: translateY.value }],
    };
  });

  const rContentOpacity = useAnimatedStyle(() => {
    return {
      opacity: interpolate(
        translateY.value,
        [0, MAX_HEIGHT - MIN_HEIGHT],
        [1, 0.6],
        Extrapolate.CLAMP
      ),
    };
  });

  return (
    <PanGestureHandler onGestureEvent={gestureHandler}>
      <Animated.View style={[styles.container, rBottomSheetStyle]}>
        <TouchableWithoutFeedback onPress={() => {}}>
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>
        </TouchableWithoutFeedback>
        
        {headerComponent && (
          <View style={styles.header}>
            {headerComponent}
          </View>
        )}

        <Animated.View style={[styles.content, rContentOpacity]}>
          {children}
        </Animated.View>
      </Animated.View>
    </PanGestureHandler>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 10,
    minHeight: MIN_HEIGHT,
    maxHeight: MAX_HEIGHT,
    overflow: 'hidden',
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#cccccc',
    borderRadius: 2,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  content: {
    flex: 1,
    padding: 20,
    paddingTop: 10,
  },
});
