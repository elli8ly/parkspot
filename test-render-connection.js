// Test script to verify Render server connection
// Run this with: node test-render-connection.js

const https = require('https');

// Replace this with your actual Render URL
const RENDER_URL = 'https://parkspot-server.onrender.com';

console.log('Testing connection to Render server...');
console.log('URL:', RENDER_URL);

// Test health endpoint
const testHealth = () => {
  return new Promise((resolve, reject) => {
    const req = https.get(`${RENDER_URL}/api/health`, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log('✅ Health check successful!');
        console.log('Status:', res.statusCode);
        console.log('Response:', data);
        resolve(data);
      });
    });
    
    req.on('error', (err) => {
      console.log('❌ Connection failed:', err.message);
      reject(err);
    });
    
    req.setTimeout(10000, () => {
      console.log('❌ Request timeout');
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
};

// Run the test
testHealth()
  .then(() => {
    console.log('\n🎉 Your Render server is working!');
    console.log('You can now update your config files with this URL.');
  })
  .catch((err) => {
    console.log('\n❌ Connection failed. Please check:');
    console.log('1. Your Render URL is correct');
    console.log('2. Your Render service is running');
    console.log('3. The health endpoint exists at /api/health');
  }); 