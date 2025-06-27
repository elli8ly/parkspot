# 🚗 ParkSpot - Parking Location App

A beautiful, full-stack web and mobile application that helps you remember where you parked your car. Never lose your car in a parking lot again!

## ✨ Features

- **Save Current Location**: Instantly save your parking spot with GPS coordinates
- **Interactive Map**: View your parking location on a beautiful, interactive map
- **Add Notes**: Include helpful notes like "Near the red car" or "Level 2, Section A"
- **Get Directions**: One-click directions back to your car using Google Maps
- **Responsive Design**: Works perfectly on desktop and mobile devices
- **Modern UI**: Beautiful, clean interface with professional design
- **Native Mobile App**: Dedicated iOS and Android apps available
- **Parking Timer**: Set reminders for when your parking time is about to expire
- **Photo Capture**: Take photos of your parking spot to help you remember exactly where you parked

## Quick Start

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn

### Installation

1. **Clone or download the project**
2. **Install all dependencies**:
   ```bash
   npm run install-all
   ```

3. **Start the development servers**:
   ```bash
   npm run dev
   ```

This will start both the backend server (port 5000) and frontend development server (port 3000).

### Manual Setup

If you prefer to set up manually:

1. **Backend Setup**:
   ```bash
   cd server
   npm install
   npm run dev
   ```

2. **Frontend Setup** (in a new terminal):
   ```bash
   cd client
   npm install
   npm start
   ```

3. **Mobile App Setup** (in a new terminal):
   ```bash
   cd mobile
   npm install
   npm start
   ```

## 🛠️ Tech Stack

### Backend
- **Node.js** with Express.js
- **SQLite** database for data persistence
- **CORS** enabled for cross-origin requests

### Web Frontend
- **React** with modern hooks
- **Custom CSS** for beautiful styling
- **Leaflet** with React-Leaflet for interactive maps
- **Axios** for API communication
- **Heroicons** for beautiful icons

### Mobile App
- **React Native** with Expo
- **React Native Maps** for interactive maps
- **Expo Location** for GPS access
- **Expo Camera** for taking photos of your parking spot
- **Expo Notifications** for parking timer reminders
- **Native UI components** for the best mobile experience

## API Endpoints

- `GET /api/parking-spot` - Get current saved parking spot
- `POST /api/parking-spot` - Save a new parking spot
- `DELETE /api/parking-spot` - Clear current parking spot
- `GET /api/health` - Health check endpoint

## 📱 How to Use

### Web App
1. **Open the app** in your browser (http://localhost:3000)
2. **Allow location access** when prompted
3. **Save your parking spot** by adding optional notes and clicking "Save Parking Spot"
4. **View your spot** on the interactive map
5. **Get directions** back to your car when you need to find it
6. **Clear the spot** when you've retrieved your car

### Mobile App
1. **Install the Expo Go app** on your iOS or Android device
2. **Start the mobile app server**: `cd mobile && npm start`
3. **Scan the QR code** with your device's camera
4. **Allow location permissions** when prompted
5. **Save your parking location** with the intuitive mobile interface
6. **Take a photo** of your parking spot to help you remember exactly where you parked
7. **Set a parking timer** to remind you when your parking time is about to expire
8. **Get native map directions** back to your car

## Privacy & Security

- Your location data is stored locally in an SQLite database
- Photos are stored locally on your device and referenced in the database
- No data is sent to external services except when using the "Get Directions" feature
- Location and camera access is only requested when you use the app

## Contributing

This is a demo project, but feel free to fork and enhance it! Some ideas for improvements:

- User authentication for multiple users
- Multiple parking spots support
- Integration with parking payment systems
- Parking availability prediction
- History of previous parking spots

## License

MIT License - Feel free to use this project for your own purposes!

## Troubleshooting

### Location not working?
- Make sure you've allowed location access in your browser or device
- Try refreshing the page and allowing location access again
- Check that you're on HTTPS or localhost (required for geolocation)

### Map not loading?
- Check your internet connection
- Try refreshing the page
- Make sure the backend server is running on port 5000

### Camera not working?
- Make sure you've allowed camera permissions on your device
- Try restarting the app
- Use a physical device instead of an emulator for better camera support

### Notifications not working?
- Make sure notifications are enabled for the app in your device settings
- Try setting a longer timer (at least a few minutes) for testing
- Use a physical device as emulators may not support notifications properly

### Backend errors?
- Ensure the server is running on port 5000
- Check the terminal for any error messages
- Try restarting the backend server

### Mobile app not connecting to API?
- Update the API_URL in mobile/App.js to your computer's local IP address
- Make sure your phone and computer are on the same network
- Check that the backend server is running

---

Made with ❤️ for people who always forget where they parked! 
