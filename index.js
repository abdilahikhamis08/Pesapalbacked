require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

/* =======================
   CORS CONFIG
======================= */
const allowedOrigins = [
  'http://localhost:3000',
  'https://businessmanagement-802ef.web.app',
  'https://businessmanagement-802ef.firebaseapp.com'
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true
  })
);

app.use(express.json());

/* =======================
   ROOT ROUTE
======================= */
app.get('/', (req, res) => {
  res.send('🚀 Pesapal backend is running');
});

/* =======================
   PESAPAL URLS
======================= */
const PESAPAL_URLS = {
  sandbox: {
    auth: 'https://cybqa.pesapal.com/pesapalv3/api/Auth/RequestToken',
    order: 'https://cybqa.pesapal.com/pesapalv3/api/Transactions/SubmitOrderRequest',
    status: 'https://cybqa.pesapal.com/pesapalv3/api/Transactions/GetTransactionStatus',
    redirect: 'https://cybqa.pesapal.com/pesapalv3/api/Transactions/Redirect',
    ipn: 'https://cybqa.pesapal.com/pesapalv3/api/URLSetup/RegisterIPN' // For IPN registration
  },
  live: {
    auth: 'https://pay.pesapal.com/v3/api/Auth/RequestToken',
    order: 'https://pay.pesapal.com/v3/api/Transactions/SubmitOrderRequest',
    status: 'https://pay.pesapal.com/v3/api/Transactions/GetTransactionStatus',
    redirect: 'https://pay.pesapal.com/v3/api/Transactions/Redirect',
    ipn: 'https://pay.pesapal.com/v3/api/URLSetup/RegisterIPN'
  }
};

const getUrls = () =>
  process.env.PESAPAL_ENV === 'live'
    ? PESAPAL_URLS.live
    : PESAPAL_URLS.sandbox;

/* =======================
   1. AUTH TOKEN
======================= */
app.post('/api/pesapal/auth', async (req, res) => {
  try {
    console.log('🔐 Getting Pesapal token...');
    const urls = getUrls();

    const response = await axios.post(urls.auth, {
      consumer_key: process.env.PESAPAL_CONSUMER_KEY,
      consumer_secret: process.env.PESAPAL_CONSUMER_SECRET
    });

    res.json(response.data);
  } catch (error) {
    console.error('❌ Auth error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to authenticate with Pesapal',
      details: error.response?.data
    });
  }
});

/* =======================
   2. REGISTER IPN URL (NEW - DO THIS FIRST)
======================= */
app.post('/api/pesapal/register-ipn', async (req, res) => {
  try {
    const { accessToken } = req.body;
    
    if (!accessToken) {
      return res.status(400).json({ error: 'accessToken is required' });
    }

    console.log('🔗 Registering IPN URL...');
    const urls = getUrls();

    const ipnData = {
      url: process.env.PESAPAL_IPN_URL || 'https://pesapalbacked.onrender.com/api/pesapal/ipn',
      ipn_notification_type: 'POST' // Can be 'GET' or 'POST'
    };

    const response = await axios.post(urls.ipn, ipnData, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ IPN Registered:', response.data);
    res.json(response.data);
  } catch (error) {
    console.error('❌ IPN Registration error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to register IPN',
      details: error.response?.data
    });
  }
});

/* =======================
   3. SUBMIT ORDER (UPDATED WITH IPN)
======================= */
app.post('/api/pesapal/order', async (req, res) => {
  try {
    const { accessToken, orderData } = req.body;

    if (!accessToken || !orderData) {
      return res.status(400).json({
        error: 'accessToken and orderData are required'
      });
    }

    console.log('💰 Submitting order with IPN...');
    const urls = getUrls();

    // Add IPN configuration to order data
    const orderWithIPN = {
      ...orderData,
      // 🔴 CRITICAL: Add these IPN fields
      callback_url: process.env.REACT_APP_PROXY_URL || 'https://pesapalbacked.onrender.com',
      notification_id: process.env.PESAPAL_IPN_ID, // This must be registered first
      ipn_notification_type: 'POST'
    };

    const response = await axios.post(urls.order, orderWithIPN, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    const orderTrackingId = response.data.order_tracking_id;

    if (!orderTrackingId) {
      return res.status(400).json({
        error: 'No order_tracking_id returned from Pesapal',
        raw: response.data
      });
    }

    // Build redirect URL
    const redirectUrl = `${urls.redirect}?OrderTrackingId=${orderTrackingId}`;

    res.json({
      order_tracking_id: orderTrackingId,
      redirect_url: redirectUrl,
      message: 'Order submitted successfully'
    });
  } catch (error) {
    console.error('❌ Order error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to submit order',
      details: error.response?.data
    });
  }
});

/* =======================
   4. IPN CALLBACK ENDPOINT (NEW)
======================= */
app.post('/api/pesapal/ipn', async (req, res) => {
  try {
    console.log('📩 IPN Callback received:', req.body);
    
    // Pesapal will send payment notifications here
    const { OrderTrackingId, OrderNotificationType, OrderMerchantReference } = req.body;
    
    // Here you should update your database with payment status
    console.log(`Payment update for Order ${OrderMerchantReference}: ${OrderNotificationType}`);
    
    // Always return 200 OK to Pesapal
    res.status(200).json({ message: 'IPN received successfully' });
  } catch (error) {
    console.error('❌ IPN processing error:', error);
    res.status(200).json({ error: 'Failed to process IPN' });
  }
});

/* =======================
   5. CHECK STATUS
======================= */
app.get('/api/pesapal/status', async (req, res) => {
  try {
    const { accessToken, orderTrackingId } = req.query;

    if (!accessToken || !orderTrackingId) {
      return res.status(400).json({
        error: 'accessToken and orderTrackingId are required'
      });
    }

    const urls = getUrls();

    const response = await axios.get(
      `${urls.status}?orderTrackingId=${orderTrackingId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('❌ Status error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to check status',
      details: error.response?.data
    });
  }
});

/* =======================
   REMAINING ENDPOINTS (unchanged)
======================= */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'pesapal-proxy',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/test', (req, res) => {
  res.json({
    message: 'Backend is working!',
    data: req.body,
    timestamp: new Date().toISOString()
  });
});

/* =======================
   START SERVER
======================= */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Pesapal proxy running on port ${PORT}`);
  console.log(`🌐 IPN URL: ${process.env.PESAPAL_IPN_URL || 'Not configured'}`);
});
