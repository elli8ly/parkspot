import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { 
  CheckCircleIcon, 
  TrashIcon,
  ArrowTopRightOnSquareIcon,
  UserIcon,
  LockClosedIcon,
  ArrowRightOnRectangleIcon,
  UserPlusIcon,
  BellAlertIcon,
  BellSlashIcon
} from '@heroicons/react/24/outline';
import { MapPinIcon as MapPinIconSolid } from '@heroicons/react/24/solid';
import 'leaflet/dist/leaflet.css';
import './App.css';
import { API_URL } from './config';

// Custom Car Icon Component
const CarIcon = ({ className, ...props }) => (
  <svg 
    className={className} 
    viewBox="0 0 24 24" 
    fill="currentColor" 
    {...props}
  >
    <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.22.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
  </svg>
);

// Custom map icon component to match MaterialCommunityIcons
const MapIcon = ({ className, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    {...props}
  >
    <path d="M20.5,3L20.34,3.03L15,5.1L9,3L3.36,4.9C3.15,4.97 3,5.15 3,5.38V20.5A0.5,0.5 0 0,0 3.5,21L3.66,20.97L9,18.9L15,21L20.64,19.1C20.85,19.03 21,18.85 21,18.62V3.5A0.5,0.5 0 0,0 20.5,3M15,19L9,16.89V5L15,7.11V19Z"/>
  </svg>
);

// Fix for default markers in react-leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

// Create axios instance with auth header
const authAxios = axios.create({
  baseURL: API_URL
});

// Add interceptor to add token to requests
authAxios.interceptors.request.use(
  config => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  error => {
    return Promise.reject(error);
  }
);

function App() {
  const [parkingSpot, setParkingSpot] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState('');
  const [savedTime, setSavedTime] = useState(null);

  // Auth states
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [showLogin, setShowLogin] = useState(true);
  const [authForm, setAuthForm] = useState({
    username: '',
    password: '',
    email: ''
  });

  // Timer states
  const [timerHours, setTimerHours] = useState('2');
  const [timerMinutes, setTimerMinutes] = useState('0');
  const [timerActive, setTimerActive] = useState(false);
  const [timerEnd, setTimerEnd] = useState(null);
  const [remainingTime, setRemainingTime] = useState(null);
  const [timerExpired, setTimerExpired] = useState(false);
  const timerInterval = useRef(null);
  const locationWatchId = useRef(null);
  const notificationSound = useRef(null);
  const timerUserIdRef = useRef(null); // Store user ID for timer isolation

  // Comprehensive timer state reset function (like page refresh)
  const resetTimerState = () => {
    console.log('Resetting all timer state to prevent flickering');
    
    // Clear any running intervals
    if (timerInterval.current) {
      clearInterval(timerInterval.current);
      timerInterval.current = null;
    }
    
    // Reset all timer state variables to initial values
    setTimerActive(false);
    setTimerEnd(null);
    setRemainingTime(null);
    setTimerExpired(false);
    
    // Reset timer input values to defaults
    setTimerHours('2');
    setTimerMinutes('0');
    
    // Clear user ID reference
    timerUserIdRef.current = null;
    
    // Reset any function flags
    if (startTimer.isStarting) {
      startTimer.isStarting = false;
    }
    
    console.log('Timer state reset complete');
  };

  // Check if user is already logged in
  useEffect(() => {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');
    
    if (token && userData) {
      setIsAuthenticated(true);
      setUser(JSON.parse(userData));
      
      // Verify token is still valid
      getCurrentUser();
    }
  }, []);

  // Load existing parking spot on component mount if authenticated
  useEffect(() => {
    if (isAuthenticated) {
    loadParkingSpot();
      startLocationTracking();
    }
    
    return () => {
      // Clean up location tracking when component unmounts
      stopLocationTracking();
    };
  }, [isAuthenticated]);

  // Load timer data from localStorage
  useEffect(() => {
    if (isAuthenticated) {
      // Load timer data when user is authenticated
      loadTimerData();
    }
  }, [isAuthenticated]);

  // Initialize notification sound
  useEffect(() => {
    // Create audio element for notification sound
    notificationSound.current = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    notificationSound.current.preload = 'auto';
    
    return () => {
      // Clean up audio
      if (notificationSound.current) {
        notificationSound.current.pause();
        notificationSound.current = null;
      }
    };
  }, []);

  // Start continuous location tracking with better error handling
  const startLocationTracking = () => {
    if (!navigator.geolocation) {
      setMessage('Geolocation is not supported by this browser.');
      return;
    }
    
    // Get initial location with longer timeout
    getCurrentLocation();
    
    // Options for continuous tracking - less strict than initial position
    const watchOptions = {
      enableHighAccuracy: false, // Lower accuracy to avoid timeout errors
      maximumAge: 60000,        // Accept positions up to 1 minute old
      timeout: 30000            // Longer timeout to prevent frequent errors
    };
    
    // Start watching position with error handling
    try {
      locationWatchId.current = navigator.geolocation.watchPosition(
        (position) => {
          console.log('Location updated successfully');
          setCurrentLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
          // Handle specific error codes
          let errorMessage = 'Location tracking error';
          switch(error.code) {
            case 1: // PERMISSION_DENIED
              errorMessage = 'Location permission denied';
              break;
            case 2: // POSITION_UNAVAILABLE
              console.warn('Position update unavailable, will retry');
              // Don't show message to user for this error, just log it
              return;
            case 3: // TIMEOUT
              console.warn('Location timeout, will retry');
              // Don't show message to user for this error, just log it
              return;
            default:
              errorMessage = `Location error: ${error.message}`;
          }
          console.error('Error tracking location:', error);
          
          // Only show permission errors to user, not technical ones
          if (error.code === 1) {
            setMessage(errorMessage);
          }
        },
        watchOptions
      );
      
      console.log('Location tracking started');
    } catch (e) {
      console.error('Error starting location tracking:', e);
      // Fallback to periodic manual position checks
      startFallbackLocationTracking();
    }
  };
  
  // Fallback method using periodic getCurrentPosition calls
  const startFallbackLocationTracking = () => {
    console.log('Using fallback location tracking');
    const intervalId = setInterval(() => {
      getCurrentLocation(false); // false = don't show errors to user
    }, 30000); // Update every 30 seconds
    
    // Store interval ID for cleanup
    locationWatchId.current = {
      isFallback: true,
      id: intervalId
    };
  };
  
  // Stop location tracking
  const stopLocationTracking = () => {
    if (locationWatchId.current) {
      if (locationWatchId.current.isFallback) {
        // Clear interval for fallback tracking
        clearInterval(locationWatchId.current.id);
      } else if (navigator.geolocation) {
        // Clear watch for native tracking
        navigator.geolocation.clearWatch(locationWatchId.current);
      }
      locationWatchId.current = null;
      console.log('Location tracking stopped');
    }
  };

  const getCurrentLocation = (showErrors = true) => {
    if (!navigator.geolocation) {
      if (showErrors) {
        setMessage('Geolocation is not supported by this browser.');
      }
      return;
    }
    
    // Options for initial position - higher accuracy but more lenient timeout
    const positionOptions = {
      enableHighAccuracy: true,
      maximumAge: 30000,     // Accept positions up to 30 seconds old
      timeout: 60000         // 60 second timeout for initial position
    };
    
    navigator.geolocation.getCurrentPosition(
      (position) => {
        console.log('Got current location successfully');
          setCurrentLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
          console.error('Error getting location:', error);
        if (showErrors) {
          // Only show user-actionable errors
          if (error.code === 1) { // PERMISSION_DENIED
            setMessage('Location permission denied. Please enable location services.');
          } else if (!currentLocation) {
            // Only show technical errors if we don't have any location yet
            setMessage('Unable to get your location. Using default map view.');
          }
        }
        
        // If we can't get location and don't have one, set a default
        if (!currentLocation) {
          // Default location (could be customized based on user's country/region)
          setCurrentLocation({
            lat: 29.7604, // Default to Houston
            lng: -95.3698
          });
        }
      },
      positionOptions
    );
  };

  // Update notification message to include hours and minutes
  useEffect(() => {
    if (timerActive && timerEnd) {
      // Store the user ID this timer belongs to
      timerUserIdRef.current = user?.id;
      
      // Update timer every second
      timerInterval.current = setInterval(() => {
        // Check if the user ID has changed (user switched)
        if (!user || user.id !== timerUserIdRef.current) {
          console.log('User changed, stopping timer interval for user:', timerUserIdRef.current);
          clearInterval(timerInterval.current);
          timerInterval.current = null;
          return;
        }
        
        const now = new Date();
        const endTime = new Date(timerEnd);
        const diff = endTime - now;
        
        if (diff <= 0) {
          // Timer finished
          clearInterval(timerInterval.current);
          setTimerActive(false);
          setRemainingTime(null);
          setTimerEnd(null);
          // Set timer expired flag for UI notification
          setTimerExpired(true);
          // Clear the saved timer data
          clearTimerData(true);
          
          // Play notification sound
          if (notificationSound.current) {
            notificationSound.current.play().catch(e => {
              console.warn('Could not play notification sound:', e);
            });
          }
          
          // Show browser notification when timer ends
          if ('Notification' in window && Notification.permission === 'granted') {
            const locationInfo = parkingSpot && parkingSpot.address 
              ? `Your car is parked at: ${parkingSpot.address}` 
              : `Your parking time is up!`;
              
            // Format time message
            const hours = parseFloat(timerHours) || 0;
            const minutes = parseFloat(timerMinutes) || 0;
            let timeMessage = '';
            
            if (hours > 0) {
              timeMessage += `${hours} hour${hours !== 1 ? 's' : ''}`;
            }
            if (minutes > 0) {
              if (hours > 0) timeMessage += ' and ';
              timeMessage += `${minutes} minute${minutes !== 1 ? 's' : ''}`;
            }
              
            new Notification('Parking Timer', {
              body: `${locationInfo} (Parked for ${timeMessage})`,
              icon: '/favicon.ico'
            });
          }
          
          // Show prominent message to user
          setMessage('⏰ Your parking timer has expired!');
          // Keep this message visible longer
          setTimeout(() => setMessage(''), 10000);
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
  }, [timerActive, timerEnd, timerHours, timerMinutes, parkingSpot]);

  const getCurrentUser = async () => {
    try {
      const response = await authAxios.get(`/users/me`);
      setUser(response.data);
    } catch (error) {
      console.error('Error getting current user:', error);
      // Token might be invalid or expired
      handleLogout();
    }
  };

  const handleAuthFormChange = (e) => {
    setAuthForm({
      ...authForm,
      [e.target.name]: e.target.value
    });
  };

  const handleLogout = () => {
    // Preserve timer data on server for cross-platform persistence
    console.log('Logging out and preserving timer data on server');
    
    // Stop the timer interval but keep the data on server
    if (timerInterval.current) {
      clearInterval(timerInterval.current);
      timerInterval.current = null;
    }
    
    // Reset timer state in memory when logging out
    setTimerActive(false);
    setTimerEnd(null);
    setRemainingTime(null);
    setTimerExpired(false);
    
    // Clear authentication data
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    
    // Reset auth state
    setIsAuthenticated(false);
    setUser(null);
    setParkingSpot(null); // Clear from state but not storage
    
    console.log('Logged out and preserved timer data on server');
    setMessage('You have been logged out.');
    setTimeout(() => setMessage(''), 3000);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Clear any existing timer state first
      if (timerInterval.current) {
        clearInterval(timerInterval.current);
        timerInterval.current = null;
      }
      setTimerActive(false);
      setTimerEnd(null);
      setRemainingTime(null);
      setTimerExpired(false);
      
      const response = await axios.post(`${API_URL}/users/login`, {
        username: authForm.username,
        password: authForm.password
      });
      
      // Store auth data
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
      
      // Update state
      setIsAuthenticated(true);
      setUser(response.data.user);
      setAuthForm({ username: '', password: '', email: '' });
      
      // Wait for user state to be updated and ensure it's properly set
      setTimeout(async () => {
        try {
          // Double-check that user state is set
          if (user && user.id) {
            console.log('Loading timer data first for user:', user.id);
            
            // Load timer data - pass user data directly to avoid state timing issues
            const timerLoaded = await loadTimerData();
            console.log('Timer data loaded successfully:', timerLoaded);
            
            // Then load parking spot data
            await loadParkingSpot();
          }
          
          setMessage('Login successful!');
          setTimeout(() => setMessage(''), 3000);
        } catch (err) {
          console.error('Error loading data after login:', err);
        }
      }, 100); // Reduced delay to prevent flickering
    } catch (error) {
      console.error('Login error:', error);
      
      // More detailed error handling
      if (error.response) {
        if (error.response.status === 401) {
          setMessage('Invalid username or password');
        } else {
          setMessage(error.response.data?.error || 'Login failed');
        }
      } else if (error.request) {
        setMessage('Network error. Please check your connection');
      } else {
        setMessage('Login failed. Please try again');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const response = await axios.post(`${API_URL}/users/register`, {
        username: authForm.username,
        password: authForm.password,
        email: authForm.email
      });
      
      const { token, user } = response.data;
      
      // Save token and user data
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      
      setIsAuthenticated(true);
      setUser(user);
      setMessage(`Welcome, ${user.username}! Your account has been created.`);
      
      // Reset form
      setAuthForm({ username: '', password: '', email: '' });
      
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error('Registration error:', error);
      setMessage(error.response?.data?.error || 'Registration failed. Please try again.');
      setTimeout(() => setMessage(''), 3000);
    } finally {
      setLoading(false);
    }
  };

  const loadParkingSpot = async () => {
    if (!user || !user.id) {
      console.log('No user data available for loading parking spot');
      return;
    }
    
    try {
      // Try to get from server first
      const response = await authAxios.get(`/parking-spot`);
      if (response.data) {
        setParkingSpot(response.data);
        // Set the timestamp from the response
        if (response.data.timestamp) {
          console.log('Received timestamp:', response.data.timestamp);
          setSavedTime(response.data.timestamp);
        } else {
          console.log('No timestamp in response, using current time');
          setSavedTime(new Date().toISOString());
        }
        // Set notes and address from response
        setNotes(response.data.notes || '');
        setAddress(response.data.address || '');
        // Update localStorage with the latest data using user-specific key
        const storageKey = `parkingSpot_${user.id}`;
        localStorage.setItem(storageKey, JSON.stringify(response.data));
        // Also update generic key for backward compatibility
        localStorage.setItem('parkingSpot', JSON.stringify(response.data));
        return;
      } else {
        // No spot on server, clear localStorage and state
        const storageKey = `parkingSpot_${user.id}`;
        localStorage.removeItem(storageKey);
        localStorage.removeItem('parkingSpot');
        setParkingSpot(null);
        setSavedTime(null);
        setNotes('');
        setAddress('');
        return;
      }
    } catch (error) {
      console.error('Error loading parking spot from server:', error);
      
      // Try to load from localStorage if server request failed
      const storageKey = `parkingSpot_${user.id}`;
      const localSpot = localStorage.getItem(storageKey);
      
      if (localSpot) {
        const parsedSpot = JSON.parse(localSpot);
        // Verify it's for the current user
        if (parsedSpot.user_id === user.id) {
          console.log('Loading parking spot from localStorage after server error:', parsedSpot);
          setParkingSpot(parsedSpot);
          setSavedTime(parsedSpot.timestamp);
          setNotes(parsedSpot.notes || '');
          setAddress(parsedSpot.address || '');
        }
      } else {
        // Check generic key as fallback
        const fallbackSpot = localStorage.getItem('parkingSpot');
        if (fallbackSpot) {
          const parsedFallback = JSON.parse(fallbackSpot);
          if (parsedFallback.user_id === user.id) {
            console.log('Loading parking spot from fallback storage after error:', parsedFallback);
            setParkingSpot(parsedFallback);
            setSavedTime(parsedFallback.timestamp);
            setNotes(parsedFallback.notes || '');
            setAddress(parsedFallback.address || '');
            
            // Migrate to user-specific key
            localStorage.setItem(storageKey, fallbackSpot);
          }
        }
      }
      
      if (error.response?.status === 401 || error.response?.status === 403) {
        handleLogout();
      }
    }
  };

  const saveParkingSpot = async () => {
    if (!currentLocation) {
      // Try to get location one more time before giving up
      setMessage('Trying to get your current location...');
      
      // Promise-based wrapper for getCurrentPosition
      const getPositionPromise = () => {
        return new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            position => {
              resolve({
                lat: position.coords.latitude,
                lng: position.coords.longitude
              });
            },
            error => {
              reject(error);
            },
            { 
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 0
            }
          );
        });
      };
      
      try {
        // Try to get location one last time
        const location = await getPositionPromise();
        setCurrentLocation(location);
        
        // Continue with saving using the new location
        await saveSpotWithLocation(location);
      } catch (error) {
        console.error('Final attempt to get location failed:', error);
        setMessage('Unable to get your location. Please try again or enable location services.');
      return;
      }
    } else {
      // We already have a location, proceed with saving
      await saveSpotWithLocation(currentLocation);
    }
  };

  // Helper function to save spot with a known location
  const saveSpotWithLocation = async (location) => {
    if (!user || !user.id) {
      console.log('No user data available for saving parking spot');
      return;
    }
    
    setLoading(true);
    try {
      const response = await authAxios.post(`/parking-spot`, {
        latitude: location.lat,
        longitude: location.lng,
        address,
        notes
      });
      
      setParkingSpot(response.data);
      // Use the timestamp from the server response
      setSavedTime(response.data.timestamp);
      
      // Save to localStorage for persistence with user-specific key
      const storageKey = `parkingSpot_${user.id}`;
      localStorage.setItem(storageKey, JSON.stringify(response.data));
      
      // Also save to generic key for backward compatibility
      localStorage.setItem('parkingSpot', JSON.stringify(response.data));
      
      setMessage('🎉 Parking spot saved successfully!');
      setNotes('');
      setAddress('');
      
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error('Error saving parking spot:', error);
      setMessage('Error saving parking spot. Please try again.');
      if (error.response?.status === 401 || error.response?.status === 403) {
        handleLogout();
      }
    } finally {
      setLoading(false);
    }
  };

  const clearParkingSpot = async () => {
    if (!user || !user.id) {
      setMessage('Please login to clear parking spot');
      return;
    }
    
    setLoading(true);
    
    try {
      await authAxios.delete('/parking-spot');
      setParkingSpot(null);
      setSavedTime(null);
      
      // Clear timer when clearing parking spot as requested by user
      if (timerActive) {
        clearTimerData(true);
      }
      
      // Reset all timer state to prevent flickering
      resetTimerState();
      
      setMessage('Parking spot cleared!');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error('Error clearing parking spot:', error);
      setMessage('Error clearing parking spot. Please try again.');
      if (error.response?.status === 401 || error.response?.status === 403) {
        handleLogout();
      }
    } finally {
      setLoading(false);
    }
  };

  const getDirections = () => {
    if (parkingSpot && currentLocation) {
      const url = `https://www.google.com/maps/dir/${currentLocation.lat},${currentLocation.lng}/${parkingSpot.latitude},${parkingSpot.longitude}`;
      window.open(url, '_blank');
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

  // Save timer data to localStorage and server
  const saveTimerData = async (endTime) => {
    if (!user || !user.id) return;
    
    // Prevent multiple saves in quick succession
    if (saveTimerData.isSaving) {
      console.log('Timer save already in progress, skipping duplicate save');
      return;
    }
    
    saveTimerData.isSaving = true;
    
    try {
      // Save to server for cross-platform sync
      await authAxios.post('/timer-data', {
        timer_end: endTime.toISOString(),
        timer_active: true,
        timer_hours: timerHours,
        timer_minutes: timerMinutes
      });
      console.log('Timer data saved to server for cross-platform sync');
    } catch (error) {
      console.error('Error saving timer data to server:', error);
    } finally {
      // Reset the flag after a short delay to prevent rapid successive saves
      setTimeout(() => {
        saveTimerData.isSaving = false;
      }, 1000);
    }
  };

  // Clear timer data from localStorage and server
  const clearTimerData = async (clearFromStorage = true) => {
    if (!user || !user.id) return;
    
    if (clearFromStorage) {
      // Clear from server for cross-platform sync
      try {
        await authAxios.delete('/timer-data');
        console.log('Timer data cleared from server for cross-platform sync');
      } catch (error) {
        console.error('Error clearing timer data from server:', error);
        // Continue with local clearing even if server clear fails
      }
      
      // Clear from localStorage to prevent flickering with old data
      const userId = user.id;
      
      // Clear user-specific timer keys
      localStorage.removeItem(`parkspot_timer_${userId}_end`);
      localStorage.removeItem(`parkspot_timer_${userId}_active`);
      localStorage.removeItem(`parkspot_timer_${userId}_hours`);
      localStorage.removeItem(`parkspot_timer_${userId}_minutes`);
      localStorage.removeItem(`parkspot_timer_${userId}_notification_id`);
      
      // Clear generic timer keys for backward compatibility
      localStorage.removeItem('parkspot_timer_end');
      localStorage.removeItem('parkspot_timer_active');
      localStorage.removeItem('parkspot_timer_hours');
      localStorage.removeItem('parkspot_timer_minutes');
      localStorage.removeItem('parkspot_notification_id');
      
      // Clear any other possible timer-related keys
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('timer') || key.includes('Timer') || key.includes('notification'))) {
          keysToRemove.push(key);
        }
      }
      
      keysToRemove.forEach(key => {
        localStorage.removeItem(key);
        console.log(`Cleared additional timer-related key: ${key}`);
      });
      
      console.log('Timer data cleared from localStorage to prevent flickering');
    }
    
    setTimerActive(false);
    setTimerEnd(null);
    setRemainingTime(null);
    // Don't reset timer expired here, as we want to show the expired state
    // when timer naturally ends, but not when user cancels
  };

  // Start timer
  const startTimer = () => {
    if (!user || !user.id) {
      setMessage('Please login to start a timer');
      return;
    }
    
    // Prevent multiple timer starts in quick succession
    if (startTimer.isStarting) {
      console.log('Timer start already in progress, skipping duplicate start');
      return;
    }
    
    startTimer.isStarting = true;
    
    const hours = parseFloat(timerHours) || 0;
    const minutes = parseFloat(timerMinutes) || 0;
    
    if (hours === 0 && minutes === 0) {
      setMessage('Please set a valid time for the timer');
      startTimer.isStarting = false;
      return;
    }
    
    // Reset all timer state first to prevent flickering (like page refresh)
    resetTimerState();
    
    const totalMilliseconds = (hours * 3600 + minutes * 60) * 1000;
    const endTime = new Date(Date.now() + totalMilliseconds);
    
    // Add a small delay to ensure any previous timer cleanup is complete
    setTimeout(() => {
      setTimerEnd(endTime);
      setTimerActive(true);
      setRemainingTime(totalMilliseconds);
      setTimerExpired(false);
      
      // Save timer data to localStorage and server
      saveTimerData(endTime);
      
      setMessage(`Timer started for ${hours} hour${hours !== 1 ? 's' : ''} and ${minutes} minute${minutes !== 1 ? 's' : ''}`);
      setTimeout(() => setMessage(''), 3000);
      
      // Reset the flag after a short delay
      setTimeout(() => {
        startTimer.isStarting = false;
      }, 2000);
    }, 100); // Small delay to prevent race conditions
  };

  // Cancel timer (user initiated)
  const cancelTimer = async () => {
    await clearTimerData(true); // Clear from storage when user cancels
    // Reset all timer state to prevent flickering
    resetTimerState();
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

  // Auth forms
  const renderLoginForm = () => (
    <div className="auth-container">
      <div className="auth-card">
        <div className="parkmate-logo">
          <MapPinIconSolid className="logo-icon" />
          ParkSpot
        </div>
        <p className="auth-subtitle">Find your car, every time</p>
        
        <h2 className="login-title">
          Login
        </h2>
        
        {message && (
          <div className={`message ${message.includes('Invalid') || message.includes('failed') ? 'error' : ''}`}>
            {message}
          </div>
        )}
        
        <form onSubmit={handleLogin} className="auth-form">
          <div className="form-group">
            <label className="label">
              <UserIcon className="icon-sm" />
              Username
            </label>
            <input
              type="text"
              name="username"
              value={authForm.username}
              onChange={handleAuthFormChange}
              className="input"
              required
            />
          </div>
          
          <div className="form-group">
            <label className="label">
              <LockClosedIcon className="icon-sm" />
              Password
            </label>
            <input
              type="password"
              name="password"
              value={authForm.password}
              onChange={handleAuthFormChange}
              className="input"
              required
            />
          </div>
          
          <button 
            type="submit" 
            className="btn btn-primary btn-full"
            disabled={loading}
          >
            {loading ? <span className="loader"></span> : (
              <>
                <ArrowRightOnRectangleIcon className="icon-sm" />
                Login
              </>
            )}
          </button>
        </form>
        
        <div className="auth-footer">
          <p>Don't have an account?</p>
          <button 
            onClick={() => setShowLogin(false)} 
            className="btn secondary-button btn-full"
          >
            Register
          </button>
        </div>
      </div>
    </div>
  );

  const renderRegisterForm = () => (
    <div className="auth-container">
      <div className="auth-card">
        <div className="parkmate-logo">
          <MapPinIconSolid className="logo-icon" />
          ParkSpot
        </div>
        <p className="auth-subtitle">Find your car, every time</p>
        
        <h2 className="login-title">
          Register
        </h2>
        
        {message && (
          <div className={`message ${message.includes('failed') || message.includes('exists') ? 'error' : ''}`}>
            {message}
          </div>
        )}
        
        <form onSubmit={handleRegister} className="auth-form">
          <div className="form-group">
            <label className="label">
              <UserIcon className="icon-sm" />
              Username
            </label>
            <input
              type="text"
              name="username"
              value={authForm.username}
              onChange={handleAuthFormChange}
              placeholder="Choose a username"
              className="input"
              required
            />
          </div>
          
          <div className="form-group">
            <label className="label">
              <LockClosedIcon className="icon-sm" />
              Password
            </label>
            <input
              type="password"
              name="password"
              value={authForm.password}
              onChange={handleAuthFormChange}
              placeholder="Create a password"
              className="input"
              required
            />
          </div>
          
          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary btn-full"
          >
            {loading ? 'Creating Account...' : (
              <>
                <UserPlusIcon className="icon-sm" />
                Create Account
              </>
            )}
          </button>
        </form>
        
        <div className="auth-footer">
          <p>Already have an account?</p>
          <button 
            onClick={() => setShowLogin(true)} 
            className="btn secondary-button btn-full"
          >
            Login
          </button>
        </div>
      </div>
    </div>
  );

  // Main app content when authenticated
  const renderAppContent = () => (
    <div className="container">
      <div className="header">
        <div className="header-content">
          <h1 className="title">
            <MapPinIconSolid className="icon-lg" />
            ParkSpot
          </h1>
          <p className="subtitle">Never forget where you parked again!</p>
        </div>
        
        {user && (
          <div className="user-info">
            <span>Welcome, {user.username}!</span>
            <button onClick={handleLogout} className="btn btn-small">
              <ArrowRightOnRectangleIcon className="icon-sm" />
              <span>Logout</span>
            </button>
          </div>
        )}
      </div>

      {message && (
        <div className="message">
          {message}
        </div>
      )}

      <div className="grid">
        {/* Left Panel - Controls */}
        <div>
          {!parkingSpot ? (
            <div className="card">
              <h2 className="card-title">
                <CarIcon className="icon orange-icon" />
                Save Parking Spot
              </h2>
              
              <div>
                <div className="form-group">
                  <label className="label">
                    Address/Location Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="e.g., Mall Parking Lot, Level 2"
                    className="input"
                  />
                </div>
                
                <div className="form-group">
                  <label className="label">
                    Notes (Optional)
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g., Near the red car, Section A"
                    rows="3"
                    className="textarea"
                  />
                </div>
                
                <button
                  onClick={saveParkingSpot}
                  disabled={loading || !currentLocation}
                  className="btn btn-primary btn-full"
                >
                  {loading ? (
                    'Saving...'
                  ) : (
                    <>
                      <CheckCircleIcon className="icon" />
                      <span>Save Parking Spot</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="card">
              <h2 className="card-title">
                <CarIcon className="icon orange-icon" />
                Your Parking Spot
              </h2>
              
              <div>
                <div className="info-highlight">
                  <div className="time-display">
                    <div>
                      <p className="info-label">Saved on:</p>
                      <p className="info-value">{formatTime(savedTime)}</p>
                    </div>
                  </div>
                </div>
                
                {parkingSpot.address && (
                  <div className="info-section">
                    <p className="info-label">Location:</p>
                    <p className="info-value">{parkingSpot.address}</p>
                  </div>
                )}
                
                {parkingSpot.notes && (
                  <div className="info-section">
                    <p className="info-label">Notes:</p>
                    <p className="info-value">{parkingSpot.notes}</p>
                  </div>
                )}

                {/* Timer Section */}
                <div className="info-section timer-section">
                  <p className="info-label">Parking Timer:</p>
                  {timerActive ? (
                    <div className="timer-active">
                      <div className="timer-display">
                        <p className="timer-countdown">{formatRemainingTime(remainingTime)}</p>
                        <p className="timer-label">remaining</p>
                      </div>
                      <button
                        onClick={cancelTimer}
                        className="btn btn-small btn-danger"
                      >
                        <BellSlashIcon className="icon-sm" />
                        <span>Cancel Timer</span>
                      </button>
                    </div>
                  ) : timerExpired ? (
                    <div className="timer-expired">
                      <div className="timer-alert">
                        <p className="timer-alert-text">Timer Expired!</p>
                        <p className="timer-alert-subtext">Your parking time is up</p>
                      </div>
                      <div className="timer-inputs">
                        <div className="timer-input-group">
                          <input
                            type="number"
                            min="0"
                            max="24"
                            step="1"
                            value={timerHours}
                            onChange={(e) => setTimerHours(e.target.value)}
                            className="timer-input"
                          />
                          <span className="timer-unit">hours</span>
                        </div>
                        <div className="timer-input-group">
                          <input
                            type="number"
                            min="0"
                            max="59"
                            step="1"
                            value={timerMinutes}
                            onChange={(e) => setTimerMinutes(e.target.value)}
                            className="timer-input"
                          />
                          <span className="timer-unit">minutes</span>
                        </div>
                      </div>
                      <button
                        onClick={startTimer}
                        className="btn btn-small btn-success"
                      >
                        <BellAlertIcon className="icon-sm" />
                        <span>Set New Timer</span>
                      </button>
                      <button
                        onClick={() => setTimerExpired(false)}
                        className="btn btn-small btn-secondary"
                      >
                        <span>Dismiss</span>
                      </button>
                    </div>
                  ) : (
                    <div className="timer-setup">
                      <div className="timer-inputs">
                        <div className="timer-input-group">
                          <input
                            type="number"
                            min="0"
                            max="24"
                            step="1"
                            value={timerHours}
                            onChange={(e) => setTimerHours(e.target.value)}
                            className="timer-input"
                          />
                          <span className="timer-unit">hours</span>
                        </div>
                        <div className="timer-input-group">
                          <input
                            type="number"
                            min="0"
                            max="59"
                            step="1"
                            value={timerMinutes}
                            onChange={(e) => setTimerMinutes(e.target.value)}
                            className="timer-input"
                          />
                          <span className="timer-unit">minutes</span>
                        </div>
                      </div>
                      <button
                        onClick={startTimer}
                        className="btn btn-small btn-success"
                      >
                        <BellAlertIcon className="icon-sm" />
                        Set Timer
                      </button>
                    </div>
                  )}
                </div>
                
                <div className="btn-group">
                  <button onClick={getDirections} className="btn btn-primary">
                    <ArrowTopRightOnSquareIcon className="icon" />
                    <span>Get Directions</span>
                  </button>
                  <button onClick={clearParkingSpot} className="btn btn-danger">
                    <TrashIcon className="icon" />
                    <span>Clear Spot</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel - Map */}
        <div className="card">
          <h2 className="card-title">
            <MapIcon className="icon orange-icon" />
            Location Map
          </h2>
          
          <div className="map-container">
            {currentLocation ? (
              <MapContainer
                center={parkingSpot ? [parkingSpot.latitude, parkingSpot.longitude] : [currentLocation.lat, currentLocation.lng]}
                zoom={15}
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                />
                
                {parkingSpot && (
                  <Marker position={[parkingSpot.latitude, parkingSpot.longitude]}>
                    <Popup>
                      <div>
                        <h3>🚗 Your Car</h3>
                        {parkingSpot.address && <p>{parkingSpot.address}</p>}
                        {parkingSpot.notes && <p>{parkingSpot.notes}</p>}
                        <p><small>Saved: {formatTime(savedTime)}</small></p>
                      </div>
                    </Popup>
                  </Marker>
                )}
              </MapContainer>
            ) : (
              <div className="map-loading">
                <p>Loading map...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const loadTimerData = async () => {
    if (!user || !user.id) {
      console.log('Cannot load timer data: no user logged in');
      console.log('Current user state:', user);
      return;
    }
    
    try {
      const userId = user.id;
      console.log(`Loading timer data for user: ${userId}`);
      
      // Reset timer state before loading to prevent flickering
      resetTimerState();
      
      // Only load from server - no local storage fallback
      const response = await authAxios.get('/timer-data');
      const serverTimerData = response.data;
      console.log('Retrieved timer data from server:', serverTimerData);
      
      if (serverTimerData && serverTimerData.timer_active) {
        // Server has active timer data
        const timerData = {
          timer_end: serverTimerData.timer_end,
          timer_active: serverTimerData.timer_active === 1 || serverTimerData.timer_active === true,
          timer_hours: serverTimerData.timer_hours,
          timer_minutes: serverTimerData.timer_minutes
        };
        
        const endTime = new Date(timerData.timer_end);
        const now = new Date();
        
        console.log('Timer end time:', endTime.toISOString());
        console.log('Current time:', now.toISOString());
        console.log('Timer still active:', endTime > now);
        
        if (endTime > now) {
          // Timer is still valid
          const remainingMs = endTime - now;
          console.log(`Timer is still valid. Remaining: ${remainingMs}ms`);
          
          // Restore timer state
          setTimerEnd(endTime);
          setTimerActive(true);
          setRemainingTime(remainingMs);
          
          // Restore hours and minutes if available
          if (timerData.timer_hours) setTimerHours(timerData.timer_hours);
          if (timerData.timer_minutes) setTimerMinutes(timerData.timer_minutes);
          
          // Start the countdown
          if (timerInterval.current) {
            clearInterval(timerInterval.current);
          }
          
          // Store the user ID this timer belongs to
          timerUserIdRef.current = userId;
          
          timerInterval.current = setInterval(() => {
            // Check if the user ID has changed (user switched)
            if (!user || user.id !== timerUserIdRef.current) {
              console.log('User changed, stopping timer interval for user:', timerUserIdRef.current);
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
              
              // Show notification if browser supports it
              if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('Parking Timer', {
                  body: `Your parking time is up! Your car has been parked for ${timerData.timer_hours} hours and ${timerData.timer_minutes} minutes.${parkingSpot?.address ? `\nLocation: ${parkingSpot.address}` : ''}`,
                  icon: '/favicon.ico'
                });
              }
              
              // Clear timer data
              clearTimerData(true);
            } else {
              setRemainingTime(remaining);
            }
          }, 1000);
          
          console.log(`Timer data loaded and interval restarted for user: ${userId}`);
        } else {
          // Timer has expired while app was closed
          console.log('Timer has expired while app was closed');
          setTimerExpired(true);
          
          // Show notification if browser supports it
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Parking Timer Expired', {
              body: 'Your parking timer expired while you were away!',
              icon: '/favicon.ico'
            });
          }
          
          // Clear timer data
          clearTimerData(true);
        }
      } else {
        // No active timer on server
        console.log(`No active timer found on server for user: ${userId}`);
        
        // State is already reset by resetTimerState() call above
      }
    } catch (error) {
      console.log('No timer data found on server or server error:', error.message);
      
      // State is already reset by resetTimerState() call above
    }
  };

  return (
    <>
      {message && (
        <div className="message-global">
          {message}
        </div>
      )}
      
      {isAuthenticated ? (
        renderAppContent()
      ) : (
        showLogin ? renderLoginForm() : renderRegisterForm()
      )}
    </>
  );
}

export default App;
