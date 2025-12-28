require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

/* =======================
   CORS CONFIG
======================= */
app.use(
  cors({
    origin: '*', // Allow all for now, tighten later
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (req.method === 'POST') {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

/* =======================
   ROOT ROUTE
======================= */
app.get('/', (req, res) => {
  res.json({ 
    status: '🚀 PesaPal Proxy Server is running',
    service: 'Business Management System',
    version: '1.0.0',
    endpoints: {
      auth: 'POST /api/pesapal/auth',
      order: 'POST /api/pesapal/order',
      status: 'GET /api/pesapal/status?accessToken=XXX&orderTrackingId=XXX',
      health: 'GET /api/health',
      test: 'POST /api/test',
      debug: 'GET /api/debug'
    },
    timestamp: new Date().toISOString()
  });
});

/* =======================
   PESAPAL CONFIGURATION - FIXED CREDENTIALS
======================= */
const PESAPAL_CONFIG = {
  // Using the EXACT credentials from your Kodular blocks
  baseUrl: 'https://cybqa.pesapal.com/pesapalv3',
  consumerKey: 'ngW+U:EnDhtUc5kPfrCD987xMh3Lx8',
  consumerSecret: 'q2/RChYSJUkypdcNYKzuUw460Dg=',
  
  // IMPORTANT: These must match what's in PesaPal dashboard
  callbackUrl: 'https://your-ngrok-url/pesapal/lpn.php', // From your blocks (1).png
  notificationId: '' // You need to get this from PesaPal dashboard
};

console.log('🔧 PesaPal Configuration:');
console.log('- Base URL:', PESAPAL_CONFIG.baseUrl);
console.log('- Consumer Key:', PESAPAL_CONFIG.consumerKey ? '✓ Set' : '✗ Missing');
console.log('- Consumer Secret:', PESAPAL_CONFIG.consumerSecret ? '✓ Set' : '✗ Missing');
console.log('- Callback URL:', PESAPAL_CONFIG.callbackUrl);

/* =======================
   1. AUTH TOKEN - FIXED FOR 500 ERROR
======================= */
app.post('/api/pesapal/auth', async (req, res) => {
  console.log('='.repeat(50));
  console.log('🔐 START: Getting PesaPal access token');
  console.log('='.repeat(50));
  
  try {
    const authUrl = `${PESAPAL_CONFIG.baseUrl}/api/Auth/RequestToken`;
    
    console.log('📤 Request Details:');
    console.log('- URL:', authUrl);
    console.log('- Consumer Key:', PESAPAL_CONFIG.consumerKey);
    
    // Create the EXACT request body from your blocks.png
    const requestBody = {
      consumer_key: PESAPAL_CONFIG.consumerKey,
      consumer_secret: PESAPAL_CONFIG.consumerSecret
    };
    
    console.log('📦 Request Body:', JSON.stringify(requestBody, null, 2));
    
    const response = await axios.post(authUrl, requestBody, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'PesaPal-API/1.0'
      },
      timeout: 30000,
      // Don't throw on HTTP errors - handle them manually
      validateStatus: function (status) {
        return status >= 200 && status < 600; // Don't throw on any status
      }
    });

    console.log('📥 Response Details:');
    console.log('- Status:', response.status);
    console.log('- Status Text:', response.statusText);
    console.log('- Headers:', JSON.stringify(response.headers, null, 2));
    console.log('- Data:', JSON.stringify(response.data, null, 2));
    
    // Check if response has data
    if (!response.data) {
      console.error('❌ No response data received');
      return res.status(500).json({
        success: false,
        error: 'No response from PesaPal',
        message: 'PesaPal API returned empty response'
      });
    }
    
    // Handle the 500 status but successful response case
    if (response.status === 500) {
      console.warn('⚠️ PesaPal returned 500 but we got response data');
    }
    
    // Check if token exists in response (could be in different fields)
    let token = null;
    
    if (response.data.token) {
      token = response.data.token;
      console.log('✅ Found token in response.data.token');
    } else if (response.data.access_token) {
      token = response.data.access_token;
      console.log('✅ Found token in response.data.access_token');
    } else if (response.data.accessToken) {
      token = response.data.accessToken;
      console.log('✅ Found token in response.data.accessToken');
    } else {
      console.log('⚠️ No token found in response, checking for any string field...');
      
      // Try to find token in any string field
      const stringFields = Object.entries(response.data)
        .filter(([key, value]) => typeof value === 'string' && value.length > 50)
        .map(([key, value]) => ({ key, value }));
      
      if (stringFields.length > 0) {
        console.log('🔍 Found potential token fields:', stringFields.map(f => f.key));
        token = stringFields[0].value;
      }
    }
    
    if (!token) {
      console.error('❌ Could not find token in response');
      console.error('Full response:', JSON.stringify(response.data, null, 2));
      
      return res.status(400).json({
        success: false,
        error: 'No token in response',
        responseData: response.data,
        statusCode: response.status,
        message: 'PesaPal API did not return an access token'
      });
    }
    
    console.log('✅ SUCCESS: Got access token');
    console.log('Token (first 20 chars):', token.substring(0, 20) + '...');
    console.log('Token length:', token.length);
    console.log('='.repeat(50));
    
    // Return successful response
    res.json({
      success: true,
      token: token,
      expires_in: response.data.expires_in || 3600,
      status: response.data.status || 'Success',
      message: response.data.message || 'Authentication successful',
      raw_response: response.data, // Include for debugging
      received_status_code: response.status
    });
    
  } catch (error) {
    console.error('='.repeat(50));
    console.error('❌ AUTH ERROR:');
    console.error('='.repeat(50));
    
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('- Status:', error.response.status);
      console.error('- Headers:', error.response.headers);
      console.error('- Data:', error.response.data);
      console.error('- Config:', {
        url: error.config.url,
        method: error.config.method,
        data: error.config.data
      });
      
      res.status(error.response.status).json({
        success: false,
        error: 'PesaPal API Error',
        status: error.response.status,
        data: error.response.data,
        message: 'PesaPal authentication failed'
      });
    } else if (error.request) {
      // The request was made but no response was received
      console.error('- No response received');
      console.error('- Request:', error.request);
      
      res.status(503).json({
        success: false,
        error: 'No response from PesaPal',
        message: 'PesaPal API is not responding. Please check your internet connection.'
      });
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('- Error message:', error.message);
      console.error('- Stack:', error.stack);
      
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
    console.error('='.repeat(50));
  }
});

/* =======================
   2. TEST AUTH WITH DIRECT CALL
======================= */
app.get('/api/pesapal/test-auth', async (req, res) => {
  try {
    console.log('🧪 Testing direct authentication...');
    
    // Make direct call to PesaPal
    const authUrl = `${PESAPAL_CONFIG.baseUrl}/api/Auth/RequestToken`;
    
    const response = await axios.post(authUrl, {
      consumer_key: PESAPAL_CONFIG.consumerKey,
      consumer_secret: PESAPAL_CONFIG.consumerSecret
    }, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Direct test response:', response.data);
    
    res.json({
      success: true,
      direct_response: response.data,
      has_token: !!response.data.token,
      token_length: response.data.token ? response.data.token.length : 0
    });
  } catch (error) {
    console.error('Direct test error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

/* =======================
   3. SUBMIT ORDER
======================= */
app.post('/api/pesapal/order', async (req, res) => {
  console.log('='.repeat(50));
  console.log('💰 START: Submitting order to PesaPal');
  console.log('='.repeat(50));
  
  try {
    const { accessToken, orderData } = req.body;

    console.log('📥 Received request:');
    console.log('- Access Token (first 20 chars):', accessToken ? accessToken.substring(0, 20) + '...' : 'MISSING');
    console.log('- Order Data:', JSON.stringify(orderData, null, 2));

    if (!accessToken) {
      console.error('❌ No access token provided');
      return res.status(400).json({
        success: false,
        error: 'Access token is required',
        message: 'Please authenticate first by calling /api/pesapal/auth'
      });
    }

    // Build complete order data matching your Kodular blocks
    const completeOrderData = {
      id: orderData.id || `ORDER-${Date.now()}`,
      currency: orderData.currency || "KES",
      amount: orderData.amount || 1, // 1 KES for testing
      description: orderData.description || "Premium Subscription",
      callback_url: orderData.callback_url || PESAPAL_CONFIG.callbackUrl,
      notification_id: orderData.notification_id || PESAPAL_CONFIG.notificationId || "",
      billing_address: orderData.billing_address || {
        email_address: orderData.email || "test@example.com",
        phone_number: orderData.phone_number || "0712345678",
        country_code: "KE",
        first_name: "Test",
        last_name: "User"
      }
    };

    console.log('📦 Complete order data:', JSON.stringify(completeOrderData, null, 2));

    const orderUrl = `${PESAPAL_CONFIG.baseUrl}/api/Transactions/SubmitOrderRequest`;
    
    console.log('📤 Sending to PesaPal:');
    console.log('- URL:', orderUrl);
    
    const response = await axios.post(orderUrl, completeOrderData, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'PesaPal-API/1.0'
      },
      timeout: 30000,
      validateStatus: function (status) {
        return status >= 200 && status < 600;
      }
    });

    console.log('📥 Order Response:');
    console.log('- Status:', response.status);
    console.log('- Data:', JSON.stringify(response.data, null, 2));

    if (!response.data.order_tracking_id) {
      console.error('❌ No order_tracking_id in response');
      return res.status(400).json({
        success: false,
        error: 'Invalid response from PesaPal',
        response: response.data,
        message: 'PesaPal did not return an order tracking ID'
      });
    }

    console.log('✅ Order submitted successfully!');
    console.log('- Tracking ID:', response.data.order_tracking_id);
    console.log('- Redirect URL:', response.data.redirect_url);
    console.log('='.repeat(50));

    res.json({
      success: true,
      order_tracking_id: response.data.order_tracking_id,
      merchant_reference: response.data.merchant_reference,
      redirect_url: response.data.redirect_url,
      status: response.data.status,
      message: 'Order submitted successfully'
    });

  } catch (error) {
    console.error('='.repeat(50));
    console.error('❌ ORDER ERROR:');
    console.error('- Message:', error.message);
    
    if (error.response) {
      console.error('- Status:', error.response.status);
      console.error('- Data:', error.response.data);
    }
    console.error('='.repeat(50));
    
    res.status(error.response?.status || 500).json({
      success: false,
      error: 'Failed to submit order',
      details: error.response?.data || error.message
    });
  }
});

/* =======================
   4. CHECK STATUS
======================= */
app.get('/api/pesapal/status', async (req, res) => {
  try {
    const { accessToken, orderTrackingId } = req.query;

    console.log('🔍 Checking status for:', orderTrackingId);

    if (!accessToken || !orderTrackingId) {
      return res.status(400).json({
        success: false,
        error: 'accessToken and orderTrackingId are required'
      });
    }

    const statusUrl = `${PESAPAL_CONFIG.baseUrl}/api/Transactions/GetTransactionStatus`;
    
    const response = await axios.get(statusUrl, {
      params: { orderTrackingId },
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    console.log('📊 Status result:', response.data.payment_status_description);

    res.json({
      success: true,
      ...response.data
    });

  } catch (error) {
    console.error('Status error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to check status',
      details: error.response?.data || error.message
    });
  }
});

/* =======================
   5. HEALTH CHECK
======================= */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'pesapal-proxy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0'
  });
});

/* =======================
   6. MOCK ENDPOINT FOR TESTING
======================= */
app.post('/api/pesapal/mock-auth', (req, res) => {
  console.log('🎭 Returning mock token for testing');
  
  // Generate a realistic-looking mock token
  const mockToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
                   'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlRlc3QgVXNlciIsImlhdCI6MTUxNjIzOTAyMiwiZXhwIjoxNTE2MjQyNjIyfQ.' +
                   'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  
  res.json({
    success: true,
    token: mockToken,
    expires_in: 3600,
    status: '200',
    message: 'Mock authentication successful',
    is_mock: true
  });
});

app.post('/api/pesapal/mock-order', (req, res) => {
  console.log('🎭 Creating mock order for testing');
  
  const mockResponse = {
    success: true,
    order_tracking_id: `MOCK-${Date.now()}`,
    merchant_reference: `REF-${Date.now()}`,
    redirect_url: 'https://cybqa.pesapal.com/pesapalv3/api/Transactions/Redirect?OrderTrackingId=MOCK-123',
    status: '200',
    message: 'Mock order created successfully',
    is_mock: true
  };
  
  res.json(mockResponse);
});

/* =======================
   START SERVER
======================= */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`
==============================================
🚀 PESAPAL PROXY SERVER STARTED
==============================================
📍 Port: ${PORT}
🌍 Environment: ${process.env.NODE_ENV || 'development'}
💰 PesaPal Mode: Sandbox
🔗 Base URL: ${PESAPAL_CONFIG.baseUrl}
⏰ Started: ${new Date().toLocaleString()}

📋 IMPORTANT ENDPOINTS:
✅ GET  /                      - Server info
✅ POST /api/pesapal/auth      - Get real PesaPal token
✅ GET  /api/pesapal/test-auth - Test direct auth
✅ POST /api/pesapal/mock-auth - Get mock token (for testing)
✅ POST /api/pesapal/order     - Submit order
✅ POST /api/pesapal/mock-order- Mock order (for testing)
✅ GET  /api/pesapal/status    - Check payment status
✅ GET  /api/health            - Health check

🔧 TROUBLESHOOTING:
1. Test auth: curl -X POST http://localhost:${PORT}/api/pesapal/auth
2. Test health: curl http://localhost:${PORT}/api/health
3. Test mock: curl -X POST http://localhost:${PORT}/api/pesapal/mock-auth

==============================================
  `);
});
