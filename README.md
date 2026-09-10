# Hackathon Vision Assistant

A React Native and Expo prototype that uses the phone camera to describe the user's surroundings and read meaningful scene changes aloud. The app is designed as an accessibility aid for visually impaired users.

## Setup

### Requirements

- Node.js and npm
- Android Studio and an Android device or emulator for native testing
- An API key for the Google Gemini API
- Expo CLI through the local project scripts

### Install and configure

```powershell
npm install
```

Create a local `.env` file in the project root:

```dotenv
EXPO_PUBLIC_GEMINI_API_KEY=your_gemini_api_key
```

The key is read by the Expo bundle at build time. Do not commit `.env` or expose a production API key in a client application; a production deployment should proxy Gemini requests through a server that keeps the key private.

### Run

```powershell
npm start
```

For an Android development build:

```powershell
npm run android
```

The app requests camera permission on launch. After the camera is ready, it captures one JPEG frame every five seconds and begins analysis.

## Architecture

The current implementation is contained primarily in `App.tsx`:

1. `expo-camera` renders the rear camera and captures a JPEG with a base64 payload.
2. The frame and a concise scene-analysis prompt are sent directly from the app to the Gemini `generateContent` REST endpoint.
3. The response is normalized and compared against the special `NO_UPDATE` response.
4. A new description is shown in the status bar and passed to `expo-speech` for native text-to-speech.
5. A timeout loop schedules the next capture after the previous request finishes.

The previous scene description is sent with the next prompt so Gemini can suppress descriptions when the view has not materially changed.

## Third-party services

| Service                     | Purpose                                            | Current configuration                                                                          |
| --------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Google Gemini API           | Image understanding and concise scene descriptions | REST `generateContent`; model ID `gemini-3.6-flash`; API key from `EXPO_PUBLIC_GEMINI_API_KEY` |
| Expo Camera                 | Camera permission, preview, and frame capture      | `expo-camera`                                                                                  |
| Expo Speech / native OS TTS | Reads Gemini's text response aloud                 | `expo-speech`; native device speech engine                                                     |

## Rime audio configuration

Rime is **not currently integrated into this repository**. There is no Rime HTTP request, SDK call, or audio playback path in `App.tsx` or the package dependencies. Therefore the exact Rime values requested are not applicable to the running app:

| Rime field      | Current value                                                                    |
| --------------- | -------------------------------------------------------------------------------- |
| Model ID        | Not configured / not used                                                        |
| Speaker / voice | Not configured; native Expo Speech voice is selected by the operating system     |
| Language        | `en` for the native `expo-speech` call                                           |
| Endpoint        | None; no Rime endpoint is called                                                 |
| Audio format    | None; no Rime audio is requested or decoded                                      |
| Transport       | None; speech uses the local native TTS API, not Rime HTTP or streaming transport |

`EXPO_PUBLIC_RIME_API_KEY` may exist in a local environment from earlier experiments, but it is not read by the current source and does not activate Rime. Do not treat it as a working integration.

## Failure behavior

- If camera permission is missing, the app displays a permission message and a `Grant access` action.
- If the Gemini key is missing, the status bar displays `ERROR: No API key`.
- A non-2xx Gemini response is reported as `ERROR: Status <code>`.
- Network, capture, or parsing failures are caught and displayed as an error in the status bar.
- An empty response or `NO_UPDATE` leaves the app quiet and displays `No change detected`.
- Speech errors are logged and do not crash the camera loop.
- The app skips a capture while another capture is processing.
- There is no retry queue, offline cache, authentication layer, server-side proxy, or guaranteed safety validation of Gemini's descriptions.

## Known limitations

- Analysis is cloud-dependent and can be delayed by network latency.
- The five-second interval is fixed and is not user-configurable.
- The Gemini API key is bundled into a client-side Expo application, so it is not suitable for production secrets.
- The app does not provide navigation, distance measurement, collision avoidance, or emergency alerts.
- Gemini output can be incomplete or incorrect; users should not rely on it as a sole safety system.
- Audio is currently native device text-to-speech rather than Rime audio.
- The prototype has limited visible controls and does not expose request or speech settings.
- There are no automated tests in the repository.

## Demo flow

1. Start the Android app and grant camera permission.
2. Point the camera at a room, doorway, desk, or obstacle.
3. Wait for the five-second capture and Gemini response.
4. Listen to the spoken description and read the status bar if needed.
5. Move the camera to a changed scene and wait for a new announcement.
6. Keep the camera still to demonstrate that repeated scenes produce no spoken update.

## Project scripts

| Command           | Purpose                                       |
| ----------------- | --------------------------------------------- |
| `npm start`       | Start the Expo development server             |
| `npm run android` | Build and run the Android development app     |
| `npm run ios`     | Build and run the iOS app on macOS with Xcode |
| `npm run web`     | Start Expo's web target                       |
