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
  'https://businessmanagement-802ef.firebaseapp.com',
  'https://cybqa.pesapal.com'
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
    ipn: 'https://cybqa.pesapal.com/pesapalv3/api/URLSetup/RegisterIPN'
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
   2. REGISTER IPN URL
======================= */
app.post('/api/pesapal/register-ipn', async (req, res) => {
  try {
    const { accessToken, ipnUrl } = req.body;
    
    if (!accessToken) {
      return res.status(400).json({ error: 'accessToken is required' });
    }

    console.log('🔗 Registering IPN URL...');
    const urls = getUrls();

    const ipnData = {
      url: ipnUrl || process.env.PESAPAL_IPN_URL || 'https://pesapalbacked.onrender.com/api/pesapal/ipn',
      ipn_notification_type: 'POST'
    };

    console.log('Registering IPN with:', ipnData);

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
   3. SUBMIT ORDER (FIXED - RETURNS REDIRECT URL)
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
    console.log('Order data:', JSON.stringify(orderData, null, 2));
    
    const urls = getUrls();

    // Validate required fields
    if (!orderData.amount || !orderData.currency || !orderData.description) {
      return res.status(400).json({
        error: 'Missing required fields: amount, currency, description'
      });
    }

    // Ensure IPN fields are included
    const enhancedOrderData = {
      ...orderData,
      callback_url: orderData.callback_url || `${process.env.REACT_APP_PROXY_URL}/payment-callback`,
      notification_id: orderData.notification_id || process.env.PESAPAL_IPN_ID,
      ipn_notification_type: 'POST'
    };

    console.log('Enhanced order data:', JSON.stringify(enhancedOrderData, null, 2));

    const response = await axios.post(urls.order, enhancedOrderData, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Pesapal response:', response.data);

    const orderTrackingId = response.data.order_tracking_id;

    if (!orderTrackingId) {
      return res.status(400).json({
        error: 'No order_tracking_id returned from Pesapal',
        raw: response.data
      });
    }

    // ✅ FIXED: Build and return the redirect URL
    const redirectUrl = `${urls.redirect}?OrderTrackingId=${orderTrackingId}`;

    res.json({
      success: true,
      order_tracking_id: orderTrackingId,
      redirect_url: redirectUrl, // ✅ This is what your frontend expects
      message: 'Order submitted successfully'
    });
  } catch (error) {
    console.error('❌ Order error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to submit order',
      details: error.response?.data,
      message: error.message
    });
  }
});

/* =======================
   4. SIMPLE PAYMENT INITIATION (EASIEST OPTION)
======================= */
app.post('/api/pesapal/pay', async (req, res) => {
  try {
    const { orderData } = req.body;

    if (!orderData) {
      return res.status(400).json({
        error: 'orderData is required'
      });
    }

    console.log('💳 Simple payment initiation...');
    const urls = getUrls();

    // 1. Get token
    const authResponse = await axios.post(urls.auth, {
      consumer_key: process.env.PESAPAL_CONSUMER_KEY,
      consumer_secret: process.env.PESAPAL_CONSUMER_SECRET
    });
    
    const token = authResponse.data.token;
    
    if (!token) {
      throw new Error('No token received from Pesapal');
    }

    // 2. Prepare order
    const paymentOrder = {
      id: orderData.id || `ORDER-${Date.now()}`,
      currency: orderData.currency || 'KES',
      amount: orderData.amount,
      description: orderData.description || 'Payment',
      callback_url: orderData.callback_url || `${process.env.REACT_APP_PROXY_URL}/payment-callback`,
      notification_id: orderData.notification_id || process.env.PESAPAL_IPN_ID || 'YOUR_IPN_ID',
      ipn_notification_type: 'POST',
      billing_address: {
        email_address: orderData.email || orderData.billing_address?.email_address || 'customer@example.com',
        phone_number: orderData.phone || orderData.billing_address?.phone_number || '0712345678',
        country_code: orderData.country_code || orderData.billing_address?.country_code || 'KE',
        first_name: orderData.first_name || orderData.billing_address?.first_name || 'Customer',
        last_name: orderData.last_name || orderData.billing_address?.last_name || 'Name',
        ...orderData.billing_address
      }
    };

    // 3. Submit to Pesapal
    const orderResponse = await axios.post(urls.order, paymentOrder, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const orderTrackingId = orderResponse.data.order_tracking_id;

    if (!orderTrackingId) {
      return res.status(400).json({
        error: 'No order_tracking_id returned',
        raw: orderResponse.data
      });
    }

    // 4. Build redirect URL
    const redirectUrl = `${urls.redirect}?OrderTrackingId=${orderTrackingId}`;

    res.json({
      success: true,
      order_tracking_id: orderTrackingId,
      redirect_url: redirectUrl,
      payment_url: redirectUrl, // Alternative key
      message: 'Payment ready'
    });

  } catch (error) {
    console.error('❌ Payment error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Payment failed',
      details: error.response?.data,
      message: error.message
    });
  }
});

/* =======================
   5. IPN CALLBACK ENDPOINT
======================= */
app.post('/api/pesapal/ipn', (req, res) => {
  try {
    console.log('📩 IPN Callback received:', req.body);
    
    const { 
      OrderTrackingId, 
      OrderNotificationType, 
      OrderMerchantReference 
    } = req.body;
    
    console.log(`💳 IPN Update: ${OrderMerchantReference} - ${OrderNotificationType}`);
    
    // Always return 200 OK to Pesapal
    res.status(200).json({ 
      message: 'IPN received',
      status: 'OK'
    });
  } catch (error) {
    console.error('❌ IPN processing error:', error);
    res.status(200).json({ 
      error: 'Failed to process IPN',
      status: 'ERROR'
    });
  }
});

/* =======================
   6. CHECK STATUS
======================= */
app.get('/api/pesapal/status', async (req, res) => {
  try {
    const { orderTrackingId } = req.query;

    if (!orderTrackingId) {
      return res.status(400).json({
        error: 'orderTrackingId is required'
      });
    }

    // Get token first
    const urls = getUrls();
    const authResponse = await axios.post(urls.auth, {
      consumer_key: process.env.PESAPAL_CONSUMER_KEY,
      consumer_secret: process.env.PESAPAL_CONSUMER_SECRET
    });
    
    const token = authResponse.data.token;

    const response = await axios.get(
      `${urls.status}?orderTrackingId=${orderTrackingId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    res.json({
      success: true,
      ...response.data
    });
  } catch (error) {
    console.error('❌ Status error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to check status',
      details: error.response?.data
    });
  }
});

/* =======================
   7. PAYMENT CALLBACK (For user redirect)
======================= */
app.get('/payment-callback', (req, res) => {
  const { OrderTrackingId, OrderMerchantReference } = req.query;
  
  console.log('🔙 Payment callback received:', {
    OrderTrackingId,
    OrderMerchantReference
  });

  // Redirect to frontend
  const frontendUrl = `https://businessmanagement-802ef.web.app/payment-result?trackingId=${OrderTrackingId}&reference=${OrderMerchantReference}`;
  
  res.redirect(frontendUrl);
});

/* =======================
   8. TEST ENDPOINT FOR FRONTEND
======================= */
app.get('/api/pesapal/test-payment', async (req, res) => {
  try {
    const urls = getUrls();
    
    // Get token
    const authResponse = await axios.post(urls.auth, {
      consumer_key: process.env.PESAPAL_CONSUMER_KEY,
      consumer_secret: process.env.PESAPAL_CONSUMER_SECRET
    });
    
    const token = authResponse.data.token;

    // Test order data
    const testOrder = {
      id: `TEST-${Date.now()}`,
      currency: 'KES',
      amount: 10, // Small amount for testing
      description: 'Test Payment',
      callback_url: `${process.env.REACT_APP_PROXY_URL}/payment-callback`,
      notification_id: process.env.PESAPAL_IPN_ID || 'test_ipn',
      ipn_notification_type: 'POST',
      billing_address: {
        email_address: 'test@example.com',
        phone_number: '0712345678',
        country_code: 'KE',
        first_name: 'Test',
        last_name: 'User'
      }
    };

    // Submit order
    const orderResponse = await axios.post(urls.order, testOrder, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const orderTrackingId = orderResponse.data.order_tracking_id;
    const redirectUrl = `${urls.redirect}?OrderTrackingId=${orderTrackingId}`;

    res.json({
      success: true,
      message: 'Test payment created',
      order_tracking_id: orderTrackingId,
      redirect_url: redirectUrl,
      test_data: testOrder
    });

  } catch (error) {
    console.error('❌ Test error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: 'Test failed',
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
    timestamp: new Date().toISOString(),
    environment: process.env.PESAPAL_ENV,
    ipn_id: process.env.PESAPAL_IPN_ID || 'Not configured',
    base_url: process.env.REACT_APP_PROXY_URL
  });
});

/* =======================
   START SERVER
======================= */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Environment: ${process.env.PESAPAL_ENV}`);
  console.log(`🔗 Test endpoint: http://localhost:${PORT}/api/pesapal/test-payment`);
});
