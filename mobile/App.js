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
  AppState,
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';

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
const PROD_API_URL = 'https://parkspot-server.onrender.com/api'; 
// Use DEV in development, PROD in production
const API_URL = __DEV__ ? DEV_API_URL : PROD_API_URL;

// Configure axios with more robust error handling
axios.defaults.timeout = 30000; // 30 seconds timeout
axios.defaults.headers.common['Content-Type'] = 'application/json';
axios.defaults.maxRetries = 3;
axios.defaults.retryDelay = 2000;

// Add retry logic and better error handling
axios.interceptors.response.use(undefined, async (err) => {
  const { config, message, response } = err;
  
  // Don't retry if we didn't get a config object
  if (!config || !config.url) {
    console.log('No config object in error, cannot retry');
    return Promise.reject(err);
  }
  
  // Skip retry if explicitly requested
  if (config.__skipRetry) {
    console.log('Skipping retry as requested by config');
    return Promise.reject(err);
  }
  
  // Set up retry count
  config.__retryCount = config.__retryCount || 0;
  
  // Use maxRetries from config if specified, otherwise use default
  const maxRetries = config.maxRetries || axios.defaults.maxRetries;
  
  // Check if we should retry the request
  const shouldRetry = config.__retryCount < maxRetries && 
    (message.includes('Network Error') || 
     message.includes('timeout') || 
     message.includes('ECONNABORTED') ||
     (response && (response.status === 502 || response.status === 503 || response.status === 504 || response.status === 429)));
  
  if (shouldRetry) {
    config.__retryCount += 1;
    console.log(`Retrying request (${config.__retryCount}/${maxRetries}): ${config.url}`);
    
    // Use exponential backoff for retries
    const delay = config.retryDelay || axios.defaults.retryDelay;
    const backoffDelay = delay * Math.pow(2, config.__retryCount - 1);
    
    // Wait before retrying
    await new Promise(resolve => setTimeout(resolve, backoffDelay));
    
    // Return the retry request
    return axios(config);
  }
  
  // Handle 502 Bad Gateway errors (common with Render free tier)
  if (response && response.status === 502) {
    console.log('Render server 502 error - may be starting up from sleep');
  }
  
  // For parking spot operations, save locally on network errors
  if (config.method === 'post' && config.url.includes('/parking-spot')) {
    try {
      console.log('Saving parking data locally due to network error');
      await AsyncStorage.setItem('offlineParkingSpot', JSON.stringify(config.data));
    } catch (e) {
      console.error('Failed to save offline data:', e);
    }
  }
  
  return Promise.reject(err);
});

// Keys for AsyncStorage
const TIMER_END_KEY = 'parkspot_timer_end';
const TIMER_ACTIVE_KEY = 'parkspot_timer_active';
const NOTIFICATION_ID_KEY = 'parkspot_notification_id';

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
  const appState = useRef(AppState.currentState);

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
        
        // Load saved timer data
        await loadTimerData();
        
        // Check for offline data
        checkAndSyncOfflineData();
        
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
    
    // Handle app state changes
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        // App has come to the foreground
        loadTimerData();
        checkAndSyncOfflineData();
      }
      appState.current = nextAppState;
    });

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
      // Remove app state subscription
      subscription.remove();
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
          setTimerEnd(null);
          // Clear the saved timer data
          clearTimerData();
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
  
  // Function to check for and sync offline data
  const checkAndSyncOfflineData = async () => {
    try {
      // Check if we have offline data first
      const offlineData = await AsyncStorage.getItem('offlineParkingSpot');
      if (!offlineData) {
        return; // No offline data to sync
      }
      
      const parsedData = JSON.parse(offlineData);
      console.log('Found offline data to sync:', parsedData);
      
      // Check if we have internet connectivity
      const netState = await Network.getNetworkStateAsync();
      if (!netState.isConnected || !netState.isInternetReachable) {
        console.log('No internet connection available for syncing');
        return; // Can't sync without internet
      }
      
      // Check if server is awake first (for Render free tier)
      if (API_URL === PROD_API_URL) {
        try {
          const isServerAwake = await checkServerStatus();
          if (!isServerAwake) {
            console.log('Server appears to be sleeping, will try sync later');
            return; // Server is sleeping, try later
          }
        } catch (error) {
          console.log('Error checking server status:', error.message);
          // Continue with sync attempt anyway
        }
      }
      
      try {
        console.log('Attempting to sync offline data with server');
        // Try to sync with server with increased timeout and explicit retry config
        const response = await axios.post(`${API_URL}/parking-spot`, parsedData, {
          timeout: 30000, // 30 seconds timeout for sync attempts
          __retryCount: 0, // Start with 0 retries
          maxRetries: 3   // Allow up to 3 retries
        });
        
        if (response.data) {
          // Successfully synced
          console.log('Successfully synced offline data with server');
          setParkingSpot(response.data);
          setSavedTime(response.data.timestamp || new Date().toISOString());
          
          // Clear offline data
          await AsyncStorage.removeItem('offlineParkingSpot');
          
          // Show success message
          Alert.alert(
            'Sync Complete',
            'Your parking spot has been successfully synced with the server.',
            [{ text: 'OK' }]
          );
        }
      } catch (error) {
        console.error('Failed to sync offline data:', error);
        // Keep the offline data for next attempt
        // But don't show error to user unless they explicitly try to sync
      }
    } catch (error) {
      console.error('Error in checkAndSyncOfflineData:', error);
    }
  };
  
  // Load timer data from AsyncStorage
  const loadTimerData = async () => {
    try {
      const savedTimerEnd = await AsyncStorage.getItem(TIMER_END_KEY);
      const savedTimerActive = await AsyncStorage.getItem(TIMER_ACTIVE_KEY);
      const savedNotificationId = await AsyncStorage.getItem(NOTIFICATION_ID_KEY);
      
      if (savedTimerEnd && savedTimerActive === 'true') {
        const endTime = new Date(savedTimerEnd);
        const now = new Date();
        
        if (endTime > now) {
          // Timer is still valid
          setTimerEnd(savedTimerEnd);
          setTimerActive(true);
          setRemainingTime(endTime - now);
          if (savedNotificationId) {
            setNotificationId(savedNotificationId);
          }
        } else {
          // Timer has expired, clear data
          clearTimerData();
        }
      }
    } catch (error) {
      console.error('Error loading timer data:', error);
    }
  };
  
  // Save timer data to AsyncStorage
  const saveTimerData = async (endTime, notifId) => {
    try {
      await AsyncStorage.setItem(TIMER_END_KEY, endTime.toISOString());
      await AsyncStorage.setItem(TIMER_ACTIVE_KEY, 'true');
      if (notifId) {
        await AsyncStorage.setItem(NOTIFICATION_ID_KEY, notifId);
      }
    } catch (error) {
      console.error('Error saving timer data:', error);
    }
  };
  
  // Clear timer data from AsyncStorage
  const clearTimerData = async () => {
    try {
      await AsyncStorage.multiRemove([TIMER_END_KEY, TIMER_ACTIVE_KEY, NOTIFICATION_ID_KEY]);
      setTimerActive(false);
      setTimerEnd(null);
      setRemainingTime(null);
      setNotificationId(null);
    } catch (error) {
      console.error('Error clearing timer data:', error);
    }
  };

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
    
    // Save timer data to AsyncStorage
    await saveTimerData(endTime, identifier);
    
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
      
      // Clear timer data from AsyncStorage
      await clearTimerData();
      
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

  // Add a function to check network connectivity and server status
  const checkNetworkAndServer = async () => {
    try {
      // Check network connectivity first
      const netState = await Network.getNetworkStateAsync();
      if (!netState.isConnected || !netState.isInternetReachable) {
        console.log('No internet connection available');
        return {
          isConnected: false,
          isServerAvailable: false,
          error: 'No internet connection'
        };
      }
      
      // If we're using the production API, check if server is awake
      if (API_URL === PROD_API_URL) {
        const isServerAwake = await checkServerStatus();
        return {
          isConnected: true,
          isServerAvailable: isServerAwake,
          error: isServerAwake ? null : 'Server is starting up'
        };
      }
      
      // For development API, assume server is available if network is connected
      return {
        isConnected: true,
        isServerAvailable: true,
        error: null
      };
    } catch (error) {
      console.error('Error checking network and server:', error);
      return {
        isConnected: false,
        isServerAvailable: false,
        error: error.message
      };
    }
  };

  // Update loadParkingSpot to use the new network check
  const loadParkingSpot = async () => {
    try {
      setLoading(true);
      
      // Check network and server status
      const networkStatus = await checkNetworkAndServer();
      if (!networkStatus.isConnected || !networkStatus.isServerAvailable) {
        console.log('Cannot load parking spot:', networkStatus.error);
        // Try to load from local storage if we have it
        const offlineData = await AsyncStorage.getItem('offlineParkingSpot');
        if (offlineData) {
          const parsedData = JSON.parse(offlineData);
          setParkingSpot({
            ...parsedData,
            id: 'local-' + Date.now(),
            savedOffline: true
          });
          setSavedTime(parsedData.timestamp || parsedData.savedAt);
          setNotes(parsedData.notes || '');
          setAddress(parsedData.address || '');
          setParkingImage(parsedData.imageUri);
          return;
        }
        return; // No data to load
      }
      
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
      // Try to load from local storage if we have it
      try {
        const offlineData = await AsyncStorage.getItem('offlineParkingSpot');
        if (offlineData) {
          const parsedData = JSON.parse(offlineData);
          setParkingSpot({
            ...parsedData,
            id: 'local-' + Date.now(),
            savedOffline: true
          });
          setSavedTime(parsedData.timestamp || parsedData.savedAt);
          setNotes(parsedData.notes || '');
          setAddress(parsedData.address || '');
          setParkingImage(parsedData.imageUri);
        }
      } catch (storageError) {
        console.error('Error loading from storage:', storageError);
      }
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
      
      // Create the payload
      const payload = {
        latitude: currentLocation.lat,
        longitude: currentLocation.lng,
        address,
        notes,
        imageUri: parkingImage,
        timestamp: new Date().toISOString() // Ensure we send ISO string for consistent timezone handling
      };
      
      console.log('Saving parking spot to:', API_URL);
      
      // Check network and server status
      const networkStatus = await checkNetworkAndServer();
      if (!networkStatus.isConnected) {
        // No internet connection, save locally
        console.log('No internet connection, saving locally');
        await saveLocally(payload);
        return;
      }
      
      if (!networkStatus.isServerAvailable) {
        // Server is not available (likely sleeping), save locally
        console.log('Server unavailable, saving locally');
        await saveLocally(payload);
        
        // Show more informative message if server is starting up
        if (API_URL === PROD_API_URL) {
          Alert.alert(
            'Saved Locally',
            'Your parking spot has been saved locally. The server is currently starting up and your data will sync automatically when it becomes available.',
            [{ text: 'OK' }]
          );
        }
        return;
      }
      
      // Try to save to server
      try {
        const response = await axios.post(`${API_URL}/parking-spot`, payload);

        if (response && response.data) {
          setParkingSpot(response.data);
          setSavedTime(new Date().toISOString());
          
          // Clear any offline data since we successfully saved to server
          await AsyncStorage.removeItem('offlineParkingSpot');
          
          Alert.alert('Success', 'Parking spot saved!');
          return;
        }
      } catch (serverError) {
        console.error('Server error when saving parking spot:', serverError);
        
        // Save locally when server error occurs
        await saveLocally(payload);
        
        // Show more specific error message
        let errorMessage = 'Could not connect to server. Your parking spot has been saved locally.';
        if (serverError.response) {
          if (serverError.response.status === 502) {
            errorMessage = 'The server is temporarily unavailable. Your parking spot has been saved locally and will sync when the server is available.';
          }
        }
        
        Alert.alert('Saved Locally', errorMessage, [{ text: 'OK' }]);
      }
    } catch (error) {
      console.error('Error in saveParkingSpot:', error);
      Alert.alert('Error', 'Failed to save parking spot. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  
  // Helper function to save parking spot locally
  const saveLocally = async (payload) => {
    try {
      // Add offline flag and timestamp
      const offlineData = {
        ...payload,
        savedOffline: true,
        savedAt: new Date().toISOString()
      };
      
      // Save to AsyncStorage
      await AsyncStorage.setItem('offlineParkingSpot', JSON.stringify(offlineData));
      
      // Update UI
      setParkingSpot({
        ...offlineData,
        id: 'local-' + Date.now()
      });
      setSavedTime(new Date().toISOString());
      
      // Show message to user
      let message = 'Could not connect to server. Your parking spot has been saved locally and will sync when connection is restored.';
      
      Alert.alert('Saved Locally', message, [{ text: 'OK' }]);
      
      return true;
    } catch (error) {
      console.error('Error saving locally:', error);
      Alert.alert('Error', 'Could not save parking spot locally. Please try again.');
      return false;
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
              // If the spot was saved locally, just clear it locally without server call
              if (parkingSpot && parkingSpot.savedOffline) {
                await AsyncStorage.removeItem('offlineParkingSpot');
                setParkingSpot(null);
                setSavedTime(null);
                setParkingImage(null);
                setMessage('Parking spot cleared!');
                
                // Also cancel any active timer and clear timer data
                if (notificationId) {
                  await Notifications.cancelScheduledNotificationAsync(notificationId);
                }
                await clearTimerData();
                
                setTimeout(() => setMessage(''), 3000);
                return;
              }
              
              // Try to clear on server
              try {
                await axios.delete(`${API_URL}/parking-spot`);
              } catch (serverError) {
                console.error('Server error clearing parking spot:', serverError);
                // If server error, just continue with local clearing
                if (serverError.response && serverError.response.status === 502) {
                  console.log('Server is unavailable (502), proceeding with local clear');
                  // Continue with local clearing below
                } else {
                  throw serverError; // Re-throw if not a 502 error
                }
              }
              
              // Clear local state regardless of server response
              setParkingSpot(null);
              setSavedTime(null);
              setParkingImage(null);
              setMessage('Parking spot cleared!');
              
              // Also cancel any active timer and clear timer data
              if (notificationId) {
                await Notifications.cancelScheduledNotificationAsync(notificationId);
              }
              await clearTimerData();
              await AsyncStorage.removeItem('offlineParkingSpot');
              
              setTimeout(() => setMessage(''), 3000);
            } catch (error) {
              console.error('Error clearing parking spot:', error);
              
              // Show more helpful error message
              let errorMessage = 'Could not clear your parking spot. Please try again.';
              if (error.response) {
                if (error.response.status === 502) {
                  errorMessage = 'Server is temporarily unavailable. Your spot has been cleared locally.';
                  // Clear local state anyway
                  setParkingSpot(null);
                  setSavedTime(null);
                  setParkingImage(null);
                  await AsyncStorage.removeItem('offlineParkingSpot');
                } else {
                  errorMessage = `Server error (${error.response.status}). Please try again later.`;
                }
              }
              
              Alert.alert('Error', errorMessage);
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
    
    // Format using the device's timezone with explicit timezone handling
    try {
      // Use Intl.DateTimeFormat for better timezone handling
      const formatter = new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short', 
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
        timeZoneName: 'short'
      });
      
      return formatter.format(date);
    } catch (error) {
      console.error('Error formatting date:', error);
      // Fallback formatting
      return date.toLocaleString();
    }
  };

  // Function for manual sync that can be triggered by user
  const manualSync = async () => {
    setLoading(true);
    try {
      // Check if we have offline data
      const offlineData = await AsyncStorage.getItem('offlineParkingSpot');
      if (!offlineData) {
        Alert.alert('No Data', 'No offline parking data to synchronize.');
        return;
      }
      
      // Check network connectivity
      const netState = await Network.getNetworkStateAsync();
      if (!netState.isConnected || !netState.isInternetReachable) {
        Alert.alert('No Connection', 'Please check your internet connection and try again.');
        return;
      }
      
      // Check if server is awake first
      if (API_URL === PROD_API_URL) {
        try {
          const isServerAwake = await checkServerStatus();
          if (!isServerAwake) {
            Alert.alert(
              'Server Starting',
              'The server is starting up. Please wait a moment and try again.',
              [{ text: 'OK' }]
            );
            return;
          }
        } catch (error) {
          console.log('Error checking server status:', error.message);
          // Continue with sync attempt
        }
      }
      
      const parsedData = JSON.parse(offlineData);
      console.log('Manually syncing data:', parsedData);
      
      // Disable automatic retry for this specific request
      const response = await axios.post(`${API_URL}/parking-spot`, parsedData, {
        __skipRetry: true // Custom flag to skip the retry interceptor
      });
      
      if (response && response.data) {
        // Successfully synced
        setParkingSpot(response.data);
        setSavedTime(response.data.timestamp || new Date().toISOString());
        
        // Clear offline data
        await AsyncStorage.removeItem('offlineParkingSpot');
        
        Alert.alert('Success', 'Your parking spot has been successfully synchronized with the server.');
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (error) {
      console.error('Manual sync failed:', error);
      
      let errorMessage = 'Could not synchronize with the server. Please try again later.';
      
      if (error.response) {
        if (error.response.status === 502) {
          errorMessage = 'The server appears to be starting up or experiencing issues. This is common with free hosting. Please wait a minute and try again.';
        } else {
          errorMessage = `Server error (${error.response.status}). Please try again later.`;
        }
      } else if (error.code === 'ECONNABORTED') {
        errorMessage = 'The connection timed out. The server may be under heavy load or starting up. Please try again in a moment.';
      } else if (!error.response && error.request) {
        errorMessage = 'Could not reach the server. Please check your connection and try again.';
      }
      
      Alert.alert('Sync Failed', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Function to check if the server is awake and wake it up if needed
  const checkServerStatus = async () => {
    if (API_URL === PROD_API_URL) {
      try {
        console.log('Checking if Render server is awake...');
        const controller = new AbortController();
        
        // Set a timeout to abort the request if it takes too long
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        try {
          const response = await axios.get(`${API_URL}/health`, {
            timeout: 5000,
            signal: controller.signal,
            __skipRetry: true, // Skip retry logic for this check
            headers: { 'Cache-Control': 'no-cache' } // Prevent caching
          });
          
          clearTimeout(timeoutId);
          
          if (response.data && response.data.status === 'ok') {
            console.log('Render server is awake and responding');
            return true;
          }
        } catch (error) {
          clearTimeout(timeoutId);
          
          if (error.name === 'AbortError' || error.code === 'ECONNABORTED') {
            console.log('Server health check timed out');
          } else {
            console.log('Server health check failed:', error.message);
          }
          
          // Try to wake up the server with a health check
          console.log('Attempting to wake up the server...');
          
          try {
            // Use a longer timeout for wake-up request
            const wakeupResponse = await axios.get(`${API_URL}/health`, { 
              timeout: 30000,
              __skipRetry: true, // Skip retry logic
              headers: { 'Cache-Control': 'no-cache' } // Prevent caching
            });
            
            if (wakeupResponse.data && wakeupResponse.data.status === 'ok') {
              console.log('Server successfully woken up!');
              return true;
            }
          } catch (wakeupError) {
            console.log('Server wake-up request failed:', wakeupError.message);
          }
          
          return false;
        }
      } catch (error) {
        console.error('Error in checkServerStatus:', error);
        return false;
      }
    }
    return true; // Assume DEV server is always awake
  };
  
  // Add useEffect to check server status on app start
  useEffect(() => {
    if (appIsReady) {
      checkServerStatus();
    }
  }, [appIsReady]);

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
                    <View style={styles.timerInputContainer}>
                      <TextInput
                        style={styles.timerInput}
                        value={timerHours}
                        onChangeText={setTimerHours}
                        keyboardType="numeric"
                        placeholder="2"
                      />
                      <Text style={styles.timerInputLabel}>hours</Text>
                      <TouchableOpacity
                        style={[styles.button, styles.primaryButton, styles.smallButton]}
                        onPress={() => scheduleNotification(timerHours)}
                      >
                        <Icon name="timer" size={16} color="#ffffff" />
                        <Text style={styles.buttonText}>Set Timer</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
                
                {/* Sync status indicator - show if data was saved offline */}
                {parkingSpot.savedOffline && (
                  <View style={styles.syncContainer}>
                    <View style={styles.syncStatusContainer}>
                      <Icon name="cloud-off-outline" size={20} color="#f59e0b" />
                      <Text style={styles.syncStatusText}>Saved locally. Tap to sync with server.</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.button, styles.warningButton, styles.smallButton]}
                      onPress={manualSync}
                      disabled={loading}
                    >
                      {loading ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <>
                          <Icon name="cloud-sync" size={16} color="#ffffff" />
                          <Text style={styles.buttonText}>Sync Now</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

                <View style={styles.buttonContainer}>
                  <TouchableOpacity
                    style={[styles.button, styles.secondaryButton]}
                    onPress={getDirections}
                  >
                    <Icon name="directions" size={20} color="#ffffff" />
                    <Text style={styles.buttonText}>Get Directions</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.button, styles.dangerButton]}
                    onPress={clearParkingSpot}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <>
                        <Icon name="delete" size={20} color="#ffffff" />
                        <Text style={styles.buttonText}>Clear Spot</Text>
                      </>
                    )}
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
    backgroundColor: '#f3f4f6',
  },
  header: {
    backgroundColor: '#ffffff',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
    marginLeft: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  mapContainer: {
    height: 250,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 16,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  mapLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#e5e7eb',
  },
  mapLoadingText: {
    marginTop: 8,
    color: '#6b7280',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
    marginLeft: 8,
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#4b5563',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 6,
    padding: 12,
    fontSize: 16,
  },
  textArea: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
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
    padding: 12,
    borderRadius: 6,
    marginVertical: 4,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 8,
  },
  primaryButton: {
    backgroundColor: '#3b82f6',
  },
  dangerButton: {
    backgroundColor: '#dc2626',
  },
  disabledButton: {
    opacity: 0.5,
  },
  messageContainer: {
    backgroundColor: '#10b981',
    padding: 12,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 6,
  },
  messageText: {
    color: '#ffffff',
    fontSize: 16,
    textAlign: 'center',
  },
  callout: {
    width: 200,
    padding: 8,
  },
  calloutTitle: {
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 4,
  },
  calloutText: {
    fontSize: 14,
    marginBottom: 2,
  },
  calloutTime: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
  },
  photoButtonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  photoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3b82f6',
    padding: 10,
    borderRadius: 6,
    flex: 0.48,
  },
  photoButtonText: {
    color: '#ffffff',
    marginLeft: 8,
    fontSize: 14,
  },
  imagePreviewContainer: {
    position: 'relative',
  },
  imagePreview: {
    width: '100%',
    height: 200,
    borderRadius: 6,
    resizeMode: 'cover',
  },
  removeImageButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderRadius: 15,
  },
  infoHighlight: {
    backgroundColor: '#ecfdf5',
    padding: 12,
    borderRadius: 6,
    marginBottom: 16,
  },
  timeDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoSection: {
    marginBottom: 16,
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#4b5563',
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    color: '#111827',
  },
  savedImage: {
    width: '100%',
    height: 200,
    borderRadius: 6,
    resizeMode: 'cover',
    marginTop: 8,
  },
  countdownContainer: {
    alignItems: 'center',
    marginTop: 8,
  },
  countdownLabel: {
    fontSize: 14,
    color: '#4b5563',
    marginBottom: 4,
  },
  countdownTimer: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#059669',
    marginBottom: 12,
  },
  timerInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  timerInput: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 6,
    padding: 10,
    fontSize: 16,
    width: 60,
    textAlign: 'center',
  },
  timerInputLabel: {
    marginLeft: 10,
    fontSize: 16,
    color: '#4b5563',
  },
  smallButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  syncContainer: {
    backgroundColor: '#fffbeb',
    padding: 12,
    borderRadius: 6,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  syncStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  syncStatusText: {
    fontSize: 14,
    color: '#92400e',
    marginLeft: 8,
    flex: 1,
  },
  warningButton: {
    backgroundColor: '#f59e0b',
  },
  secondaryButton: {
    backgroundColor: '#4f46e5',
  },
}); 