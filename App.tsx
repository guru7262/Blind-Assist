import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';

const CAPTURE_INTERVAL_MS = 5000;
const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '';

function normalizeSceneText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isNoUpdateResponse(value: string): boolean {
  return value.trim().toUpperCase() === 'NO_UPDATE';
}

function buildGeminiPrompt(previousScene: string | null): string {
  return `Analyze this camera frame for a visually impaired person. Describe obstacles, people, doors, paths, and important objects. Be concise (max 20 words). If nothing changed, reply: NO_UPDATE

Previous: ${previousScene ?? 'None'}`;
}

async function analyzeSceneWithGemini(
  imageBase64: string,
  previousScene: string | null,
): Promise<string> {
  console.log('=== GEMINI API CALL ===');

  if (!GEMINI_API_KEY) {
    console.error('ERROR: No API key in .env');
    return 'ERROR: No API key';
  }

  try {
    const modelName = 'gemini-3.6-flash';
    const url = `https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;

    console.log('Model:', modelName);
    console.log('Image size:', imageBase64.length, 'bytes');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    });

    console.log('Response status:', response.status);

    if (!response.ok) {
      const text = await response.text();
      console.error('Gemini error:', response.status, text.substring(0, 100));
      return `ERROR: Status ${response.status}`;
    }

    const data = await response.json();
    const result = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? 'NO_UPDATE';
    console.log('Gemini result:', result);
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Exception:', msg);
    return `ERROR: ${msg}`;
  }
}

async function speakText(text: string): Promise<void> {
  try {
    console.log('Speaking:', text);
    
    // Stop any existing speech
    await Speech.stop();
    
    // Use native TTS with max volume
    await Speech.speak(text, {
      language: 'en',
      pitch: 1.0,
      rate: 0.9,
      volume: 1.0,  // Max volume (0.0 to 1.0)
      onDone: () => console.log('Speech finished'),
      onError: (error) => console.warn('Speech error:', error),
    });
  } catch (error) {
    console.warn('TTS failed:', error);
  }
}

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [previousScene, setPreviousScene] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('Initializing...');
  const cameraRef = useRef<CameraView | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Setup speech
  useEffect(() => {
    Speech.getAvailableVoicesAsync()
      .then((voices) => console.log(`✓ ${voices.length} voices available`))
      .catch((e) => console.warn('Speech init failed:', e));
  }, []);

  // Request camera permission
  useEffect(() => {
    if (!permission) return;
    if (!permission.granted && permission.canAskAgain) {
      console.log('Requesting camera permission');
      requestPermission();
    }
  }, [permission, requestPermission]);

  const captureAndAnalyze = useCallback(async () => {
    if (!cameraRef.current || isProcessing) return;

    setIsProcessing(true);
    console.log('📸 Capturing frame...');

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.5,
        base64: true,
        skipProcessing: false,
      });

      if (!photo?.base64) throw new Error('No base64');
      console.log(`✓ Frame captured: ${Math.round(photo.base64.length / 1024)}KB`);

      setStatusText('Analyzing...');

      const result = await analyzeSceneWithGemini(photo.base64, previousScene);

      if (result.includes('ERROR')) {
        console.error('Analysis error:', result);
        setStatusText('❌ ' + result);
        return;
      }

      const trimmed = normalizeSceneText(result);

      if (!trimmed || isNoUpdateResponse(trimmed)) {
        console.log('No update detected');
        setStatusText('No change detected');
        return;
      }

      console.log('✅ New scene:', trimmed);
      setPreviousScene(trimmed);
      setStatusText(trimmed);

      // Speak the description
      await speakText(trimmed);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Capture error:', msg);
      setStatusText('❌ Error: ' + msg);
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, previousScene]);

  // Capture loop
  useEffect(() => {
    if (!permission?.granted || !cameraReady) {
      console.log('Waiting for permission and camera ready');
      return;
    }

    console.log('▶️ Starting capture loop (5s interval)');
    let cancelled = false;

    const loop = () => {
      if (cancelled) return;
      timeoutRef.current = setTimeout(async () => {
        if (!cancelled) {
          await captureAndAnalyze();
          if (!cancelled) loop();
        }
      }, CAPTURE_INTERVAL_MS);
    };

    loop();

    return () => {
      cancelled = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      console.log('Capture loop stopped');
    };
  }, [cameraReady, captureAndAnalyze, permission?.granted]);

  if (!permission) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>Loading permissions...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>Camera permission required</Text>
        <Text style={styles.button} onPress={() => requestPermission()}>
          Grant access
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
        onCameraReady={() => {
          console.log('📹 Camera ready');
          setCameraReady(true);
          setStatusText('Ready');
        }}
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
    justifyContent: 'center',
    alignItems: 'center',
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
    bottom: 28,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  statusText: {
    color: '#f8fafc',
    fontSize: 16,
    textAlign: 'center',
    fontWeight: '600',
  },
  message: {
    color: '#fff',
    fontSize: 18,
    marginBottom: 12,
  },
  button: {
    color: '#7dd3fc',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});