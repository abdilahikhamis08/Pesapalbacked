require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// Middleware
const allowedOrigins = [
  'http://localhost:3000',
  'https://businessmanagement-802ef.web.app',
  'https://businessmanagement-802ef.firebaseapp.com'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());

// PesaPal URLs
const PESAPAL_URLS = {
  sandbox: {
    auth: 'https://cybqa.pesapal.com/pesapalv3/api/Auth/RequestToken',
    order: 'https://cybqa.pesapal.com/pesapalv3/api/Transactions/SubmitOrderRequest',
    status: 'https://cybqa.pesapal.com/pesapalv3/api/Transactions/GetTransactionStatus'
  },
  live: {
    auth: 'https://pay.pesapal.com/v3/api/Auth/RequestToken',
    order: 'https://pay.pesapal.com/v3/api/Transactions/SubmitOrderRequest',
    status: 'https://pay.pesapal.com/v3/api/Transactions/GetTransactionStatus'
  }
};

// Get URLs based on environment
const getUrls = () => {
  return process.env.PESAPAL_ENV === 'live' 
    ? PESAPAL_URLS.live 
    : PESAPAL_URLS.sandbox;
};

// 1. Get Access Token
app.post('/api/pesapal/auth', async (req, res) => {
  try {
    console.log('🔐 Getting PesaPal token...');
    
    const urls = getUrls();
    const response = await axios.post(urls.auth, {
      consumer_key: process.env.PESAPAL_CONSUMER_KEY,
      consumer_secret: process.env.PESAPAL_CONSUMER_SECRET,
    });

    res.json(response.data);
  } catch (error) {
    console.error('❌ Auth error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: error.message,
      details: error.response?.data 
    });
  }
});

// 2. Submit Order
app.post('/api/pesapal/order', async (req, res) => {
  try {
    console.log('💰 Submitting order...');
    
    const { accessToken, orderData } = req.body;
    const urls = getUrls();

    const response = await axios.post(urls.order, orderData, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('✅ Order submitted');
    res.json(response.data);
  } catch (error) {
    console.error('❌ Order error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: error.message,
      details: error.response?.data 
    });
  }
});

// 3. Check Status
app.get('/api/pesapal/status', async (req, res) => {
  try {
    const { accessToken, orderTrackingId } = req.query;
    const urls = getUrls();

    const response = await axios.get(
      `${urls.status}?orderTrackingId=${orderTrackingId}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('❌ Status error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: error.message,
      details: error.response?.data 
    });
  }
});

// 4. Health Check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    service: 'pesapal-proxy',
    timestamp: new Date().toISOString()
  });
});

// 5. Simple Test Endpoint
app.post('/api/test', (req, res) => {
  console.log('Test request received:', req.body);
  res.json({ 
    message: 'Backend is working!',
    data: req.body,
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Proxy server running on http://localhost:${PORT}`);
  console.log(`📡 Endpoints:`);
  console.log(`   POST http://localhost:${PORT}/api/pesapal/auth`);
  console.log(`   POST http://localhost:${PORT}/api/pesapal/order`);
  console.log(`   GET  http://localhost:${PORT}/api/pesapal/status`);
  console.log(`   GET  http://localhost:${PORT}/api/health`);
  console.log(`   POST http://localhost:${PORT}/api/test`);
});
