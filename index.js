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
  'https://cybqa.pesapal.com' // Allow Pesapal sandbox
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
   3. SUBMIT ORDER (FIXED)
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

    // Return tracking ID only - frontend will build redirect URL
    res.json({
      success: true,
      order_tracking_id: orderTrackingId,
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
   4. GET PAYMENT URL (NEW)
======================= */
app.get('/api/pesapal/payment-url', (req, res) => {
  try {
    const { orderTrackingId } = req.query;

    if (!orderTrackingId) {
      return res.status(400).json({
        error: 'orderTrackingId is required'
      });
    }

    const urls = getUrls();
    
    // Build the Pesapal payment URL
    const paymentUrl = `${urls.redirect}?OrderTrackingId=${orderTrackingId}`;

    res.json({
      success: true,
      payment_url: paymentUrl,
      message: 'Payment URL generated'
    });
  } catch (error) {
    console.error('❌ Payment URL error:', error.message);
    res.status(500).json({
      error: 'Failed to generate payment URL',
      details: error.message
    });
  }
});

/* =======================
   5. COMPLETE PAYMENT FLOW (ALL-IN-ONE)
======================= */
app.post('/api/pesapal/initiate-payment', async (req, res) => {
  try {
    const { orderData } = req.body;

    if (!orderData) {
      return res.status(400).json({
        error: 'orderData is required'
      });
    }

    console.log('🔄 Initiating payment flow...');
    const urls = getUrls();

    // 1. Get authentication token
    const authResponse = await axios.post(urls.auth, {
      consumer_key: process.env.PESAPAL_CONSUMER_KEY,
      consumer_secret: process.env.PESAPAL_CONSUMER_SECRET
    });
    
    const token = authResponse.data.token;
    console.log('Token received:', token ? 'Yes' : 'No');

    if (!token) {
      throw new Error('No token received from Pesapal');
    }

    // 2. Prepare order data with IPN
    const enhancedOrderData = {
      id: orderData.id || `ORDER-${Date.now()}`,
      currency: orderData.currency || 'KES',
      amount: orderData.amount,
      description: orderData.description,
      callback_url: orderData.callback_url || `${process.env.REACT_APP_PROXY_URL}/payment-callback`,
      notification_id: orderData.notification_id || process.env.PESAPAL_IPN_ID,
      ipn_notification_type: 'POST',
      billing_address: orderData.billing_address || {
        email_address: orderData.email || 'customer@example.com',
        phone_number: orderData.phone || '0712345678',
        country_code: orderData.country_code || 'KE',
        first_name: orderData.first_name || 'Customer',
        last_name: orderData.last_name || 'Name',
        middle_name: '',
        line_1: '',
        line_2: '',
        city: '',
        state: '',
        postal_code: '',
        zip_code: ''
      }
    };

    console.log('Submitting order with data:', JSON.stringify(enhancedOrderData, null, 2));

    // 3. Submit order
    const orderResponse = await axios.post(urls.order, enhancedOrderData, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Order response:', orderResponse.data);

    const orderTrackingId = orderResponse.data.order_tracking_id;

    if (!orderTrackingId) {
      return res.status(400).json({
        error: 'No order_tracking_id returned from Pesapal',
        raw: orderResponse.data
      });
    }

    // 4. Build payment URL
    const paymentUrl = `${urls.redirect}?OrderTrackingId=${orderTrackingId}`;

    res.json({
      success: true,
      order_tracking_id: orderTrackingId,
      payment_url: paymentUrl,
      message: 'Payment initiated successfully'
    });

  } catch (error) {
    console.error('❌ Payment initiation error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Payment initiation failed',
      details: error.response?.data,
      message: error.message
    });
  }
});

/* =======================
   6. IPN CALLBACK ENDPOINT
======================= */
app.post('/api/pesapal/ipn', (req, res) => {
  try {
    console.log('📩 IPN Callback received:', req.body);
    
    const { 
      OrderTrackingId, 
      OrderNotificationType, 
      OrderMerchantReference,
      OrderPaymentStatus 
    } = req.body;
    
    console.log(`💳 Payment Update: 
      Order: ${OrderMerchantReference}
      Tracking ID: ${OrderTrackingId}
      Status: ${OrderNotificationType}
      Payment Status: ${OrderPaymentStatus}`);
    
    // TODO: Update your database here
    
    // Always return 200 OK to Pesapal
    res.status(200).json({ 
      message: 'IPN received successfully',
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
   7. CHECK STATUS
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
   8. PAYMENT CALLBACK (For user redirect)
======================= */
app.get('/payment-callback', (req, res) => {
  const { OrderTrackingId, OrderMerchantReference } = req.query;
  
  console.log('🔙 Payment callback received:', {
    OrderTrackingId,
    OrderMerchantReference
  });

  // Redirect to your frontend with payment details
  const frontendUrl = `https://businessmanagement-802ef.web.app/payment-result?trackingId=${OrderTrackingId}&reference=${OrderMerchantReference}`;
  
  res.redirect(frontendUrl);
});

/* =======================
   9. TEST PESAPAL CONNECTION
======================= */
app.get('/api/pesapal/test-connection', async (req, res) => {
  try {
    const urls = getUrls();
    
    // Test authentication
    const authResponse = await axios.post(urls.auth, {
      consumer_key: process.env.PESAPAL_CONSUMER_KEY,
      consumer_secret: process.env.PESAPAL_CONSUMER_SECRET
    });

    res.json({
      success: true,
      message: 'Pesapal connection successful',
      environment: process.env.PESAPAL_ENV,
      token_received: !!authResponse.data.token,
      urls: urls
    });
  } catch (error) {
    console.error('❌ Connection test failed:', error.message);
    res.status(500).json({
      success: false,
      error: 'Pesapal connection failed',
      details: error.response?.data || error.message
    });
  }
});

/* =======================
   HEALTH CHECK & TEST
======================= */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'pesapal-proxy',
    timestamp: new Date().toISOString(),
    environment: process.env.PESAPAL_ENV,
    ipn_id: process.env.PESAPAL_IPN_ID || 'Not configured'
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
  console.log(`🌐 Environment: ${process.env.PESAPAL_ENV || 'sandbox'}`);
  console.log(`🔗 IPN URL: ${process.env.PESAPAL_IPN_URL || 'Not configured'}`);
  console.log(`🔑 IPN ID: ${process.env.PESAPAL_IPN_ID || 'Not configured'}`);
  console.log(`📞 Callback: ${process.env.REACT_APP_PROXY_URL || 'https://pesapalbacked.onrender.com'}/payment-callback`);
});
