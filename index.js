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
  'https://businessmanagement-802ef.firebaseapp.com/',
  'http://localhost:3001' // Add for local testing
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log('⚠️ CORS blocked origin:', origin);
        callback(null, true); // Temporarily allow all for debugging
        // For production: callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

/* =======================
   ROOT ROUTE (IMPORTANT)
======================= */
app.get('/', (req, res) => {
  res.json({ 
    status: '🚀 Pesapal backend is running',
    endpoints: {
      auth: 'POST /api/pesapal/auth',
      order: 'POST /api/pesapal/order',
      status: 'GET /api/pesapal/status',
      health: 'GET /api/health',
      test: 'POST /api/test'
    },
    timestamp: new Date().toISOString()
  });
});

/* =======================
   PESAPAL CONFIGURATION
======================= */
const PESAPAL_CONFIG = {
  // Use sandbox for testing
  baseUrl: process.env.PESAPAL_ENV === 'live' 
    ? 'https://pay.pesapal.com/v3'
    : 'https://cybqa.pesapal.com/pesapalv3',
  
  consumerKey: process.env.PESAPAL_CONSUMER_KEY || 'ngW+U:EnDhtUc5kPfrCD987xMh3Lx8',
  consumerSecret: process.env.PESAPAL_CONSUMER_SECRET || 'q2/RChYSJUkypdcNYKzuUw460Dg=',
  
  // Default callback URL
  callbackUrl: process.env.PESAPAL_CALLBACK_URL || 'https://businessmanagement-802ef.web.app/payment-callback',
  
  // Default notification ID (you need to register this in PesaPal dashboard)
  notificationId: process.env.PESAPAL_NOTIFICATION_ID || ''
};

console.log('📋 PesaPal Configuration:', {
  environment: process.env.PESAPAL_ENV || 'sandbox',
  baseUrl: PESAPAL_CONFIG.baseUrl,
  callbackUrl: PESAPAL_CONFIG.callbackUrl
});

/* =======================
   1. AUTH TOKEN (FIXED)
======================= */
app.post('/api/pesapal/auth', async (req, res) => {
  try {
    console.log('🔐 Getting Pesapal token...');
    
    const authUrl = `${PESAPAL_CONFIG.baseUrl}/api/Auth/RequestToken`;
    
    console.log('Auth URL:', authUrl);
    console.log('Consumer Key:', PESAPAL_CONFIG.consumerKey ? 'Present' : 'Missing');
    
    const response = await axios.post(
      authUrl,
      {
        consumer_key: PESAPAL_CONFIG.consumerKey,
        consumer_secret: PESAPAL_CONFIG.consumerSecret
      },
      {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'PesaPal-Proxy/1.0'
        },
        timeout: 10000 // 10 second timeout
      }
    );

    console.log('✅ Auth successful:', {
      hasToken: !!response.data.token,
      expiresIn: response.data.expires_in,
      status: response.data.status
    });

    res.json({
      success: true,
      token: response.data.token,
      expires_in: response.data.expires_in,
      status: response.data.status,
      message: 'Authentication successful'
    });
  } catch (error) {
    console.error('❌ Auth error details:');
    console.error('- URL:', error.config?.url);
    console.error('- Status:', error.response?.status);
    console.error('- Data:', error.response?.data);
    console.error('- Message:', error.message);
    
    res.status(error.response?.status || 500).json({
      success: false,
      error: 'Failed to authenticate with Pesapal',
      details: error.response?.data || error.message,
      message: 'Please check your PesaPal credentials'
    });
  }
});

/* =======================
   2. SUBMIT ORDER (COMPLETE FIX)
======================= */
app.post('/api/pesapal/order', async (req, res) => {
  try {
    const { accessToken, orderData } = req.body;

    console.log('💰 Received order request:', {
      hasAccessToken: !!accessToken,
      orderId: orderData?.id,
      amount: orderData?.amount,
      currency: orderData?.currency
    });

    if (!accessToken) {
      return res.status(400).json({
        success: false,
        error: 'Access token is required',
        message: 'Please authenticate first'
      });
    }

    if (!orderData) {
      return res.status(400).json({
        success: false,
        error: 'Order data is required',
        message: 'Please provide order details'
      });
    }

    // Validate required fields
    const requiredFields = ['id', 'amount', 'currency', 'description', 'callback_url'];
    const missingFields = requiredFields.filter(field => !orderData[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        missing: missingFields,
        message: `Please provide: ${missingFields.join(', ')}`
      });
    }

    // Ensure notification_id is included
    const enhancedOrderData = {
      ...orderData,
      notification_id: orderData.notification_id || PESAPAL_CONFIG.notificationId || "",
      // Ensure billing_address has all required fields
      billing_address: orderData.billing_address || {
        email_address: orderData.billing_address?.email_address || "test@example.com",
        phone_number: orderData.billing_address?.phone_number || "0712345678",
        country_code: "KE",
        first_name: "Test",
        last_name: "User"
      }
    };

    console.log('📦 Enhanced order data:', {
      id: enhancedOrderData.id,
      amount: enhancedOrderData.amount,
      callback_url: enhancedOrderData.callback_url,
      notification_id: enhancedOrderData.notification_id ? "Present" : "Missing"
    });

    const orderUrl = `${PESAPAL_CONFIG.baseUrl}/api/Transactions/SubmitOrderRequest`;
    
    const response = await axios.post(
      orderUrl,
      enhancedOrderData,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'PesaPal-Proxy/1.0'
        },
        timeout: 15000 // 15 second timeout
      }
    );

    console.log('✅ Order response from PesaPal:', {
      trackingId: response.data.order_tracking_id,
      merchantRef: response.data.merchant_reference,
      redirectUrl: response.data.redirect_url ? "Present" : "Missing",
      status: response.data.status
    });

    if (!response.data.order_tracking_id) {
      console.warn('⚠️ No order_tracking_id in response:', response.data);
    }

    // Build redirect URL if not provided
    let redirectUrl = response.data.redirect_url;
    if (!redirectUrl && response.data.order_tracking_id) {
      redirectUrl = `https://cybqa.pesapal.com/pesapalv3/api/Transactions/Redirect?OrderTrackingId=${response.data.order_tracking_id}`;
    }

    res.json({
      success: true,
      order_tracking_id: response.data.order_tracking_id,
      merchant_reference: response.data.merchant_reference,
      redirect_url: redirectUrl,
      status: response.data.status,
      message: 'Order submitted successfully'
    });

  } catch (error) {
    console.error('❌ Order submission error details:');
    console.error('- URL:', error.config?.url);
    console.error('- Status:', error.response?.status);
    console.error('- Headers:', error.config?.headers?.Authorization ? 'Token present' : 'No token');
    console.error('- Data sent:', error.config?.data);
    console.error('- Response data:', error.response?.data);
    
    res.status(error.response?.status || 500).json({
      success: false,
      error: 'Failed to submit order to Pesapal',
      details: error.response?.data || error.message,
      message: 'Please check your order data and try again'
    });
  }
});

/* =======================
   3. CHECK STATUS (IMPROVED)
======================= */
app.get('/api/pesapal/status', async (req, res) => {
  try {
    const { accessToken, orderTrackingId } = req.query;

    console.log('🔍 Checking status:', { orderTrackingId });

    if (!accessToken) {
      return res.status(400).json({
        success: false,
        error: 'Access token is required'
      });
    }

    if (!orderTrackingId) {
      return res.status(400).json({
        success: false,
        error: 'Order tracking ID is required'
      });
    }

    const statusUrl = `${PESAPAL_CONFIG.baseUrl}/api/Transactions/GetTransactionStatus`;
    
    const response = await axios.get(statusUrl, {
      params: {
        orderTrackingId: orderTrackingId
      },
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'User-Agent': 'PesaPal-Proxy/1.0'
      },
      timeout: 10000
    });

    console.log('📊 Status check result:', {
      orderTrackingId,
      status: response.data.payment_status_description,
      method: response.data.payment_method
    });

    res.json({
      success: true,
      ...response.data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Status check error:', {
      orderTrackingId: req.query.orderTrackingId,
      status: error.response?.status,
      data: error.response?.data
    });
    
    res.status(error.response?.status || 500).json({
      success: false,
      error: 'Failed to check payment status',
      details: error.response?.data || error.message
    });
  }
});

/* =======================
   4. HEALTH CHECK (ENHANCED)
======================= */
app.get('/api/health', (req, res) => {
  const health = {
    status: 'healthy',
    service: 'pesapal-proxy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    pesapalEnv: process.env.PESAPAL_ENV || 'sandbox',
    hasConsumerKey: !!PESAPAL_CONFIG.consumerKey,
    hasConsumerSecret: !!PESAPAL_CONFIG.consumerSecret,
    callbackUrl: PESAPAL_CONFIG.callbackUrl,
    uptime: process.uptime(),
    memory: process.memoryUsage()
  };
  
  console.log('🏥 Health check:', health);
  res.json(health);
});

/* =======================
   5. TEST ENDPOINT (ENHANCED)
======================= */
app.post('/api/test', (req, res) => {
  console.log('🧪 Test request received:', req.body);
  
  res.json({
    success: true,
    message: 'Backend is working!',
    receivedData: req.body,
    serverTime: new Date().toISOString(),
    headers: req.headers,
    environment: {
      nodeEnv: process.env.NODE_ENV,
      pesapalEnv: process.env.PESAPAL_ENV
    }
  });
});

/* =======================
   6. SIMULATED PAYMENT (FOR DEVELOPMENT)
======================= */
app.post('/api/pesapal/simulate', (req, res) => {
  console.log('🎭 Simulating payment (development mode)');
  
  const { orderId, amount = 1, method = 'M-Pesa' } = req.body;
  
  // Simulate processing delay
  setTimeout(() => {
    const mockResponse = {
      success: true,
      order_tracking_id: orderId || `MOCK-${Date.now()}`,
      merchant_reference: `MOCK-REF-${Date.now()}`,
      redirect_url: null,
      payment_status_description: 'Completed',
      payment_method: method,
      amount: amount,
      currency: 'KES',
      message: 'Mock payment successful - Development mode only',
      is_mock: true,
      timestamp: new Date().toISOString()
    };
    
    console.log('✅ Mock payment completed:', mockResponse.order_tracking_id);
    res.json(mockResponse);
  }, 1000);
});

/* =======================
   7. DEBUG ENDPOINT
======================= */
app.get('/api/debug', (req, res) => {
  res.json({
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      PESAPAL_ENV: process.env.PESAPAL_ENV,
      PORT: process.env.PORT,
      CONSUMER_KEY: PESAPAL_CONFIG.consumerKey ? '✓ Set' : '✗ Missing',
      CONSUMER_SECRET: PESAPAL_CONFIG.consumerSecret ? '✓ Set' : '✗ Missing'
    },
    urls: {
      baseUrl: PESAPAL_CONFIG.baseUrl,
      authUrl: `${PESAPAL_CONFIG.baseUrl}/api/Auth/RequestToken`,
      orderUrl: `${PESAPAL_CONFIG.baseUrl}/api/Transactions/SubmitOrderRequest`,
      statusUrl: `${PESAPAL_CONFIG.baseUrl}/api/Transactions/GetTransactionStatus`
    },
    allowedOrigins: allowedOrigins,
    timestamp: new Date().toISOString()
  });
});

/* =======================
   ERROR HANDLING MIDDLEWARE
======================= */
app.use((err, req, res, next) => {
  console.error('🔥 Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path,
    method: req.method
  });
});

/* =======================
   START SERVER
======================= */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`
🚀 PesaPal Proxy Server Started!
📍 Port: ${PORT}
🌍 Environment: ${process.env.NODE_ENV || 'development'}
💰 PesaPal Mode: ${process.env.PESAPAL_ENV || 'sandbox'}
🔗 Base URL: ${PESAPAL_CONFIG.baseUrl}
📅 ${new Date().toISOString()}

📋 Available Endpoints:
✅ GET  /                    - Server info
✅ POST /api/pesapal/auth    - Get PesaPal token
✅ POST /api/pesapal/order   - Submit payment order
✅ GET  /api/pesapal/status  - Check payment status
✅ POST /api/pesapal/simulate - Simulate payment (dev)
✅ GET  /api/health          - Health check
✅ POST /api/test            - Test endpoint
✅ GET  /api/debug           - Debug info

⚡ Ready to process payments!
  `);
});
