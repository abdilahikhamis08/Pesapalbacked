require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

/* =======================
   CORS CONFIG - SIMPLE
======================= */
app.use(cors({
  origin: ['http://localhost:3000', 'https://businessmanagement-802ef.web.app'],
  credentials: true
}));

app.use(express.json());

/* =======================
   ROOT ROUTE
======================= */
app.get('/', (req, res) => {
  res.send('🚀 PesaPal backend is running');
});

/* =======================
   PESAPAL CONFIG
======================= */
const PESAPAL_CONFIG = {
  // Use the EXACT URLs from your working Kodular setup
  authUrl: 'https://cybqa.pesapal.com/pesapalv3/api/Auth/RequestToken',
  orderUrl: 'https://cybqa.pesapal.com/pesapalv3/api/Transactions/SubmitOrderRequest',
  statusUrl: 'https://cybqa.pesapal.com/pesapalv3/api/Transactions/GetTransactionStatus',
  
  // Use the EXACT credentials from your blocks.png
  consumerKey: 'ngW+U:EnDhtUc5kPfrCD987xMh3Lx8',
  consumerSecret: 'q2/RChYSJUkypdcNYKzuUw460Dg='
};

console.log('🔧 PesaPal Configuration Loaded');

/* =======================
   1. AUTH TOKEN - SIMPLE AND WORKING
======================= */
app.post('/api/pesapal/auth', async (req, res) => {
  console.log('🔐 Getting PesaPal token...');
  
  try {
    // Make the EXACT same request as your Kodular blocks
    const response = await axios.post(
      PESAPAL_CONFIG.authUrl,
      {
        consumer_key: PESAPAL_CONFIG.consumerKey,
        consumer_secret: PESAPAL_CONFIG.consumerSecret
      },
      {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Auth response received');
    
    // Check if token exists
    if (!response.data || !response.data.token) {
      console.error('❌ No token in response:', response.data);
      return res.status(400).json({
        error: 'No token in response',
        details: response.data
      });
    }

    console.log('✅ Token obtained successfully');
    
    // Return the EXACT same structure as your Kodular blocks expected
    res.json({
      success: true,
      token: response.data.token,
      expires_in: response.data.expires_in,
      status: response.data.status,
      message: 'Authentication successful'
    });
    
  } catch (error) {
    console.error('❌ Auth error:', error.response?.data || error.message);
    
    // Return the error in the same format
    res.status(500).json({
      error: 'Authentication failed',
      details: error.response?.data || error.message,
      message: 'Failed to authenticate with PesaPal'
    });
  }
});

/* =======================
   2. SUBMIT ORDER
======================= */
app.post('/api/pesapal/order', async (req, res) => {
  try {
    const { accessToken, orderData } = req.body;

    console.log('💰 Submitting order with token:', accessToken ? 'Present' : 'Missing');

    if (!accessToken) {
      return res.status(400).json({
        error: 'Access token is required',
        message: 'Please authenticate first'
      });
    }

    if (!orderData) {
      return res.status(400).json({
        error: 'Order data is required'
      });
    }

    // Log order data for debugging
    console.log('📦 Order data:', {
      id: orderData.id,
      amount: orderData.amount,
      currency: orderData.currency,
      description: orderData.description
    });

    // Make the request to PesaPal
    const response = await axios.post(
      PESAPAL_CONFIG.orderUrl,
      orderData,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );

    console.log('✅ Order response:', response.data);

    // Return the response as-is (matching Kodular blocks)
    res.json(response.data);

  } catch (error) {
    console.error('❌ Order error:', error.response?.data || error.message);
    
    res.status(500).json({
      error: 'Failed to submit order',
      details: error.response?.data || error.message,
      message: 'Order submission failed'
    });
  }
});

/* =======================
   3. CHECK STATUS
======================= */
app.get('/api/pesapal/status', async (req, res) => {
  try {
    const { accessToken, orderTrackingId } = req.query;

    console.log('🔍 Checking status for:', orderTrackingId);

    if (!accessToken || !orderTrackingId) {
      return res.status(400).json({
        error: 'accessToken and orderTrackingId are required'
      });
    }

    const response = await axios.get(
      `${PESAPAL_CONFIG.statusUrl}?orderTrackingId=${orderTrackingId}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      }
    );

    console.log('📊 Status result:', response.data.payment_status_description);

    res.json(response.data);

  } catch (error) {
    console.error('❌ Status error:', error.response?.data || error.message);
    
    res.status(500).json({
      error: 'Failed to check status',
      details: error.response?.data || error.message
    });
  }
});

/* =======================
   4. HEALTH CHECK
======================= */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'pesapal-proxy',
    timestamp: new Date().toISOString()
  });
});

/* =======================
   5. TEST ENDPOINT
======================= */
app.post('/api/test', (req, res) => {
  console.log('🧪 Test endpoint called');
  res.json({
    message: 'Backend is working!',
    received: req.body,
    timestamp: new Date().toISOString()
  });
});

/* =======================
   START SERVER
======================= */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`
==================================
🚀 PesaPal Proxy Server
==================================
📍 Port: ${PORT}
🔗 Auth URL: ${PESAPAL_CONFIG.authUrl}
💰 Order URL: ${PESAPAL_CONFIG.orderUrl}
📊 Status URL: ${PESAPAL_CONFIG.statusUrl}
⏰ Started: ${new Date().toLocaleString()}

📋 Endpoints:
✅ POST /api/pesapal/auth
✅ POST /api/pesapal/order  
✅ GET  /api/pesapal/status
✅ GET  /api/health
✅ POST /api/test
==================================
  `);
});
