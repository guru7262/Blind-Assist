import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';

const CAPTURE_INTERVAL_MS = 3500;
const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '';
const RIME_API_KEY = process.env.EXPO_PUBLIC_RIME_API_KEY ?? '';

type SpeechCategory = 'NORMAL' | 'IMPORTANT' | 'URGENT';

function normalizeSceneText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function buildDemoScene(previousScene: string | null): string {
  const previous = previousScene ? normalizeSceneText(previousScene).toLowerCase() : '';

  if (!previous) {
    return 'There is a desk ahead with a laptop on it.';
  }

  if (previous.includes('desk')) {
    return 'A chair is directly ahead and may block the path.';
  }

  if (previous.includes('chair')) {
    return 'The path ahead is clear.';
  }

  if (previous.includes('path')) {
    return 'A person has entered the room from your left.';
  }

  return 'There is a doorway ahead and a clear path through it.';
}

function isNoUpdateResponse(value: string): boolean {
  return value.trim().toUpperCase() === 'NO_UPDATE';
}

function buildGeminiPrompt(previousScene: string | null): string {
  return `You are a visual assistant for a visually impaired person.

Analyze the current camera frame and describe only information that is useful for understanding the person's immediate surroundings.

Prioritize:
1. Potential obstacles or hazards
2. People and their movement
3. Doors, entrances and exits
4. Walkable paths
5. Important objects
6. Meaningful changes in the environment

Do not describe decorative or irrelevant details.
Keep the response concise and natural because it will be spoken aloud.
Maximum 25 words.

If nothing meaningful has changed compared with the previous scene, return exactly:
NO_UPDATE

Previous scene: ${previousScene ?? 'None'}`;
}

async function analyzeSceneWithGemini(
  imageBase64: string,
  previousScene: string | null,
): Promise<string> {
  if (!GEMINI_API_KEY) {
    return buildDemoScene(previousScene);
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: buildGeminiPrompt(previousScene) },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: imageBase64,
                },
              },
            ],
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini request failed with status: ${response.status}`);
  }

  const data = await response.json();
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text ?? '')
      .join('')
      .trim() ?? '';

  if (!text) {
    return 'NO_UPDATE';
  }

  return text.replace(/```/g, '').trim();
}

async function getRimeAudioUrl(text: string): Promise<string | null> {
  if (!RIME_API_KEY) {
    return null;
  }

  const response = await fetch('https://users.rime.ai/v1/rime-tts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RIME_API_KEY}`,
    },
    body: JSON.stringify({
      text,
      model: 'mist',
      speaker: 'mist',
      format: 'wav',
    }),
  });

  if (!response.ok) {
    throw new Error(`Rime request failed with status: ${response.status}`);
  }

  const data = await response.json();
  return data?.audioUrl ?? data?.audio_url ?? data?.output?.audio_url ?? null;
}

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [previousScene, setPreviousScene] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('Preparing camera');
  const cameraRef = useRef<CameraView | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopCurrentAudio = useCallback(async () => {
    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }
  }, []);

  const speakText = useCallback(
    async (fullText: string) => {
      const text = normalizeSceneText(fullText);
      if (!text) {
        return;
      }

      await stopCurrentAudio();

      setStatusText(`Speaking: ${text}`);

      if (!RIME_API_KEY) {
        return;
      }

      try {
        const audioUrl = await getRimeAudioUrl(text);

        if (!audioUrl) {
          return;
        }

        const { sound } = await Audio.Sound.createAsync(
          { uri: audioUrl },
          { shouldPlay: true, isLooping: false },
        );

        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((playbackStatus) => {
          if (playbackStatus.isLoaded && playbackStatus.didJustFinish) {
            sound.unloadAsync();
            soundRef.current = null;
          }
        });
      } catch (error) {
        console.warn('Unable to synthesize spoken output with Rime:', error);
      }
    },
    [stopCurrentAudio],
  );

  useEffect(() => {
    Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      shouldDuckAndroid: true,
    });
  }, []);

  useEffect(() => {
    if (!permission) {
      return;
    }

    if (!permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  const captureAndAnalyze = useCallback(async () => {
    if (!cameraRef.current || isProcessing) {
      return;
    }

    setIsProcessing(true);
    setStatusText('Capturing frame');

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.35,
        base64: true,
        skipProcessing: false,
      });

      if (!photo?.base64) {
        throw new Error('No base64 image returned by the camera');
      }

      const sceneDescription = await analyzeSceneWithGemini(photo.base64, previousScene);
      const trimmedDescription = normalizeSceneText(sceneDescription);

      if (!trimmedDescription || isNoUpdateResponse(trimmedDescription)) {
        setStatusText('No meaningful update');
        return;
      }

      setPreviousScene(trimmedDescription);
      await speakText(trimmedDescription);
      setStatusText(`Scene updated: ${trimmedDescription}`);
    } catch (error) {
      console.warn('Frame processing failed:', error);
      setStatusText('Frame skipped due to an error');
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, previousScene, speakText]);

  useEffect(() => {
    if (!permission?.granted || !cameraReady) {
      return;
    }

    let cancelled = false;

    const scheduleNextCapture = () => {
      if (cancelled) {
        return;
      }

      timeoutRef.current = setTimeout(async () => {
        if (cancelled) {
          return;
        }

        await captureAndAnalyze();

        if (!cancelled) {
          scheduleNextCapture();
        }
      }, CAPTURE_INTERVAL_MS);
    };

    scheduleNextCapture();

    return () => {
      cancelled = true;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [cameraReady, captureAndAnalyze, permission?.granted]);

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>Camera permission is required.</Text>
        <Text style={styles.action} onPress={() => requestPermission()}>
          Allow camera access
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        facing="back"
        style={styles.camera}
        onCameraReady={() => setCameraReady(true)}
      />

      <View pointerEvents="none" style={styles.overlay} />

      <View style={styles.statusBar}>
        <Text style={styles.statusText}>{statusText}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  camera: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000',
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  statusBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 28,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
  },
  statusText: {
    color: '#f8fafc',
    fontSize: 14,
    textAlign: 'center',
  },
  message: {
    color: '#fff',
    fontSize: 20,
    marginBottom: 16,
  },
  action: {
    color: '#7dd3fc',
    fontSize: 16,
    textDecorationLine: 'underline',
  },
});
