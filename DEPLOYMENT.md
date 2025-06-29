# Deployment Guide - Make Your Parking App Accessible Anywhere

## Overview
This guide will help you deploy your parking app so it works outside your local WiFi network.

## Option 1: Railway (Recommended - Free Tier)

### Step 1: Deploy Backend
1. **Sign up for Railway**: Go to [railway.app](https://railway.app) and create an account
2. **Connect GitHub**: Link your GitHub repository
3. **Create new project**: Click "New Project" → "Deploy from GitHub repo"
4. **Select repository**: Choose your parking app repository
5. **Configure deployment**:
   - Root Directory: `server`
   - Build Command: `npm install`
   - Start Command: `npm start`
6. **Set environment variables**:
   - `JWT_SECRET`: Generate a random secret key
   - `NODE_ENV`: `production`
7. **Deploy**: Railway will automatically deploy your server

### Step 2: Get Your Server URL
- After deployment, Railway will give you a URL like: `https://your-app-name.railway.app`
- Copy this URL - you'll need it for the frontend

### Step 3: Deploy Web Frontend
1. **Create new project** in Railway for the web app
2. **Configure**:
   - Root Directory: `client`
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
3. **Set environment variables**:
   - `REACT_APP_API_URL`: Your backend URL (e.g., `https://your-app-name.railway.app/api`)
   - `NODE_ENV`: `production`

### Step 4: Update Configuration Files
Update these files with your actual Railway URLs:

**client/src/config.js**:
```javascript
production: {
  API_URL: 'https://your-railway-app.railway.app/api' // Your actual URL
}
```

**mobile/src/config.js**:
```javascript
production: {
  API_URL: 'https://your-railway-app.railway.app/api' // Your actual URL
}
```

## Option 2: Render (Alternative - Free Tier)

### Step 1: Deploy Backend
1. **Sign up for Render**: Go to [render.com](https://render.com)
2. **Create new Web Service**:
   - Connect your GitHub repo
   - Name: `parkspot-api`
   - Environment: `Node`
   - Build Command: `cd server && npm install`
   - Start Command: `cd server && npm start`
3. **Set environment variables**:
   - `JWT_SECRET`: Random secret key
   - `NODE_ENV`: `production`

### Step 2: Deploy Web Frontend
1. **Create new Static Site**:
   - Build Command: `cd client && npm install && npm run build`
   - Publish Directory: `client/build`
2. **Set environment variables**:
   - `REACT_APP_API_URL`: Your backend URL

## Option 3: Heroku (Paid - More Features)

### Step 1: Deploy Backend
1. **Install Heroku CLI**: Download from [heroku.com](https://heroku.com)
2. **Login**: `heroku login`
3. **Create app**: `heroku create your-parkspot-api`
4. **Deploy**: 
   ```bash
   cd server
   git init
   git add .
   git commit -m "Initial commit"
   heroku git:remote -a your-parkspot-api
   git push heroku main
   ```
5. **Set environment variables**:
   ```bash
   heroku config:set JWT_SECRET=your-secret-key
   heroku config:set NODE_ENV=production
   ```

### Step 2: Deploy Web Frontend
1. **Create another app**: `heroku create your-parkspot-web`
2. **Deploy**:
   ```bash
   cd client
   git init
   git add .
   git commit -m "Initial commit"
   heroku git:remote -a your-parkspot-web
   git push heroku main
   ```

## Mobile App Deployment

### For Production Build
1. **Update API URL** in `mobile/src/config.js` with your deployed server URL
2. **Build for production**:
   ```bash
   cd mobile
   eas build --platform all
   ```
3. **Submit to app stores** (optional):
   ```bash
   eas submit --platform ios
   eas submit --platform android
   ```

## Database Considerations

### For Production
- **Railway/Render**: Use their PostgreSQL add-ons
- **Heroku**: Use Heroku Postgres
- **Update server code** to use PostgreSQL instead of SQLite

### Quick Database Migration
If you want to keep using SQLite for now:
- The database file will be created automatically on first run
- Data will persist as long as the server stays running

## Testing Your Deployment

1. **Test backend**: Visit `https://your-app-url.railway.app/api/health`
2. **Test web app**: Visit your deployed web app URL
3. **Test mobile app**: Update the config and test on device

## Security Considerations

1. **JWT Secret**: Use a strong, random secret key
2. **CORS**: Update CORS settings for your domain
3. **HTTPS**: All cloud platforms provide HTTPS automatically
4. **Environment Variables**: Never commit secrets to your code

## Cost Estimates

- **Railway**: Free tier includes 500 hours/month
- **Render**: Free tier available
- **Heroku**: $7/month for basic dyno
- **Domain**: $10-15/year (optional)

## Troubleshooting

### Common Issues:
1. **CORS errors**: Update CORS settings in server
2. **Database errors**: Check database connection
3. **Build failures**: Check build commands and dependencies
4. **API URL issues**: Verify URLs in config files

### Debug Commands:
```bash
# Check server logs
railway logs
# or
heroku logs --tail

# Check environment variables
railway variables
# or
heroku config
```

## Next Steps

1. **Choose a platform** (Railway recommended for beginners)
2. **Deploy backend first**
3. **Update frontend configs**
4. **Deploy frontend**
5. **Test everything**
6. **Share your app URL with users!**

Your app will then be accessible from anywhere in the world! 🌍 