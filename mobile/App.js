import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
  Linking,
  Image,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import MapView, { Marker, Callout } from 'react-native-maps';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import axios from 'axios';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import * as SplashScreen from 'expo-splash-screen';

// Keep splash screen visible while we initialize
SplashScreen.preventAutoHideAsync();

// Configure notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// API URL - change this to your server IP when testing on a real device
// For production, you would use your actual deployed backend URL
const DEV_API_URL = 'http://10.0.0.71:5000/api';
const PROD_API_URL = 'https://your-parking-app.onrender.com/api'; // Replace with your actual Render URL when deployed
const API_URL = __DEV__ ? DEV_API_URL : PROD_API_URL;

export default function App() {
  const [parkingSpot, setParkingSpot] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState('');
  const [savedTime, setSavedTime] = useState(null);
  const [parkingImage, setParkingImage] = useState(null);
  const [timerHours, setTimerHours] = useState('2');
  const [appIsReady, setAppIsReady] = useState(false);
  // Add states for countdown timer
  const [timerActive, setTimerActive] = useState(false);
  const [timerEnd, setTimerEnd] = useState(null);
  const [remainingTime, setRemainingTime] = useState(null);
  const [notificationId, setNotificationId] = useState(null);
  
  const mapRef = useRef(null);
  const notificationListener = useRef();
  const responseListener = useRef();
  const timerInterval = useRef(null);

  useEffect(() => {
    async function prepare() {
      try {
        // Request notification permissions
        await registerForPushNotificationsAsync();
        
        // Request location permissions
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setMessage('Permission to access location was denied');
          return;
        }

        try {
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });
          setCurrentLocation({
            lat: location.coords.latitude,
            lng: location.coords.longitude,
          });
        } catch (error) {
          console.error('Error getting location:', error);
          setMessage('Unable to get current location. Please try again.');
        }

        // Load existing parking spot
        await loadParkingSpot();
        
      } catch (e) {
        console.warn(e);
      } finally {
        // Tell the application to render
        setAppIsReady(true);
        await SplashScreen.hideAsync();
      }
    }

    prepare();

    // Set up notification listeners
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received:', notification);
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('Notification response received:', response);
    });

    // Set up location subscription
    let locationSubscription = null;
    
    // Watch position updates when the app is active
    const watchPosition = async () => {
      locationSubscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 10 },
        (location) => {
          setCurrentLocation({
            lat: location.coords.latitude,
            lng: location.coords.longitude,
          });
        }
      );
    };
    
    watchPosition();

    return () => {
      // Clean up all subscriptions and listeners
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
      // Clear timer interval on unmount
      if (timerInterval.current) {
        clearInterval(timerInterval.current);
      }
      // Remove location subscription
      if (locationSubscription) {
        locationSubscription.remove();
      }
    };
  }, []);

  // Add effect to update the countdown timer
  useEffect(() => {
    if (timerActive && timerEnd) {
      // Update timer every second
      timerInterval.current = setInterval(() => {
        const now = new Date();
        const endTime = new Date(timerEnd);
        const diff = endTime - now;
        
        if (diff <= 0) {
          // Timer finished
          clearInterval(timerInterval.current);
          setTimerActive(false);
          setRemainingTime(null);
        } else {
          // Update remaining time
          setRemainingTime(diff);
        }
      }, 1000);
      
      return () => {
        if (timerInterval.current) {
          clearInterval(timerInterval.current);
        }
      };
    }
  }, [timerActive, timerEnd]);

  const registerForPushNotificationsAsync = async () => {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
    }

    if (Constants.isDevice) {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== 'granted') {
        Alert.alert('Warning', 'Failed to get push token for notifications!');
        return;
      }
    } else {
      Alert.alert('Note', 'Must use physical device for notifications');
    }
  };

  const scheduleNotification = async (hours) => {
    // Cancel any existing notification
    if (notificationId) {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
    }
    
    const hours_num = parseInt(hours) || 2;
    const seconds = hours_num * 3600; // Convert hours to seconds
    
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Parking Timer",
        body: `Your parking time is almost up! Your car has been parked for ${hours_num} hours.`,
        data: { parkingSpot },
      },
      trigger: { 
        seconds: seconds,
      },
    });
    
    // Set timer end time
    const endTime = new Date(Date.now() + seconds * 1000);
    setTimerEnd(endTime);
    setTimerActive(true);
    setRemainingTime(seconds * 1000);
    setNotificationId(identifier);
    
    Alert.alert(
      "Timer Set",
      `You will be notified in ${hours_num} hours about your parking.`,
      [{ text: "OK" }]
    );
    
    return identifier;
  };

  const cancelTimer = async () => {
    if (notificationId) {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
      setTimerActive(false);
      setTimerEnd(null);
      setRemainingTime(null);
      setNotificationId(null);
      
      Alert.alert(
        "Timer Canceled",
        "Your parking timer has been canceled.",
        [{ text: "OK" }]
      );
    }
  };
  
  // Format the remaining time as HH:MM:SS
  const formatRemainingTime = (ms) => {
    if (!ms) return "00:00:00";
    
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const takePicture = async () => {
    // Ask for camera permissions
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera permission is required to take pictures');
      return;
    }
    
    try {
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.7,
      });
      
      if (!result.canceled) {
        setParkingImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error taking picture:', error);
      Alert.alert('Error', 'Failed to take picture');
    }
  };

  const pickImage = async () => {
    // Ask for media library permissions
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Media library permission is required to select pictures');
      return;
    }
    
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.7,
      });
      
      if (!result.canceled) {
        setParkingImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to select image');
    }
  };

  const loadParkingSpot = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}/parking-spot`);
      if (response.data) {
        setParkingSpot(response.data);
        setNotes(response.data.notes || '');
        setAddress(response.data.address || '');
        setSavedTime(response.data.timestamp);
        setParkingImage(response.data.imageUri);
      }
    } catch (error) {
      console.error('Error loading parking spot:', error);
      // Don't show error to user, just silently fail
      // The UI will show the "Save Parking Spot" button if no spot is loaded
    } finally {
      setLoading(false);
    }
  };

  const saveParkingSpot = async () => {
    try {
      if (!currentLocation) {
        Alert.alert('Error', 'Cannot get your current location. Please try again.');
        return;
      }

      setLoading(true);
      const response = await axios.post(`${API_URL}/parking-spot`, {
        latitude: currentLocation.lat,
        longitude: currentLocation.lng,
        address,
        notes,
        imageUri: parkingImage
      });

      if (response.data) {
        setParkingSpot(response.data);
        setSavedTime(new Date().toISOString());
        Alert.alert('Success', 'Parking spot saved!');
      }
    } catch (error) {
      console.error('Error saving parking spot:', error);
      
      // More user-friendly error handling
      let errorMessage = 'Error saving parking spot. Please try again.';
      if (!navigator.onLine) {
        errorMessage = 'No internet connection. Please check your connection and try again.';
      } else if (error.response) {
        // The server responded with an error status code
        errorMessage = `Server error (${error.response.status}). Please try again later.`;
      } else if (error.request) {
        // The request was made but no response was received
        errorMessage = 'No response from server. Please check your connection and try again.';
      }
      
      Alert.alert('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const clearParkingSpot = async () => {
    Alert.alert(
      'Clear Parking Spot',
      'Are you sure you want to clear your saved parking spot?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await axios.delete(`${API_URL}/parking-spot`);
              setParkingSpot(null);
              setSavedTime(null);
              setParkingImage(null);
              setMessage('Parking spot cleared!');
              
              // Also cancel any active timer
              if (timerActive) {
                await cancelTimer();
              }
              
              setTimeout(() => setMessage(''), 3000);
            } catch (error) {
              console.error('Error clearing parking spot:', error);
              Alert.alert('Error', 'Could not clear your parking spot. Please try again.');
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  const getDirections = () => {
    if (parkingSpot) {
      const scheme = Platform.select({ ios: 'maps:0,0?q=', android: 'geo:0,0?q=' });
      const latLng = `${parkingSpot.latitude},${parkingSpot.longitude}`;
      const label = 'My Parked Car';
      const url = Platform.select({
        ios: `${scheme}${label}@${latLng}`,
        android: `${scheme}${latLng}(${label})`
      });
      
      Linking.openURL(url);
    }
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return 'Unknown time';
    
    const date = new Date(timestamp);
    
    // Check if date is valid
    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }
    
    // Format: Day Month DD, YYYY at HH:MM AM/PM
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short', 
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true
    });
  };

  if (!appIsReady) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar style="auto" />
        
        <View style={styles.header}>
          <View style={styles.titleContainer}>
            <Icon name="map-marker" size={40} color="#3b82f6" />
            <Text style={styles.title}>ParkSpot</Text>
          </View>
          <Text style={styles.subtitle}>Never forget where you parked again!</Text>
        </View>

        {message ? (
          <View style={styles.messageContainer}>
            <Text style={styles.messageText}>{message}</Text>
          </View>
        ) : null}

        <ScrollView style={styles.scrollView}>
          <View style={styles.content}>
            {/* Map View */}
            <View style={styles.mapContainer}>
              {currentLocation ? (
                <MapView
                  ref={mapRef}
                  style={styles.map}
                  initialRegion={{
                    latitude: currentLocation.lat,
                    longitude: currentLocation.lng,
                    latitudeDelta: 0.005,
                    longitudeDelta: 0.005,
                  }}
                >
                  {parkingSpot && (
                    <Marker
                      coordinate={{
                        latitude: parkingSpot.latitude,
                        longitude: parkingSpot.longitude,
                      }}
                      pinColor="#3b82f6"
                    >
                      <Callout>
                        <View style={styles.callout}>
                          <Text style={styles.calloutTitle}>🚗 Your Car</Text>
                          {parkingSpot.address && (
                            <Text style={styles.calloutText}>{parkingSpot.address}</Text>
                          )}
                          {parkingSpot.notes && (
                            <Text style={styles.calloutText}>{parkingSpot.notes}</Text>
                          )}
                          <Text style={styles.calloutTime}>
                            Saved: {formatTime(savedTime)}
                          </Text>
                        </View>
                      </Callout>
                    </Marker>
                  )}
                </MapView>
              ) : (
                <View style={styles.mapLoading}>
                  <ActivityIndicator size="large" color="#3b82f6" />
                  <Text style={styles.mapLoadingText}>Loading map...</Text>
                </View>
              )}
            </View>

            {/* Controls */}
            {!parkingSpot ? (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Icon name="map-marker-plus" size={24} color="#3b82f6" />
                  <Text style={styles.cardTitle}>Save Current Location</Text>
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>Address/Location Name (Optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={address}
                    onChangeText={setAddress}
                    placeholder="e.g., Mall Parking Lot, Level 2"
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>Notes (Optional)</Text>
                  <TextInput
                    style={styles.textArea}
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="e.g., Near the red car, Section A"
                    multiline
                    numberOfLines={3}
                  />
                </View>

                {/* Photo capture section */}
                <View style={styles.formGroup}>
                  <Text style={styles.label}>Add Photo (Optional)</Text>
                  <View style={styles.photoButtonContainer}>
                    <TouchableOpacity
                      style={styles.photoButton}
                      onPress={takePicture}
                    >
                      <Icon name="camera" size={20} color="#ffffff" />
                      <Text style={styles.photoButtonText}>Take Photo</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity
                      style={styles.photoButton}
                      onPress={pickImage}
                    >
                      <Icon name="image" size={20} color="#ffffff" />
                      <Text style={styles.photoButtonText}>Choose Photo</Text>
                    </TouchableOpacity>
                  </View>
                  
                  {parkingImage && (
                    <View style={styles.imagePreviewContainer}>
                      <Image source={{ uri: parkingImage }} style={styles.imagePreview} />
                      <TouchableOpacity
                        style={styles.removeImageButton}
                        onPress={() => setParkingImage(null)}
                      >
                        <Icon name="close-circle" size={24} color="#dc2626" />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                <TouchableOpacity
                  style={[
                    styles.button,
                    styles.primaryButton,
                    (!currentLocation || loading) && styles.disabledButton,
                  ]}
                  onPress={saveParkingSpot}
                  disabled={!currentLocation || loading}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <>
                      <Icon name="check-circle" size={20} color="#ffffff" />
                      <Text style={styles.buttonText}>Save Parking Spot</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Icon name="information" size={24} color="#059669" />
                  <Text style={styles.cardTitle}>Your Parking Spot</Text>
                </View>

                <View style={styles.infoHighlight}>
                  <View style={styles.timeDisplay}>
                    <Icon name="clock-outline" size={24} color="#059669" />
                    <View>
                      <Text style={styles.infoLabel}>Saved on:</Text>
                      <Text style={styles.infoValue}>{formatTime(savedTime)}</Text>
                    </View>
                  </View>
                </View>

                {parkingSpot.address && (
                  <View style={styles.infoSection}>
                    <Text style={styles.infoLabel}>Location:</Text>
                    <Text style={styles.infoValue}>{parkingSpot.address}</Text>
                  </View>
                )}

                {parkingSpot.notes && (
                  <View style={styles.infoSection}>
                    <Text style={styles.infoLabel}>Notes:</Text>
                    <Text style={styles.infoValue}>{parkingSpot.notes}</Text>
                  </View>
                )}
                
                {parkingImage && (
                  <View style={styles.infoSection}>
                    <Text style={styles.infoLabel}>Photo:</Text>
                    <Image source={{ uri: parkingImage }} style={styles.savedImage} />
                  </View>
                )}

                {/* Parking Timer Section */}
                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>Parking Timer:</Text>
                  
                  {/* Show countdown if timer is active */}
                  {timerActive && remainingTime ? (
                    <View style={styles.countdownContainer}>
                      <Text style={styles.countdownLabel}>Time Remaining:</Text>
                      <Text style={styles.countdownTimer}>{formatRemainingTime(remainingTime)}</Text>
                      <TouchableOpacity
                        style={[styles.button, styles.dangerButton, styles.smallButton]}
                        onPress={cancelTimer}
                      >
                        <Icon name="timer-off" size={16} color="#ffffff" />
                        <Text style={styles.buttonText}>Cancel Timer</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.timerContainer}>
                      <TextInput
                        style={styles.timerInput}
                        value={timerHours}
                        onChangeText={text => setTimerHours(text.replace(/[^0-9]/g, ''))}
                        keyboardType="numeric"
                        maxLength={2}
                      />
                      <Text style={styles.timerText}>hours</Text>
                      <TouchableOpacity
                        style={styles.timerButton}
                        onPress={() => scheduleNotification(parseInt(timerHours) || 2)}
                      >
                        <Icon name="clock-alert" size={20} color="#ffffff" />
                        <Text style={styles.buttonText}>Set Timer</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                <View style={styles.buttonGroup}>
                  <TouchableOpacity
                    style={[styles.button, styles.successButton]}
                    onPress={getDirections}
                  >
                    <Icon name="directions" size={20} color="#ffffff" />
                    <Text style={styles.buttonText}>Get Directions</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.button,
                      styles.dangerButton,
                      loading && styles.disabledButton,
                    ]}
                    onPress={clearParkingSpot}
                    disabled={loading}
                  >
                    <Icon name="trash-can-outline" size={20} color="#ffffff" />
                    <Text style={styles.buttonText}>Clear Spot</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f4ff',
  },
  header: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1f2937',
    marginLeft: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#6b7280',
  },
  messageContainer: {
    backgroundColor: '#dbeafe',
    borderWidth: 1,
    borderColor: '#93c5fd',
    borderRadius: 8,
    padding: 15,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  messageText: {
    color: '#1e40af',
    textAlign: 'center',
    fontSize: 16,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  mapContainer: {
    height: 300,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  mapLoading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#f9fafb',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapLoadingText: {
    marginTop: 10,
    color: '#6b7280',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1f2937',
    marginLeft: 8,
  },
  formGroup: {
    marginBottom: 15,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 5,
  },
  input: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    padding: 12,
    fontSize: 16,
  },
  textArea: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    padding: 12,
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 6,
    marginTop: 5,
  },
  buttonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
    marginLeft: 8,
  },
  primaryButton: {
    backgroundColor: '#3b82f6',
  },
  successButton: {
    backgroundColor: '#059669',
    flex: 1,
    marginRight: 6,
  },
  dangerButton: {
    backgroundColor: '#dc2626',
    flex: 1,
    marginLeft: 6,
  },
  disabledButton: {
    opacity: 0.5,
  },
  buttonGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  infoHighlight: {
    backgroundColor: '#f0fdf4',
    borderRadius: 6,
    padding: 15,
    marginBottom: 15,
  },
  timeDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoSection: {
    marginBottom: 15,
  },
  infoLabel: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
  },
  callout: {
    width: 200,
    padding: 5,
  },
  calloutTitle: {
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 5,
    textAlign: 'center',
  },
  calloutText: {
    fontSize: 14,
    marginBottom: 2,
    textAlign: 'center',
  },
  calloutTime: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 5,
    textAlign: 'center',
  },
  // New styles for photo functionality
  photoButtonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  photoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366f1',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 6,
    flex: 1,
    marginHorizontal: 4,
  },
  photoButtonText: {
    color: 'white',
    fontWeight: '500',
    marginLeft: 6,
  },
  imagePreviewContainer: {
    marginTop: 10,
    position: 'relative',
    alignItems: 'center',
  },
  imagePreview: {
    width: '100%',
    height: 200,
    borderRadius: 6,
    resizeMode: 'cover',
  },
  savedImage: {
    width: '100%',
    height: 200,
    borderRadius: 6,
    resizeMode: 'cover',
    marginTop: 5,
  },
  removeImageButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderRadius: 15,
  },
  // Timer styles
  timerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },
  timerInput: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    padding: 10,
    fontSize: 16,
    width: 60,
    textAlign: 'center',
  },
  timerText: {
    marginLeft: 10,
    fontSize: 16,
    color: '#4b5563',
  },
  timerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8b5cf6',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 6,
    marginLeft: 'auto',
  },
  // Add new styles for countdown timer
  countdownContainer: {
    alignItems: 'center',
    marginVertical: 10,
    backgroundColor: '#f0f9ff',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#bae6fd',
  },
  countdownLabel: {
    fontSize: 14,
    color: '#0369a1',
    fontWeight: '500',
    marginBottom: 5,
  },
  countdownTimer: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#0284c7',
    marginBottom: 10,
  },
  smallButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
}); 