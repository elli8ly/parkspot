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

// Get current environment
const environment = process.env.NODE_ENV || 'development';

// Export the appropriate config
export const API_URL = config[environment].API_URL;

console.log('Using API URL:', API_URL);
console.log('Environment:', environment); 