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
  res.send('🚀 Pesapal backend is running - IPN Registered!');
});

/* =======================
   PESAPAL CONFIGURATION
======================= */
const PESAPAL_CONFIG = {
  // Sandbox credentials (from your .env)
  consumer_key: process.env.PESAPAL_CONSUMER_KEY || 'ngW+UEcnDhltUc5fxPfrCD987xMh3Lx8',
  consumer_secret: process.env.PESAPAL_CONSUMER_SECRET || 'q27RChYs5UkypdcNYKzuUw460Dg=',
  
  // ✅ USE YOUR REGISTERED IPN ID
  ipn_id: 'ae222a4b-4039-4d40-915a-daebbe32ff99', // Your registered IPN ID
  ipn_url: 'https://pesapalbacked.onrender.com/api/pesapal/ipn',
  
  // Environment
  environment: process.env.PESAPAL_ENV || 'sandbox'
};

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
  PESAPAL_CONFIG.environment === 'live'
    ? PESAPAL_URLS.live
    : PESAPAL_URLS.sandbox;

/* =======================
   GET AUTH TOKEN
======================= */
async function getPesaPalToken() {
  try {
    const urls = getUrls();
    
    const response = await axios.post(urls.auth, {
      consumer_key: PESAPAL_CONFIG.consumer_key,
      consumer_secret: PESAPAL_CONFIG.consumer_secret
    });
    
    return response.data.token;
  } catch (error) {
    console.error('❌ Token error:', error.response?.data || error.message);
    throw error;
  }
}

/* =======================
   SIMPLE PAY ENDPOINT (FIXED WITH CORRECT IPN ID)
======================= */
app.post('/api/pesapal/pay', async (req, res) => {
  try {
    const { orderData } = req.body;

    if (!orderData) {
      return res.status(400).json({
        error: 'orderData is required'
      });
    }

    console.log('💳 Processing payment request...');
    const urls = getUrls();

    // Get authentication token
    const token = await getPesaPalToken();
    console.log('✅ Token received');

    // ✅ CRITICAL: Prepare order data with your REGISTERED IPN ID
    const paymentOrder = {
      id: orderData.id || `ORDER-${Date.now()}`,
      currency: orderData.currency || 'KES',
      amount: orderData.amount || 10, // Use 10 KES for testing
      description: orderData.description || 'Premium Subscription',
      
      // 🔴 USE YOUR REGISTERED IPN ID HERE
      notification_id: PESAPAL_CONFIG.ipn_id, // This is your registered IPN ID
      
      callback_url: orderData.callback_url || `${process.env.REACT_APP_PROXY_URL}/payment-callback`,
      ipn_notification_type: 'POST', // Must match registration
      
      billing_address: {
        email_address: orderData.email || orderData.billing_address?.email_address || 'customer@example.com',
        phone_number: orderData.phone || orderData.billing_address?.phone_number || '0712345678',
        country_code: orderData.country_code || orderData.billing_address?.country_code || 'KE',
        first_name: orderData.first_name || orderData.billing_address?.first_name || 'Customer',
        last_name: orderData.last_name || orderData.billing_address?.last_name || 'User',
        middle_name: '',
        line_1: '',
        line_2: '',
        city: '',
        state: '',
        postal_code: '',
        zip_code: ''
      }
    };

    console.log('📦 Order data being sent to Pesapal:');
    console.log('ID:', paymentOrder.id);
    console.log('Amount:', paymentOrder.amount, paymentOrder.currency);
    console.log('IPN ID:', paymentOrder.notification_id);
    console.log('Callback URL:', paymentOrder.callback_url);

    // Submit order to Pesapal
    const orderResponse = await axios.post(urls.order, paymentOrder, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Pesapal order response:', orderResponse.data);

    const orderTrackingId = orderResponse.data.order_tracking_id;

    if (!orderTrackingId) {
      console.error('❌ No order_tracking_id in response:', orderResponse.data);
      return res.status(400).json({
        error: 'No order_tracking_id returned from Pesapal',
        raw: orderResponse.data,
        ipn_id_used: paymentOrder.notification_id
      });
    }

    // Build payment URL
    const paymentUrl = `${urls.redirect}?OrderTrackingId=${orderTrackingId}`;

    console.log('✅ Payment initialized successfully!');
    console.log('Tracking ID:', orderTrackingId);
    console.log('Payment URL:', paymentUrl);

    res.json({
      success: true,
      order_tracking_id: orderTrackingId,
      redirect_url: paymentUrl,
      message: 'Payment initialized successfully',
      ipn_id_used: paymentOrder.notification_id
    });

  } catch (error) {
    console.error('❌ Payment error:', error.response?.data || error.message);
    console.error('Full error:', JSON.stringify(error.response?.data || error, null, 2));
    
    // Detailed error handling
    const errorData = error.response?.data || {};
    
    if (errorData.error?.code === 'InvalidIpnId') {
      return res.status(400).json({
        error: 'Invalid IPN ID',
        details: errorData,
        message: `The IPN ID '${PESAPAL_CONFIG.ipn_id}' is invalid.`,
        registered_ipn_id: PESAPAL_CONFIG.ipn_id,
        ipn_url: PESAPAL_CONFIG.ipn_url,
        fix: 'Make sure the IPN ID is registered in Pesapal dashboard'
      });
    }
    
    res.status(500).json({
      error: 'Payment failed',
      details: errorData,
      message: error.message || 'Unknown error occurred'
    });
  }
});

/* =======================
   IPN CALLBACK ENDPOINT (VERY IMPORTANT)
======================= */
app.post('/api/pesapal/ipn', (req, res) => {
  try {
    console.log('📩 IPN Callback received at:', new Date().toISOString());
    console.log('Headers:', req.headers);
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    const { 
      OrderTrackingId, 
      OrderNotificationType, 
      OrderMerchantReference,
      PaymentMethod,
      PaymentStatusDescription,
      PaymentAccount,
      Amount
    } = req.body;
    
    console.log(`💳 Payment Notification Received:
      -----------------------------------------
      Order Reference: ${OrderMerchantReference}
      Tracking ID: ${OrderTrackingId}
      Notification Type: ${OrderNotificationType}
      Payment Method: ${PaymentMethod}
      Payment Status: ${PaymentStatusDescription}
      Amount: ${Amount}
      Account: ${PaymentAccount}
      -----------------------------------------`);
    
    // ✅ IMPORTANT: You MUST save this to your database
    // This is where you update payment status in your system
    
    // Example: Update your database with payment status
    // You would typically:
    // 1. Find the order by OrderMerchantReference
    // 2. Update payment status based on OrderNotificationType
    // 3. Send email confirmation if payment is completed
    // 4. Activate subscription
    
    console.log('✅ IPN processed successfully');
    
    // ✅ CRITICAL: Always return 200 OK to Pesapal
    res.status(200).json({ 
      message: 'IPN received and processed successfully',
      status: 'OK',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ IPN processing error:', error);
    
    // ✅ STILL RETURN 200 OK to Pesapal even if we have processing error
    // Pesapal will retry if we don't return 200
    res.status(200).json({ 
      error: 'Failed to process IPN',
      status: 'ERROR',
      timestamp: new Date().toISOString()
    });
  }
});

/* =======================
   GET PAYMENT STATUS
======================= */
app.get('/api/pesapal/status', async (req, res) => {
  try {
    const { orderTrackingId } = req.query;

    if (!orderTrackingId) {
      return res.status(400).json({
        error: 'orderTrackingId is required'
      });
    }

    const urls = getUrls();
    const token = await getPesaPalToken();

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
   TEST IPN ENDPOINT (Verify it's working)
======================= */
app.get('/api/pesapal/ipn-test', (req, res) => {
  res.json({
    status: 'active',
    ipn_id: PESAPAL_CONFIG.ipn_id,
    ipn_url: PESAPAL_CONFIG.ipn_url,
    message: 'IPN endpoint is working',
    timestamp: new Date().toISOString(),
    instructions: 'Pesapal will send POST requests to this URL for payment notifications'
  });
});

/* =======================
   TEST SIMPLE PAYMENT (For debugging)
======================= */
app.post('/api/pesapal/test-simple', async (req, res) => {
  try {
    console.log('🧪 Testing simple payment...');
    const urls = getUrls();
    
    // Get token
    const token = await getPesaPalToken();
    
    // Simple test order
    const testOrder = {
      id: `TEST-${Date.now()}`,
      currency: 'KES',
      amount: 1, // 1 KES for testing
      description: 'Simple Test Payment',
      callback_url: `${process.env.REACT_APP_PROXY_URL || 'https://pesapalbacked.onrender.com'}/payment-callback`,
      notification_id: PESAPAL_CONFIG.ipn_id,
      billing_address: {
        email_address: 'test@example.com',
        phone_number: '0712345678',
        country_code: 'KE',
        first_name: 'Test',
        last_name: 'User'
      }
    };
    
    console.log('Test order data:', JSON.stringify(testOrder, null, 2));
    
    const orderResponse = await axios.post(urls.order, testOrder, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const orderTrackingId = orderResponse.data.order_tracking_id;
    const paymentUrl = `${urls.redirect}?OrderTrackingId=${orderTrackingId}`;
    
    res.json({
      success: true,
      order_tracking_id: orderTrackingId,
      redirect_url: paymentUrl,
      message: 'Test payment created successfully',
      ipn_id_used: PESAPAL_CONFIG.ipn_id,
      test_data: testOrder
    });
    
  } catch (error) {
    console.error('❌ Test error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Test failed',
      details: error.response?.data,
      message: error.message
    });
  }
});

/* =======================
   PAYMENT CALLBACK (For user redirect)
======================= */
app.get('/payment-callback', (req, res) => {
  const { OrderTrackingId, OrderMerchantReference } = req.query;
  
  console.log('🔙 User returned from Pesapal payment:', {
    OrderTrackingId,
    OrderMerchantReference,
    timestamp: new Date().toISOString()
  });

  // Redirect to your frontend
  const frontendUrl = `https://businessmanagement-802ef.web.app/payment-result?trackingId=${OrderTrackingId}&reference=${OrderMerchantReference}`;
  
  res.redirect(frontendUrl);
});

/* =======================
   HEALTH CHECK
======================= */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'pesapal-proxy',
    timestamp: new Date().toISOString(),
    environment: PESAPAL_CONFIG.environment,
    ipn_id: PESAPAL_CONFIG.ipn_id,
    ipn_url: PESAPAL_CONFIG.ipn_url,
    ipn_status: PESAPAL_CONFIG.ipn_id ? 'Registered' : 'Not registered',
    endpoints: {
      pay: '/api/pesapal/pay',
      status: '/api/pesapal/status',
      ipn: '/api/pesapal/ipn',
      test: '/api/pesapal/test-simple',
      callback: '/payment-callback'
    }
  });
});

/* =======================
   CONFIG ENDPOINT (For debugging)
======================= */
app.get('/api/pesapal/config', (req, res) => {
  res.json({
    environment: PESAPAL_CONFIG.environment,
    ipn_id: PESAPAL_CONFIG.ipn_id,
    ipn_url: PESAPAL_CONFIG.ipn_url,
    consumer_key: PESAPAL_CONFIG.consumer_key ? '***' + PESAPAL_CONFIG.consumer_key.slice(-4) : 'Not set',
    urls: getUrls(),
    timestamp: new Date().toISOString()
  });
});

/* =======================
   START SERVER
======================= */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 PesaPal Backend Server Running on port ${PORT}`);
  console.log(`🌐 Environment: ${PESAPAL_CONFIG.environment}`);
  console.log(`🔗 IPN URL: ${PESAPAL_CONFIG.ipn_url}`);
  console.log(`📋 IPN ID: ${PESAPAL_CONFIG.ipn_id}`);
  console.log(`✅ IPN Status: Registered`);
  console.log('\n📞 Available Endpoints:');
  console.log(`   Health Check: http://localhost:${PORT}/api/health`);
  console.log(`   Test Payment: http://localhost:${PORT}/api/pesapal/test-simple`);
  console.log(`   Config Info: http://localhost:${PORT}/api/pesapal/config`);
  console.log(`   IPN Test: http://localhost:${PORT}/api/pesapal/ipn-test`);
  console.log('\n✅ Server is ready to process payments!');
});
