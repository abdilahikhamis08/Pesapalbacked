console.log('ENV CHECK:', {
  KEY: process.env.PESAPAL_CONSUMER_KEY,
  SECRET: process.env.PESAPAL_CONSUMER_SECRET,
  ENV: process.env.PESAPAL_ENV,
  URL: process.env.REACT_APP_PROXY_URL
});

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

/* =======================
   CORS
======================= */
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

/* =======================
   ROOT
======================= */
app.get('/', (req, res) => {
  res.send('🚀 Pesapal backend running (Kodular-compatible)');
});

/* =======================
   PESAPAL URLS
======================= */
const PESAPAL_URLS = {
  sandbox: {
    auth: 'https://cybqa.pesapal.com/pesapalv3/api/Auth/RequestToken',
    ipn: 'https://cybqa.pesapal.com/pesapalv3/api/URLSetup/RegisterIPN',
    order: 'https://cybqa.pesapal.com/pesapalv3/api/Transactions/SubmitOrderRequest',
    redirect: 'https://cybqa.pesapal.com/pesapalv3/api/Transactions/Redirect'
  },
  live: {
    auth: 'https://pay.pesapal.com/v3/api/Auth/RequestToken',
    ipn: 'https://pay.pesapal.com/v3/api/URLSetup/RegisterIPN',
    order: 'https://pay.pesapal.com/v3/api/Transactions/SubmitOrderRequest',
    redirect: 'https://pay.pesapal.com/v3/api/Transactions/Redirect'
  }
};

const urls =
  process.env.PESAPAL_ENV === 'live'
    ? PESAPAL_URLS.live
    : PESAPAL_URLS.sandbox;

/* =======================
   1. AUTH
======================= */
async function getAccessToken() {
  const res = await axios.post(urls.auth, {
    consumer_key: process.env.PESAPAL_CONSUMER_KEY,
    consumer_secret: process.env.PESAPAL_CONSUMER_SECRET
  });
  return res.data.token;
}

/* =======================
   2. REGISTER IPN (LIKE KODULAR)
======================= */
async function registerIPN(token) {
  const res = await axios.post(
    urls.ipn,
    {
      url: `${process.env.REACT_APP_PROXY_URL}/api/pesapal/ipn`,
      ipn_notification_type: 'POST'
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return res.data.ipn_id;
}

/* =======================
   3. SUBMIT ORDER (FIXED)
======================= */
app.post('/api/pesapal/pay', async (req, res) => {
  try {
    const { orderData } = req.body;

    if (!orderData) {
      return res.status(400).json({ error: 'orderData required' });
    }

    console.log('🔐 Authenticating...');
    const token = await getAccessToken();

    console.log('📡 Registering IPN...');
    const ipnId = await registerIPN(token);

    console.log('💰 Submitting order...');
    const orderPayload = {
      ...orderData,
      notification_id: ipnId
    };

    const response = await axios.post(
      urls.order,
      orderPayload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const trackingId = response.data.order_tracking_id;

    if (!trackingId) {
      return res.status(400).json({
        error: 'No order_tracking_id returned',
        raw: response.data
      });
    }

    res.json({
      order_tracking_id: trackingId,
      redirect_url: `${urls.redirect}?OrderTrackingId=${trackingId}`
    });
  } catch (err) {
    console.error('❌ Payment error:', err.response?.data || err.message);
    res.status(500).json({
      error: 'Pesapal payment failed',
      details: err.response?.data
    });
  }
});

/* =======================
   4. IPN RECEIVER
======================= */
app.post('/api/pesapal/ipn', (req, res) => {
  console.log('📥 IPN RECEIVED:', req.body);
  res.json({ status: 'OK' });
});

/* =======================
   START
======================= */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
