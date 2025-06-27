import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { 
  MapPinIcon, 
  CheckCircleIcon, 
  TrashIcon,
  InformationCircleIcon,
  ArrowTopRightOnSquareIcon,
  ClockIcon
} from '@heroicons/react/24/outline';
import 'leaflet/dist/leaflet.css';
import './App.css';

// Fix for default markers in react-leaflet
import L from 'leaflet';
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

// Update API_URL to match the client's port
const API_URL = 'http://localhost:5000/api';

function App() {
  const [parkingSpot, setParkingSpot] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState('');
  const [savedTime, setSavedTime] = useState(null);

  // Load existing parking spot on component mount
  useEffect(() => {
    loadParkingSpot();
    getCurrentLocation();
  }, []);

  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCurrentLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
          console.error('Error getting location:', error);
          setMessage('Unable to get current location. Please enable location services.');
        }
      );
    } else {
      setMessage('Geolocation is not supported by this browser.');
    }
  };

  const loadParkingSpot = async () => {
    try {
      const response = await axios.get(`${API_URL}/parking-spot`);
      if (response.data) {
        setParkingSpot(response.data);
        setSavedTime(new Date(response.data.timestamp));
      }
    } catch (error) {
      console.error('Error loading parking spot:', error);
    }
  };

  const saveParkingSpot = async () => {
    if (!currentLocation) {
      setMessage('Unable to get current location. Please try again.');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(`${API_URL}/parking-spot`, {
        latitude: currentLocation.lat,
        longitude: currentLocation.lng,
        address,
        notes
      });
      
      setParkingSpot(response.data);
      // Set the saved time to current time
      const now = new Date();
      setSavedTime(now);
      
      setMessage('🎉 Parking spot saved successfully!');
      setNotes('');
      setAddress('');
      
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error('Error saving parking spot:', error);
      setMessage('Error saving parking spot. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const clearParkingSpot = async () => {
    setLoading(true);
    try {
      await axios.delete(`${API_URL}/parking-spot`);
      setParkingSpot(null);
      setSavedTime(null);
      setMessage('Parking spot cleared!');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error('Error clearing parking spot:', error);
      setMessage('Error clearing parking spot. Please try again.');
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

  return (
    <div className="container">
      <div className="header">
        <h1 className="title">
          <MapPinIcon className="icon-lg" />
          ParkSpot
        </h1>
        <p className="subtitle">Never forget where you parked again!</p>
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
                <MapPinIcon className="icon" />
                Save Current Location
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
                      Save Parking Spot
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="card">
              <h2 className="card-title">
                <InformationCircleIcon className="icon" />
                Your Parking Spot
              </h2>
              
              <div>
                <div className="info-highlight">
                  <div className="time-display">
                    <ClockIcon className="icon" />
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
                
                <div className="btn-group">
                  <button
                    onClick={getDirections}
                    className="btn btn-success"
                  >
                    <ArrowTopRightOnSquareIcon className="icon" />
                    Get Directions
                  </button>
                  
                  <button
                    onClick={clearParkingSpot}
                    disabled={loading}
                    className="btn btn-danger"
                  >
                    <TrashIcon className="icon" />
                    Clear Spot
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel - Map */}
        <div className="card">
          <h2 className="card-title">Map View</h2>
          
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
}

export default App;
