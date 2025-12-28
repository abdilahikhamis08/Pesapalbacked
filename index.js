correct this require('dotenv').config();
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
   ROOT ROUTE (IMPORTANT)
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
    redirect: 'https://cybqa.pesapal.com/pesapalv3/api/Transactions/Redirect'
  },
  live: {
    auth: 'https://pay.pesapal.com/v3/api/Auth/RequestToken',
    order: 'https://pay.pesapal.com/v3/api/Transactions/SubmitOrderRequest',
    status: 'https://pay.pesapal.com/v3/api/Transactions/GetTransactionStatus',
    redirect: 'https://pay.pesapal.com/v3/api/Transactions/Redirect'
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
   2. SUBMIT ORDER (FIXED)
======================= */
app.post('/api/pesapal/order', async (req, res) => {
  try {
    const { accessToken, orderData } = req.body;

    if (!accessToken || !orderData) {
      return res.status(400).json({
        error: 'accessToken and orderData are required'
      });
    }

    console.log('💰 Submitting order...');
    const urls = getUrls();

    const response = await axios.post(urls.order, orderData, {
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

    // 🔑 MANUALLY BUILD REDIRECT URL (IMPORTANT FIX)
    const redirectUrl = `${urls.redirect}?OrderTrackingId=${orderTrackingId}`;

    res.json({
      order_tracking_id: orderTrackingId,
      redirect_url: redirectUrl
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
   3. CHECK STATUS
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
   HEALTH CHECK
======================= */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'pesapal-proxy',
    timestamp: new Date().toISOString()
  });
});

/* =======================
   TEST ENDPOINT
======================= */
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
});
