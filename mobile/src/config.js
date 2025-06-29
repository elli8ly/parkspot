// Configuration for API URLs
const config = {
  // Local development
  development: {
    API_URL: 'http://localhost:5001/api'
  },
  // Production (update this with your deployed server URL)
  production: {
    API_URL: 'https://parkspot-server.onrender.com/api'
  }
};

// Use development mode to connect to local server
const environment = __DEV__ ? 'development' : 'production';

// Export the appropriate config
export const API_URL = config[environment].API_URL;

console.log('Mobile app using API URL:', API_URL);
console.log('Environment:', environment); 