# ParkSpot Mobile App

A React Native mobile app to help you remember where you parked your car.

## Features

- Save your current parking location with GPS
- Add notes and location details
- View your parking spot on an interactive map
- Get directions back to your car using native maps
- Beautiful native UI for iOS and Android

## Setup Instructions

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Expo CLI: `npm install -g expo-cli`
- iOS: XCode and CocoaPods (for iOS simulator or device builds)
- Android: Android Studio (for Android simulator or device builds)
- Expo Go app on your physical device (for testing without building)

### Installation

1. Install dependencies:
   ```
   npm install
   ```

2. Start the development server:
   ```
   npm start
   ```

3. Follow the instructions in the terminal to:
   - Open on iOS simulator (press `i`)
   - Open on Android simulator (press `a`)
   - Scan the QR code with Expo Go on your device

### Important Configuration

Before running on a physical device, you need to update the API URL in `App.js`:

```javascript
// Change this to your server's IP address when testing on a physical device
const API_URL = 'http://YOUR_SERVER_IP:5000/api';
```

Replace `YOUR_SERVER_IP` with your computer's local IP address when testing on your network.

## Building for Production

### Using EAS Build (Recommended)

1. Install EAS CLI:
   ```
   npm install -g eas-cli
   ```

2. Log in to your Expo account:
   ```
   eas login
   ```

3. Configure the build:
   ```
   eas build:configure
   ```

4. Start the build:
   ```
   eas build --platform ios
   ```
   or
   ```
   eas build --platform android
   ```

### Manual Building

For iOS:
1. Generate the native project:
   ```
   expo prebuild --platform ios
   ```
2. Open the iOS folder in XCode and build

For Android:
1. Generate the native project:
   ```
   expo prebuild --platform android
   ```
2. Open the Android folder in Android Studio and build

## Troubleshooting

- **API Connection Issues**: Ensure your server is running and the API_URL is correctly set to your server's IP address
- **Location Permission Denied**: Make sure to grant location permissions when prompted
- **Maps Not Loading**: Check your internet connection and ensure you have Google Play Services installed (Android)

## License

MIT License 