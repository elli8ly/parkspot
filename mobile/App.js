import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  Pressable,
  Platform,
  Linking,
  AppState,
  Dimensions,
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
import { API_URL } from './src/config';

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

// Configure axios with auth interceptor and more robust error handling
axios.defaults.timeout = 30000; // 30 seconds timeout
axios.defaults.headers.common['Content-Type'] = 'application/json';
axios.defaults.maxRetries = 3;
axios.defaults.retryDelay = 2000;

// Add auth interceptor
axios.interceptors.request.use(
  async config => {
    const token = await AsyncStorage.getItem('token');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  error => {
    return Promise.reject(error);
  }
);

// Add retry logic and better error handling
axios.interceptors.response.use(undefined, async (err) => {
  const { config, message, response } = err;
  
  // Handle 401 Unauthorized errors
  if (response && response.status === 401) {
    // Clear auth data
    await AsyncStorage.multiRemove(['token', 'user']);
    // You might want to trigger a re-render or navigation here
    return Promise.reject(err);
  }
  
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

// Keys for AsyncStorage - updated to match web version
const TIMER_END_KEY = 'parkspot_timer_end';
const TIMER_ACTIVE_KEY = 'parkspot_timer_active';
const TIMER_HOURS_KEY = 'parkspot_timer_hours';
const TIMER_MINUTES_KEY = 'parkspot_timer_minutes';
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
  
  // Updated timer states to match web version
  const [timerHours, setTimerHours] = useState('2');
  const [timerMinutes, setTimerMinutes] = useState('0');
  const [timerActive, setTimerActive] = useState(false);
  const [timerEnd, setTimerEnd] = useState(null);
  const [remainingTime, setRemainingTime] = useState(null);
  const [timerExpired, setTimerExpired] = useState(false);
  const [appIsReady, setAppIsReady] = useState(false);
  const [notificationId, setNotificationId] = useState(null);
  const timerInterval = useRef(null);
  const userRef = useRef(null); // Add ref to store current user ID

  // Add auth states
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [showLogin, setShowLogin] = useState(true);
  const [authForm, setAuthForm] = useState({
    username: '',
    password: '',
    email: ''
  });

  const mapRef = useRef(null);
  const notificationListener = useRef();
  const responseListener = useRef();
  const appState = useRef(AppState.currentState);

  // Update userRef whenever user changes
  useEffect(() => {
    userRef.current = user?.id;
  }, [user]);

  // Remove automatic authentication check to always show login page
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

        // Get current location
        let location = await Location.getCurrentPositionAsync({});
        setCurrentLocation(location);
        
        // Check network and server status
        await checkNetworkAndServer();
        
        // Clear any existing auth data to ensure fresh login
        await AsyncStorage.multiRemove(['token', 'user']);
        
      } catch (error) {
        console.error('Error preparing app:', error);
      } finally {
        setAppIsReady(true);
        SplashScreen.hideAsync();
      }
    }

    prepare();
  }, []);

  // Set up notifications and location tracking
  useEffect(() => {
    // Set up notification listeners
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received:', notification);
      
      // Check if this notification belongs to the current user
      const notifUserId = notification.request.content.data?.userId;
      const currentUserId = user?.id;
      
      if (!notifUserId || !currentUserId || parseInt(notifUserId) !== parseInt(currentUserId)) {
        console.log(`Notification is for user ${notifUserId}, but current user is ${currentUserId}. Canceling notification.`);
        Notifications.cancelScheduledNotificationAsync(notification.request.identifier)
          .then(() => console.log('Successfully canceled notification for different user'))
          .catch(err => console.error('Error canceling notification:', err));
        return;
      }
      
      // Only clear timer data if the timer has actually expired
      // Check if the timer end time has passed
      const timerEndTime = timerEnd;
      if (timerEndTime && new Date() >= new Date(timerEndTime)) {
        console.log('Timer has actually expired, clearing timer data');
        setTimerExpired(true);
        clearTimerData();
      } else {
        console.log('Notification received but timer has not expired yet, not clearing timer data');
      }
      
      // Cancel the notification to prevent it from showing again
      Notifications.cancelScheduledNotificationAsync(notification.request.identifier)
        .then(() => console.log('Successfully canceled notification after receiving'))
        .catch(err => console.error('Error canceling notification:', err));
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('Notification response received:', response);
      
      // Check if this notification belongs to the current user
      const notifUserId = response.notification.request.content.data?.userId;
      const currentUserId = user?.id;
      
      if (!notifUserId || !currentUserId || parseInt(notifUserId) !== parseInt(currentUserId)) {
        console.log(`Notification response is for user ${notifUserId}, but current user is ${currentUserId}. Ignoring.`);
        return;
      }
      
      // Only clear timer data if the timer has actually expired
      const timerEndTime = timerEnd;
      if (timerEndTime && new Date() >= new Date(timerEndTime)) {
        console.log('Timer has actually expired, clearing timer data');
        setTimerExpired(true);
        clearTimerData();
      } else {
        console.log('Notification response received but timer has not expired yet, not clearing timer data');
      }
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
        // App has come to the foreground - only load data if user is authenticated
        if (isAuthenticated && user) {
        loadTimerData();
        checkAndSyncOfflineData();
        }
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
  }, [isAuthenticated, user]);

  // Add timer effect to update countdown
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
          timerInterval.current = null;
          setTimerActive(false);
          setRemainingTime(null);
          setTimerEnd(null);
          // Set timer expired flag for UI notification
          setTimerExpired(true);
          // Clear the saved timer data
          clearTimerData(true);
          
          // Show prominent message to user
          Alert.alert(
            "Timer Expired!",
            `Your parking time is up!${parkingSpot?.address ? `\nLocation: ${parkingSpot.address}` : ''}`,
            [{ text: "OK" }],
            { cancelable: false }
          );
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
  }, [timerActive, timerEnd, parkingSpot]);

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
  
  // Save timer data to AsyncStorage and server
  const saveTimerData = async (endTime, notifId) => {
    if (!user || !user.id) {
      console.log('Cannot save timer data: no user logged in');
      return;
    }
    
    // Prevent multiple saves in quick succession
    if (saveTimerData.isSaving) {
      console.log('Timer save already in progress, skipping duplicate save');
      return;
    }
    
    saveTimerData.isSaving = true;
    
    const userId = user.id;
    
    try {
      console.log(`Saving timer data for user: ${userId}`);
      
      // Save to server for cross-platform sync
      try {
        await axios.post(`${API_URL}/timer-data`, {
          timer_end: endTime.toISOString(),
          timer_active: true,
          timer_hours: timerHours,
          timer_minutes: timerMinutes,
          notification_id: notifId
        });
        console.log('Timer data saved to server for cross-platform sync');
      } catch (error) {
        console.error('Error saving timer data to server:', error);
      }
    } catch (error) {
      console.error('Error saving timer data:', error);
    } finally {
      // Reset the flag after a short delay to prevent rapid successive saves
      setTimeout(() => {
        saveTimerData.isSaving = false;
      }, 1000);
    }
  };
  
  // Load timer data from AsyncStorage
  const loadTimerData = async (userData = null) => {
    // Use passed userData or fall back to state
    const currentUser = userData || user;
    
    if (!currentUser || !currentUser.id) {
      console.log('Cannot load timer data: no user logged in');
      console.log('Current user state:', currentUser);
      return false;
    }
    
    const userId = currentUser.id;
    console.log(`Loading timer data for user: ${userId}`);
    
    try {
      // Only load from server - no local storage fallback
      const response = await axios.get(`${API_URL}/timer-data`);
      const serverTimerData = response.data;
      console.log('Retrieved timer data from server:', serverTimerData);
      
      if (serverTimerData && serverTimerData.timer_active) {
        // Server has active timer data
        const timerData = {
          timer_end: serverTimerData.timer_end,
          timer_active: serverTimerData.timer_active === 1,
          timer_hours: serverTimerData.timer_hours,
          timer_minutes: serverTimerData.timer_minutes,
          notification_id: serverTimerData.notification_id
        };
        
        const endTime = new Date(timerData.timer_end);
        const now = new Date();
        
        console.log('Timer end time:', endTime.toISOString());
        console.log('Current time:', now.toISOString());
        console.log('Timer still active:', endTime > now);
        
        if (endTime > now) {
          // Timer still active
          setTimerEnd(endTime);
          setTimerActive(true);
          setRemainingTime(endTime - now);
          
          // Restore hours and minutes if available
          if (timerData.timer_hours) setTimerHours(timerData.timer_hours);
          if (timerData.timer_minutes) setTimerMinutes(timerData.timer_minutes);
          
          if (timerData.notification_id) {
            setNotificationId(timerData.notification_id);
          }
          
          // Restart the timer interval
          if (timerInterval.current) {
            clearInterval(timerInterval.current);
          }
          
          // Store the user ID this timer belongs to
          const timerUserId = userId;
          
          timerInterval.current = setInterval(() => {
            // Check if the user ID has changed (user switched)
            // Only stop if userRef is null (user logged out)
            if (!userRef.current) {
              console.log('User logged out, stopping timer interval for user:', timerUserId);
              clearInterval(timerInterval.current);
              timerInterval.current = null;
              return;
            }
            
            const now = new Date();
            const end = new Date(endTime);
            const remaining = end - now;
            
            if (remaining <= 0) {
              // Timer expired
              clearInterval(timerInterval.current);
              timerInterval.current = null;
              setTimerActive(false);
              setTimerExpired(true);
              setRemainingTime(0);
              
              // Clear timer data
              clearTimerData(true);
        } else {
              setRemainingTime(remaining);
            }
          }, 1000);
          
          console.log(`Timer data loaded and interval restarted for user: ${userId}, end time: ${endTime.toISOString()}`);
          return true;
        } else {
          // Timer expired
          console.log(`Timer expired for user: ${userId}, clearing timer data`);
          clearTimerData(true);
          setTimerExpired(true);
        }
      } else {
        // No active timer on server
        console.log(`No active timer found on server for user: ${userId}`);
        
        // Clear any local timer state
        setTimerActive(false);
        setTimerEnd(null);
        setRemainingTime(null);
        setTimerExpired(false);
        
        // Clear interval if active
        if (timerInterval.current) {
          clearInterval(timerInterval.current);
          timerInterval.current = null;
        }
      }
    } catch (error) {
      console.log('No timer data found on server or server error:', error.message);
      
      // Clear any local timer state when server request fails
      setTimerActive(false);
      setTimerEnd(null);
      setRemainingTime(null);
      setTimerExpired(false);
      
      // Clear interval if active
      if (timerInterval.current) {
        clearInterval(timerInterval.current);
        timerInterval.current = null;
      }
    }
    
    return false;
  };
  
  // Clear timer data from AsyncStorage and server
  const clearTimerData = async (clearFromStorage = true) => {
    if (!user || !user.id) {
      console.log('Cannot clear timer data: no user logged in');
      return;
    }
    
    const userId = user.id;
    
    try {
      // Clear timer state in memory
      setTimerActive(false);
      setTimerEnd(null);
      setRemainingTime(null);
      
      // Cancel notification if we have an ID
      if (notificationId) {
        try {
          await Notifications.cancelScheduledNotificationAsync(notificationId);
          console.log(`Canceled notification with ID: ${notificationId} for user: ${userId}`);
        } catch (notifError) {
          console.error('Error canceling notification:', notifError);
        }
      setNotificationId(null);
      }
      
      // Clear interval if active
      if (timerInterval.current) {
        clearInterval(timerInterval.current);
        timerInterval.current = null;
        console.log(`Cleared timer interval for user: ${userId}`);
      }
      
      // Only clear from server and storage if clearFromStorage is true
      if (clearFromStorage) {
        // Clear from server for cross-platform sync
        try {
          await axios.delete(`${API_URL}/timer-data`);
          console.log('Timer data cleared from server for cross-platform sync');
        } catch (error) {
          console.error('Error clearing timer data from server:', error);
          // Continue with local clearing even if server clear fails
        }
        
        // Clear from AsyncStorage to prevent flickering with old data
        const keysToRemove = [
          // User-specific timer keys
          `parkspot_timer_${userId}_end`,
          `parkspot_timer_${userId}_active`,
          `parkspot_timer_${userId}_hours`,
          `parkspot_timer_${userId}_minutes`,
          `parkspot_timer_${userId}_notification_id`,
          // Generic timer keys for backward compatibility
          'parkspot_timer_end',
          'parkspot_timer_active',
          'parkspot_timer_hours',
          'parkspot_timer_minutes',
          'parkspot_notification_id'
        ];
        
        // Get all AsyncStorage keys and find any timer-related ones
        try {
          const allKeys = await AsyncStorage.getAllKeys();
          const timerKeys = allKeys.filter(key => 
            key.includes('timer') || 
            key.includes('Timer') || 
            key.includes('notification') ||
            key.includes('Notification')
          );
          
          // Add any additional timer-related keys found
          timerKeys.forEach(key => {
            if (!keysToRemove.includes(key)) {
              keysToRemove.push(key);
            }
          });
        } catch (error) {
          console.error('Error getting all AsyncStorage keys:', error);
        }
        
        // Remove all timer-related keys
        await AsyncStorage.multiRemove(keysToRemove);
        
        console.log('Timer data cleared from AsyncStorage to prevent flickering');
        console.log('Cleared keys:', keysToRemove);
      } else {
        console.log('Preserving timer data on server for cross-platform persistence');
      }
      
      console.log(`Timer data cleared for user: ${userId}`);
    } catch (error) {
      console.error('Error clearing timer data:', error);
    }
  };

  // Clear all timer data for a specific user (for debugging/fixing issues)
  const clearAllTimerDataForUser = async (userId) => {
    try {
      console.log(`Clearing all timer data for user: ${userId}`);
      
      // Clear from server
      try {
        await axios.delete(`${API_URL}/timer-data`);
        console.log(`Cleared timer data from server for user: ${userId}`);
      } catch (error) {
        console.error('Error clearing timer data from server:', error);
      }
    } catch (error) {
      console.error('Error clearing all timer data for user:', error);
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

  const scheduleNotification = async (endTime, totalMilliseconds) => {
    // Cancel any existing notification
    if (notificationId) {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
    }
    
    const hours = parseFloat(timerHours) || 0;
    const minutes = parseFloat(timerMinutes) || 0;
    
    if (hours === 0 && minutes === 0) {
      Alert.alert('Invalid Time', 'Please set a valid time for the timer');
      return;
    }
    
    const totalSeconds = (hours * 3600) + (minutes * 60);
    
    // Format time message
    let timeMessage = '';
    if (hours > 0) {
      timeMessage += `${hours} hour${hours !== 1 ? 's' : ''}`;
    }
    if (minutes > 0) {
      if (hours > 0) timeMessage += ' and ';
      timeMessage += `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
    
    // Include user ID in the notification data to track which user it belongs to
    const userId = user?.id;
    
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Parking Timer",
        body: `Your parking time is up! Your car has been parked for ${timeMessage}.${parkingSpot?.address ? `\nLocation: ${parkingSpot.address}` : ''}`,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
        vibrate: [0, 250, 250, 250],
        data: { userId }
      },
      trigger: { 
        seconds: totalSeconds,
      },
    });
    
    console.log(`Scheduled notification with ID: ${identifier} for user: ${userId}`);
    
    // Set timer end time
    setTimerEnd(endTime);
    setTimerActive(true);
    setRemainingTime(totalMilliseconds);
    setNotificationId(identifier);
    setTimerExpired(false);
    
    // Don't save timer data here - startTimer will handle that
    // await saveTimerData(endTime, identifier);
    
    Alert.alert(
      "Timer Set",
      `You will be notified in ${timeMessage} about your parking.`,
      [{ text: "OK" }]
    );
    
    return identifier;
  };

  // Start timer
  const startTimer = async () => {
    // Prevent multiple timer starts in quick succession
    if (startTimer.isStarting) {
      console.log('Timer start already in progress, skipping duplicate start');
      return;
    }
    
    startTimer.isStarting = true;
    
    // Reset timer expired flag
    setTimerExpired(false);
    
    const hours = parseFloat(timerHours) || 0;
    const minutes = parseFloat(timerMinutes) || 0;
    
    if (hours === 0 && minutes === 0) {
      Alert.alert('Invalid Time', 'Please set a valid time for the timer');
      startTimer.isStarting = false;
      return;
    }
    
    if (!user || !user.id) {
      Alert.alert('Login Required', 'You must be logged in to set a timer');
      startTimer.isStarting = false;
      return;
    }
    
    // Clear any existing timer state first to prevent flickering
    if (timerInterval.current) {
      clearInterval(timerInterval.current);
      timerInterval.current = null;
    }
    setTimerActive(false);
    setTimerEnd(null);
    setRemainingTime(null);
    setTimerExpired(false);
    
    const totalMilliseconds = (hours * 60 * 60 * 1000) + (minutes * 60 * 1000);
    
    // Set timer end time
    const endTime = new Date(Date.now() + totalMilliseconds);
    
    // Store the user ID this timer belongs to
    const timerUserId = user.id;
    
    // Add a small delay to ensure any previous timer cleanup is complete
    setTimeout(async () => {
      try {
    // Schedule notification
    const notifId = await scheduleNotification(endTime, totalMilliseconds);
    
    // Save timer data
    await saveTimerData(endTime, notifId);
        
        // Start the countdown
        if (timerInterval.current) {
          clearInterval(timerInterval.current);
        }
        
        timerInterval.current = setInterval(() => {
          // Check if the user ID has changed (user switched)
          if (!user || user.id !== timerUserId) {
            console.log('User changed, stopping timer interval for user:', timerUserId);
            clearInterval(timerInterval.current);
            timerInterval.current = null;
            return;
          }
          
          const now = new Date();
          const end = new Date(endTime);
          const remaining = end - now;
          
          if (remaining <= 0) {
            // Timer expired
            clearInterval(timerInterval.current);
            timerInterval.current = null;
            setTimerActive(false);
            setTimerExpired(true);
            setRemainingTime(0);
            
            // Clear timer data
            clearTimerData(true);
          } else {
            setRemainingTime(remaining);
          }
        }, 1000);
    
    // Format message based on hours and minutes
    let timeMessage = '';
    if (hours > 0) {
      timeMessage += `${hours} hour${hours !== 1 ? 's' : ''}`;
    }
    if (minutes > 0) {
      if (hours > 0) timeMessage += ' and ';
      timeMessage += `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
    
        console.log(`Timer started for user: ${timerUserId}, duration: ${timeMessage}`);
    Alert.alert('Timer Started', `Timer set for ${timeMessage}`);
        
        // Reset the flag after a short delay
        setTimeout(() => {
          startTimer.isStarting = false;
        }, 2000);
      } catch (error) {
        console.error('Error starting timer:', error);
        Alert.alert('Error', 'Failed to start timer. Please try again.');
        startTimer.isStarting = false;
      }
    }, 100); // Small delay to prevent race conditions
  };

  // Cancel timer (user initiated)
  const cancelTimer = async () => {
    await clearTimerData(true); // Clear from server when user cancels
      // Reset timer expired state when user cancels
      setTimerExpired(false);
    setMessage('Timer canceled');
    setTimeout(() => setMessage(''), 3000);
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
      
      // Check if server is awake (for both development and production)
      const isServerAwake = await checkServerStatus();
      return {
        isConnected: true,
        isServerAvailable: isServerAwake,
        error: isServerAwake ? null : 'Server is starting up'
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
      if (!isAuthenticated || !user) {
        console.log('Not authenticated, skipping loadParkingSpot');
        return;
      }

    try {
      setLoading(true);
      
      // First check local storage for user-specific data
      const storageKey = `parkingSpot_${user.id}`;
      let localSpotData = null;
      
      try {
        const localSpot = await AsyncStorage.getItem(storageKey);
        if (localSpot) {
          localSpotData = JSON.parse(localSpot);
          console.log('Found parking spot in user-specific storage:', localSpotData);
        } else {
          // Check fallback storage
          const fallbackSpot = await AsyncStorage.getItem('lastParkingSpot');
          if (fallbackSpot) {
            const parsedFallback = JSON.parse(fallbackSpot);
            if (parsedFallback.user_id === user.id) {
              localSpotData = parsedFallback;
              console.log('Found parking spot in fallback storage:', localSpotData);
              
              // Migrate to user-specific key
              await AsyncStorage.setItem(storageKey, fallbackSpot);
            }
          }
        }
      } catch (error) {
        console.error('Error reading from local storage:', error);
      }
      
      // Try to get from server
      try {
      const response = await axios.get(`${API_URL}/parking-spot`);
      if (response.data) {
        setParkingSpot(response.data);
        setSavedTime(response.data.timestamp);
        setNotes(response.data.notes || '');
        setAddress(response.data.address || '');
          setParkingImage(response.data.imageUri);
          // Also save locally for persistence with user ID
          await AsyncStorage.setItem(storageKey, JSON.stringify(response.data));
          console.log('Loaded and saved parking spot from server:', response.data);
          return;
      } else {
          // No spot on server, clear local storage and state
          await AsyncStorage.removeItem(storageKey);
        setParkingSpot(null);
        setSavedTime(null);
        setNotes('');
        setAddress('');
        setParkingImage(null);
          console.log('No parking spot on server, cleared local storage and state');
          return;
      }
    } catch (error) {
        console.log('Error loading from server, using local storage:', error);
        // If server request fails, use local data if available
        if (localSpotData) {
          setParkingSpot(localSpotData);
          setSavedTime(localSpotData.timestamp);
          setNotes(localSpotData.notes || '');
          setAddress(localSpotData.address || '');
          setParkingImage(localSpotData.imageUri);
          console.log('Using local storage data after server error');
        }
      }
    } catch (error) {
      console.error('Error in loadParkingSpot:', error);
      setMessage('Error loading parking data');
    } finally {
      setLoading(false);
    }
  };

  const saveParkingSpot = async () => {
      if (!isAuthenticated || !user) {
      setMessage('Please login to save a parking spot');
        return;
      }

      setLoading(true);
    try {
      // Get current location
      let location;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setMessage('Location permission is required to save your parking spot');
          setLoading(false);
          return;
        }

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High
        });
        
        location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        };
      } catch (error) {
        console.error('Error getting location:', error);
        setMessage('Unable to get your location. Please try again.');
        setLoading(false);
        return;
      }

      // Create the parking spot data
      const timestamp = new Date().toISOString();
      const parkingData = {
        latitude: location.latitude,
        longitude: location.longitude,
        address,
        notes,
        imageUri: parkingImage,
        timestamp,
        user_id: user.id
      };
      
      // Define storage key for user-specific data
      const storageKey = `parkingSpot_${user.id}`;

      // Save to server
      try {
        const response = await axios.post(`${API_URL}/parking-spot`, parkingData);
      setParkingSpot(response.data);
      setSavedTime(response.data.timestamp);
      setMessage('Parking spot saved successfully!');
        console.log('Saved parking spot:', response.data);
        
        // Always save locally for persistence with user-specific key
        await AsyncStorage.setItem(storageKey, JSON.stringify(response.data));
        
        // Also save to the generic key for backward compatibility
        await AsyncStorage.setItem('lastParkingSpot', JSON.stringify(response.data));
    } catch (error) {
        console.error('Error saving to server:', error);
        
        // Save locally if server save fails
        const localSpot = {
          ...parkingData,
          id: 'local-' + Date.now(),
          savedOffline: true
        };
        
        setParkingSpot(localSpot);
        setSavedTime(timestamp);
        
        // Save with user-specific key
        await AsyncStorage.setItem(storageKey, JSON.stringify(localSpot));
        
        // Also save to generic key for backward compatibility
        await AsyncStorage.setItem('lastParkingSpot', JSON.stringify(localSpot));
        await AsyncStorage.setItem('offlineParkingSpot', JSON.stringify(parkingData));
        
        setMessage('Saved locally. Will sync when online.');
      }
      
      // Clear form fields
      setNotes('');
      setAddress('');
      } catch (error) {
      console.error('Error in saveParkingSpot:', error);
      setMessage('Error saving parking spot');
    } finally {
      setLoading(false);
    }
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
    
    try {
      // Create date from timestamp string
      const date = new Date(timestamp);
      
      // Check if date is valid
      if (isNaN(date.getTime())) {
        console.error('Invalid date from timestamp:', timestamp);
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
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'Date error';
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
    try {
      console.log('Checking if server is awake...');
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
          console.log('Server is awake and responding');
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
  };
  
  // Add useEffect to check server status on app start
  useEffect(() => {
    if (appIsReady) {
      checkServerStatus();
    }
  }, [appIsReady]);

  // Automatic login disabled to prevent timer flickering and ensure fresh login each time
  // Users must explicitly log in to access the app

  // Update getCurrentUser function
  const getCurrentUser = async () => {
    try {
      const response = await axios.get(`${API_URL}/users/me`);
      setUser(response.data);
      await AsyncStorage.setItem('user', JSON.stringify(response.data));
    } catch (error) {
      console.error('Error getting current user:', error);
      // Clear auth data on error
      await AsyncStorage.multiRemove(['token', 'user']);
      setIsAuthenticated(false);
      setUser(null);
    }
  };

  // Add login function
  const handleLogin = async () => {
    if (!authForm.username || !authForm.password) {
      setMessage('Username and password are required');
        return;
      }

    setLoading(true);
    try {
      // Cancel any existing notifications first
      try {
        const allNotifications = await Notifications.getAllScheduledNotificationsAsync();
        console.log(`Found ${allNotifications.length} scheduled notifications to clean up before login`);
        for (const notification of allNotifications) {
          await Notifications.cancelScheduledNotificationAsync(notification.identifier);
          console.log('Canceled notification before login:', notification.identifier);
        }
      } catch (error) {
        console.error('Error cleaning up notifications before login:', error);
      }
      
      // Clear any existing parking data from previous user
      setParkingSpot(null);
      setSavedTime(null);
      setNotes('');
      setAddress('');
      setParkingImage(null);

      const response = await axios.post(`${API_URL}/users/login`, {
        username: authForm.username,
        password: authForm.password
      });
      
      // Store auth data
      await AsyncStorage.setItem('token', response.data.token);
      await AsyncStorage.setItem('user', JSON.stringify(response.data.user));
      
      // Update state
      setIsAuthenticated(true);
      setUser(response.data.user);
      setAuthForm({ username: '', password: '', email: '' });
      
      // Store user data for use in the timeout
      const userData = response.data.user;
      
      // Wait for user state to be updated and ensure it's properly set
      setTimeout(async () => {
        try {
          // Double-check that user state is set
          if (userData && userData.id) {
            console.log('Loading timer data first for user:', userData.id);
            
            // Load timer data - pass user data directly to avoid state timing issues
            const timerLoaded = await loadTimerData(userData);
            console.log('Timer data loaded successfully:', timerLoaded);
            
            // Then load parking spot data
            console.log('Loading parking spot data for user:', userData.id);
            // Check for parking spot in user-specific storage
            const storageKey = `parkingSpot_${userData.id}`;
            const localSpot = await AsyncStorage.getItem(storageKey);
            
            if (localSpot) {
              const parsedSpot = JSON.parse(localSpot);
              setParkingSpot(parsedSpot);
              setSavedTime(parsedSpot.timestamp);
              setNotes(parsedSpot.notes || '');
              setAddress(parsedSpot.address || '');
              setParkingImage(parsedSpot.imageUri);
              console.log('Restored parking spot from storage after login for user:', userData.id);
            } else {
              // Check fallback storage
              const fallbackSpot = await AsyncStorage.getItem('lastParkingSpot');
              if (fallbackSpot) {
                const parsedFallback = JSON.parse(fallbackSpot);
                if (parsedFallback.user_id === userData.id) {
                  setParkingSpot(parsedFallback);
                  setSavedTime(parsedFallback.timestamp);
                  setNotes(parsedFallback.notes || '');
                  setAddress(parsedFallback.address || '');
                  setParkingImage(parsedFallback.imageUri);
                  console.log('Restored parking spot from fallback storage after login');
                  
                  // Migrate to user-specific key
                  await AsyncStorage.setItem(storageKey, fallbackSpot);
                }
              }
            }
            
            // Try to get from server as well
            try {
              const spotResponse = await axios.get(`${API_URL}/parking-spot`);
              if (spotResponse.data) {
                setParkingSpot(spotResponse.data);
                setSavedTime(spotResponse.data.timestamp);
                setNotes(spotResponse.data.notes || '');
                setAddress(spotResponse.data.address || '');
                setParkingImage(spotResponse.data.imageUri);
                
                // Save to user-specific storage
                await AsyncStorage.setItem(storageKey, JSON.stringify(spotResponse.data));
                console.log('Updated parking spot from server after login for user:', userData.id);
              }
            } catch (serverError) {
              console.log('Could not fetch parking spot from server:', serverError);
            }
            
            // Check for offline data to sync
            try {
              await checkAndSyncOfflineData();
            } catch (syncError) {
              console.log('Error syncing offline data:', syncError);
            }
          }
          
          setMessage('Login successful!');
          setTimeout(() => setMessage(''), 3000);
        } catch (err) {
          console.error('Error loading data after login:', err);
        }
      }, 100); // Reduced timeout to match web app and improve timer persistence
    } catch (error) {
      console.error('Login error:', error);
      // More detailed error handling
      if (error.response) {
        if (error.response.status === 401) {
          setMessage('Invalid username or password');
          Alert.alert('Login Failed', 'Invalid username or password. Please try again.');
        } else {
          setMessage(error.response.data?.error || 'Login failed');
          Alert.alert('Login Failed', error.response.data?.error || 'Login failed. Please try again.');
        }
      } else if (error.request) {
        setMessage('Network error. Please check your connection');
        Alert.alert('Connection Error', 'Unable to connect to the server. Please check your internet connection.');
      } else {
        setMessage('Login failed. Please try again');
        Alert.alert('Login Error', 'An unexpected error occurred. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Add register function
  const handleRegister = async () => {
    try {
      setLoading(true);
      const response = await axios.post(`${API_URL}/users/register`, {
        username: authForm.username,
        password: authForm.password,
        email: authForm.email
      });
      
      const { token, user } = response.data;
      
      // Save auth data
      await AsyncStorage.setItem('token', token);
      await AsyncStorage.setItem('user', JSON.stringify(user));
      
      // Update state
      setIsAuthenticated(true);
      setUser(user);
      setAuthForm({ username: '', password: '', email: '' });
    } catch (error) {
      console.error('Registration error:', error);
      Alert.alert('Registration Failed', error.response?.data?.error || 'Please try again with different credentials');
    } finally {
      setLoading(false);
    }
  };

  // Add helper function to clear parking data locally
  const clearLocalParkingData = async () => {
    // Clear local state
    setParkingSpot(null);
    setSavedTime(null);
    setNotes('');
    setAddress('');
    setParkingImage(null);

    // Clear any offline data
    await AsyncStorage.removeItem('offlineParkingSpot');
  };

  // Add logout function
  const handleLogout = async () => {
    try {
      // Store current user ID before logout
      const currentUserId = user?.id;
      
      if (!currentUserId) {
        console.log('No user ID found during logout');
        return;
      }
      
      // Cancel any active notifications before logging out
      if (notificationId) {
        try {
          await Notifications.cancelScheduledNotificationAsync(notificationId);
          console.log('Canceled notification with ID:', notificationId);
        } catch (notifError) {
          console.error('Error canceling notification:', notifError);
        }
      }
      
      // Also try to cancel any other notifications that might be active
      try {
        const allNotifications = await Notifications.getAllScheduledNotificationsAsync();
        console.log(`Found ${allNotifications.length} scheduled notifications to clean up`);
        for (const notification of allNotifications) {
          const notifUserId = notification.content?.data?.userId;
          if (notifUserId && parseInt(notifUserId) === parseInt(currentUserId)) {
            await Notifications.cancelScheduledNotificationAsync(notification.identifier);
            console.log('Canceled notification:', notification.identifier);
          }
        }
      } catch (error) {
        console.error('Error cleaning up notifications:', error);
      }
      
      // Preserve timer data on server for cross-platform persistence
      console.log('Preserving timer data on server for cross-platform persistence');
      
      // Clear auth data
      await AsyncStorage.multiRemove(['token', 'user']);
      
      // Reset timer state in memory when logging out
      if (timerInterval.current) {
        clearInterval(timerInterval.current);
        timerInterval.current = null;
      }
      setTimerActive(false);
      setTimerEnd(null);
      setRemainingTime(null);
      setTimerExpired(false);
      setNotificationId(null);
      
      // Reset auth state
      setIsAuthenticated(false);
      setUser(null);
      
      // Clear parking data from memory but preserve in storage
      setParkingSpot(null);
      setSavedTime(null);
      setNotes('');
      setAddress('');
      setParkingImage(null);
      
      console.log('Logged out and preserved timer data on server');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // Add auth form component
  const renderAuthForm = () => (
    <View style={styles.authContainer}>
      <View style={styles.authHeader}>
        <View style={styles.authLogoContainer}>
          <Icon name="map-marker" size={40} color="#f97316" style={styles.authLogoIcon} />
          <Text style={styles.authLogoText}>ParkSpot</Text>
        </View>
        <Text style={styles.logoTagline}>Find your car, every time</Text>
        
        <Text style={styles.authTitle}>
        {showLogin ? 'Login' : 'Register'}
      </Text>
      </View>
      
      <TextInput
        style={styles.input}
        placeholder="Username"
        value={authForm.username}
        onChangeText={(text) => setAuthForm(prev => ({ ...prev, username: text }))}
      />
      
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={authForm.password}
        onChangeText={(text) => setAuthForm(prev => ({ ...prev, password: text }))}
        secureTextEntry
      />
      
      <TouchableOpacity
        style={styles.button}
        onPress={showLogin ? handleLogin : handleRegister}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>
            {showLogin ? 'Login' : 'Register'}
          </Text>
        )}
      </TouchableOpacity>
      
      <TouchableOpacity
        onPress={() => setShowLogin(!showLogin)}
        style={styles.switchButton}
      >
        <Text style={styles.switchText}>
          {showLogin ? 'Need an account? Register' : 'Have an account? Login'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  // Timer UI Component
  const renderTimer = () => {
    if (timerActive) {
      return (
        <View style={styles.timerContainer}>
          <View style={styles.timerDisplay}>
            <Text style={styles.timerCountdown}>{formatRemainingTime(remainingTime)}</Text>
            <Text style={styles.timerLabel}>remaining</Text>
          </View>
          <TouchableOpacity
            style={[styles.button, styles.dangerButton, styles.smallButton]}
            onPress={cancelTimer}
          >
            <Icon name="bell-off" size={16} color="#ffffff" />
            <Text style={styles.buttonText}>Cancel Timer</Text>
          </TouchableOpacity>
        </View>
      );
    } else if (timerExpired) {
      return (
        <View style={styles.timerContainer}>
          <View style={styles.timerAlert}>
            <Text style={styles.timerAlertText}>Timer Expired!</Text>
            <Text style={styles.timerAlertSubtext}>Your parking time is up</Text>
          </View>
          <View style={styles.timerInputs}>
            <View style={styles.timerInputGroup}>
              <TextInput
                style={styles.timerInput}
                value={timerHours}
                onChangeText={setTimerHours}
                keyboardType="numeric"
                maxLength={2}
                placeholder="0"
              />
              <Text style={styles.timerUnit}>hours</Text>
            </View>
            <View style={styles.timerInputGroup}>
              <TextInput
                style={styles.timerInput}
                value={timerMinutes}
                onChangeText={setTimerMinutes}
                keyboardType="numeric"
                maxLength={2}
                placeholder="0"
              />
              <Text style={styles.timerUnit}>minutes</Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.button, styles.successButton, styles.smallButton]}
            onPress={startTimer}
          >
            <Icon name="bell" size={16} color="#ffffff" />
            <Text style={styles.buttonText}>Set New Timer</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton, styles.smallButton]}
            onPress={() => setTimerExpired(false)}
          >
            <Text style={styles.buttonText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      );
    } else {
      return (
        <View style={styles.timerContainer}>
          <View style={styles.timerInputs}>
            <View style={styles.timerInputGroup}>
              <TextInput
                style={styles.timerInput}
                value={timerHours}
                onChangeText={setTimerHours}
                keyboardType="numeric"
                maxLength={2}
                placeholder="0"
              />
              <Text style={styles.timerUnit}>hours</Text>
            </View>
            <View style={styles.timerInputGroup}>
              <TextInput
                style={styles.timerInput}
                value={timerMinutes}
                onChangeText={setTimerMinutes}
                keyboardType="numeric"
                maxLength={2}
                placeholder="0"
              />
              <Text style={styles.timerUnit}>minutes</Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.button, styles.successButton, styles.smallButton]}
            onPress={startTimer}
          >
            <Icon name="bell" size={16} color="#ffffff" />
            <Text style={styles.buttonText}>Set Timer</Text>
          </TouchableOpacity>
        </View>
      );
    }
  };

  // Clear parking spot function
  const clearParkingSpot = async () => {
    if (!isAuthenticated || !user) {
      setMessage('Please login to clear your parking spot');
      return;
    }

    // Show confirmation dialog before clearing
    Alert.alert(
      'Clear Parking Spot',
      'Are you sure you want to clear your parking spot? This action cannot be undone.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              // Try to clear from server
              try {
                await axios.delete(`${API_URL}/parking-spot`);
                setMessage('Parking spot cleared successfully!');
              } catch (error) {
                console.error('Error clearing from server:', error);
                setMessage('Could not connect to server. Cleared locally.');
              }
              
              // Always clear from local storage and state
              const storageKey = `parkingSpot_${user.id}`;
              await AsyncStorage.removeItem(storageKey);
              await AsyncStorage.removeItem('lastParkingSpot');
              await AsyncStorage.removeItem('offlineParkingSpot');
              
              setParkingSpot(null);
              setSavedTime(null);
              setNotes('');
              setAddress('');
              setParkingImage(null);
              
              // Clear timer when clearing parking spot as requested by user
              if (timerActive) {
                await clearTimerData(true);
              }
            } catch (error) {
              console.error('Error in clearParkingSpot:', error);
              setMessage('Error clearing parking spot');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  // Update the main render to handle auth state
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar style="auto" />
        
        {isAuthenticated ? (
          <>
            <View style={styles.header}>
              <View style={styles.titleContainer}>
                <View style={styles.logoContainer}>
                  <Icon name="map-marker" size={28} color="#f97316" style={styles.logoIcon} />
                <Text style={styles.title}>ParkSpot</Text>
                </View>
                <View style={styles.userInfo}>
                  <Text style={styles.username}>{user?.username}</Text>
                  <TouchableOpacity
                    style={styles.logoutButton}
                    onPress={handleLogout}
                  >
                    <Icon name="logout" size={24} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              </View>
              {message && (
                <Text style={styles.message}>{message}</Text>
              )}
            </View>

            <ScrollView style={styles.content}>
              {/* Map View */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardLogoContainer}>
                    <Icon name="map" size={24} color="#f97316" />
                    <Text style={styles.cardTitle}>Location Map</Text>
                  </View>
                </View>
                
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
              </View>

              {/* Controls */}
              {!parkingSpot ? (
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={styles.cardLogoContainer}>
                      <Icon name="car" size={24} color="#f97316" />
                      <Text style={styles.cardTitle}>Save Parking Spot</Text>
                    </View>
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
                      <Pressable
                        style={({pressed}) => [
                          styles.photoButton,
                          pressed && styles.primaryButtonPressed,
                        ]}
                        onPress={takePicture}
                      >
                        <Icon name="camera" size={20} color="#ffffff" />
                        <Text style={styles.photoButtonText}>Take Photo</Text>
                      </Pressable>
                      
                      <Pressable
                        style={({pressed}) => [
                          styles.photoButton,
                          pressed && styles.primaryButtonPressed,
                        ]}
                        onPress={pickImage}
                      >
                        <Icon name="image" size={20} color="#ffffff" />
                        <Text style={styles.photoButtonText}>Choose Photo</Text>
                      </Pressable>
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

                  <Pressable
                    style={({pressed}) => [
                      styles.button,
                      styles.primaryButton,
                      pressed && styles.primaryButtonPressed,
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
                  </Pressable>
                </View>
              ) : (
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={styles.cardLogoContainer}>
                      <Icon name="car" size={24} color="#f97316" />
                    <Text style={styles.cardTitle}>Your Parking Spot</Text>
                    </View>
                  </View>

                  <View style={styles.infoHighlight}>
                    <View style={styles.timeDisplay}>
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
                    
                    {renderTimer()}
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

                  <View style={styles.buttonGroup}>
                    <Pressable
                      style={({pressed}) => [
                        styles.button,
                        styles.primaryButton,
                        styles.buttonFlex,
                        pressed && styles.primaryButtonPressed,
                      ]}
                      onPress={getDirections}
                    >
                      <Icon name="directions" size={20} color="#ffffff" />
                      <Text style={styles.buttonText}>Get Directions</Text>
                    </Pressable>
                    
                    <Pressable
                      style={({pressed}) => [
                        styles.button,
                        styles.dangerButton,
                        styles.buttonFlex,
                        pressed && styles.dangerButtonPressed,
                      ]}
                      onPress={clearParkingSpot}
                    >
                          <Icon name="delete" size={20} color="#ffffff" />
                          <Text style={styles.buttonText}>Clear Spot</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </ScrollView>
          </>
        ) : (
          renderAuthForm()
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff9f0', // Light orange background
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingTop: 10,
  },
  titleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#f97316', // Orange color for title
    marginLeft: 8,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    position: 'absolute',
    right: 16,
    top: 10,
  },
  username: {
    fontSize: 14,
    color: '#4b5563',
  },
  logoutButton: {
    padding: 4,
  },
  message: {
    color: '#6b7280',
    marginTop: 12,
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
  },
  map: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255, 249, 240, 0.95)', // Light orange with transparency
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '70%',
  },
  scrollContent: {
    paddingBottom: 20,
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
    borderBottomWidth: 1,
    borderBottomColor: '#fdba74', /* Medium orange to match website */
    paddingBottom: 12,
    marginBottom: 16,
  },
  cardLogoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#f97316', /* Orange color to match website */
    marginLeft: 8,
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#9a3412', /* Dark orange to match website */
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  textArea: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: 'top',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  button: {
    backgroundColor: '#f97316', // Orange button
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  primaryButton: {
    backgroundColor: '#f97316', // Orange primary button
  },
  primaryButtonPressed: {
    backgroundColor: '#ea580c', // Darker orange for pressed state (like hover on web)
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
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
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
    backgroundColor: '#f97316', // Orange photo button
    padding: 10,
    borderRadius: 8,
    flex: 0.48,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
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
    borderRadius: 8,
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
    backgroundColor: '#ffedd5', // Light orange highlight
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#fdba74', // Slightly darker orange border
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
    color: '#9a3412', /* Dark orange to match website */
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    color: '#111827',
  },
  savedImage: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    resizeMode: 'cover',
    marginTop: 8,
  },
  timerContainer: {
    marginVertical: 15,
    padding: 15,
    backgroundColor: '#ffedd5', // Light orange timer background
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fdba74', // Slightly darker orange border
  },
  timerDisplay: {
    alignItems: 'center',
    marginBottom: 10,
  },
  timerCountdown: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#9a3412', // Dark orange for timer
  },
  timerLabel: {
    fontSize: 14,
    color: '#6c757d',
  },
  timerAlert: {
    alignItems: 'center',
    marginBottom: 15,
    padding: 10,
    backgroundColor: '#dc3545',
    borderRadius: 8,
  },
  timerAlertText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  timerAlertSubtext: {
    fontSize: 14,
    color: '#ffffff',
    opacity: 0.9,
  },
  timerInputs: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 15,
  },
  timerInputGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 10,
  },
  timerInput: {
    width: 60,
    height: 40,
    borderWidth: 1,
    borderColor: '#fdba74', // Orange border
    borderRadius: 8,
    paddingHorizontal: 10,
    marginRight: 5,
    textAlign: 'center',
    fontSize: 16,
    backgroundColor: '#ffffff',
  },
  timerUnit: {
    fontSize: 14,
    color: '#6c757d',
  },
  successButton: {
    backgroundColor: '#28a745',
  },
  syncContainer: {
    backgroundColor: '#fffbeb',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#fcd34d',
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
  buttonGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 8,
  },
  buttonFlex: {
    flex: 1,
  },
  authContainer: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    backgroundColor: '#fff9f0', // Light orange background
  },
  authHeader: {
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
  },
  authLogoContainer: {
    flexDirection: 'column',
    alignItems: 'center',
  },
  authLogoIcon: {
    marginBottom: 8,
  },
  authLogoText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#f97316', // Orange color for logo
    textAlign: 'center',
  },
  logoTagline: {
    fontSize: 16,
    fontWeight: '700',
    color: '#9a3412', // Dark orange for tagline
    textAlign: 'center',
    marginBottom: 24,
    letterSpacing: 0.5,
  },
  authTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 10,
    marginBottom: 20,
    color: '#f97316', // Orange color for auth title
    textAlign: 'center',
  },
  authInput: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 6,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
  },
  authButton: {
    backgroundColor: '#f97316', // Orange auth button
    padding: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  authButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  switchButton: {
    marginTop: 16,
    alignItems: 'center',
  },
  switchText: {
    color: '#f97316', // Orange switch text
    fontSize: 16,
  },
  smallButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f97316', // Orange icon button
  },
  iconButtonSmall: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  dangerButtonPressed: {
    backgroundColor: '#b91c1c',
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoIcon: {
    marginRight: 0,
  },
  logoText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#f97316', // Orange color for logo
  },
}); 