require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// CORS Configuration - Configure allowed origins for production
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['https://businessmanagement-802ef.web.app'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Handle preflight requests
app.options('*', cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =======================
   PESAPAL CONFIGURATION
======================= */
const PESAPAL_CONFIG = {
  consumer_key: process.env.PESAPAL_CONSUMER_KEY,
  consumer_secret: process.env.PESAPAL_CONSUMER_SECRET,
  ipn_id: process.env.PESAPAL_IPN_ID || 'b4b7cb67-2838-4678-97d6-daebcc791391',
  environment: 'live'
};

// Validate required environment variables
if (!PESAPAL_CONFIG.consumer_key || !PESAPAL_CONFIG.consumer_secret) {
  console.error('❌ ERROR: Missing Pesapal credentials. Please set PESAPAL_CONSUMER_KEY and PESAPAL_CONSUMER_SECRET environment variables.');
  process.exit(1);
}

const PESAPAL_URLS = {
  live: {
    auth: 'https://pay.pesapal.com/v3/api/Auth/RequestToken',
    order: 'https://pay.pesapal.com/v3/api/Transactions/SubmitOrderRequest',
    status: 'https://pay.pesapal.com/v3/api/Transactions/GetTransactionStatus',
    ipn: 'https://pay.pesapal.com/v3/api/URLSetup/RegisterIPN',
    payment: 'https://pay.pesapal.com/pesapaliframe/PesapalIframe3/Index'
  }
};

const getUrls = () => PESAPAL_URLS.live;

/* =======================
   GET AUTH TOKEN
======================= */
async function getPesaPalToken() {
  try {
    const urls = getUrls();
    
    const response = await axios.post(urls.auth, {
      consumer_key: PESAPAL_CONFIG.consumer_key,
      consumer_secret: PESAPAL_CONFIG.consumer_secret
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 10000 // 10 second timeout
    });
    
    if (!response.data.token) {
      throw new Error('No token received from Pesapal');
    }
    
    return response.data.token;
  } catch (error) {
    console.error('❌ Token error:', error.response?.data || error.message);
    throw error;
  }
}

/* =======================
   CREATE ORDER & RETURN PAYMENT URL
======================= */
app.post('/api/pesapal/create-payment', async (req, res) => {
  try {
    const { orderData } = req.body;

    if (!orderData) {
      return res.status(400).json({
        error: 'orderData is required'
      });
    }

    // Validate required fields
    if (!orderData.amount || !orderData.email) {
      return res.status(400).json({
        error: 'amount and email are required fields'
      });
    }

    const urls = getUrls();
    const token = await getPesaPalToken();

    // Prepare order data with all required fields
    const paymentOrder = {
      id: orderData.id || `ORDER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      currency: orderData.currency || 'USD',
      amount: orderData.amount,
      description: orderData.description || 'Business Subscription',
      callback_url: `${process.env.REACT_APP_PROXY_URL || 'https://pesapalbacked.onrender.com'}/payment-callback`,
      notification_id: PESAPAL_CONFIG.ipn_id,
      billing_address: {
        email_address: orderData.email,
        phone_number: orderData.phone || '',
        country_code: orderData.country_code || 'KE',
        first_name: orderData.first_name || '',
        last_name: orderData.last_name || '',
        middle_name: '',
        line_1: orderData.address_line1 || 'N/A',
        line_2: orderData.address_line2 || '',
        city: orderData.city || 'Nairobi',
        state: orderData.state || 'Nairobi',
        postal_code: orderData.postal_code || '00100',
        zip_code: orderData.zip_code || '00100'
      }
    };

    // Submit order to Pesapal
    const orderResponse = await axios.post(urls.order, paymentOrder, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 15000 // 15 second timeout
    });

    const orderTrackingId = orderResponse.data.order_tracking_id;
    const orderId = orderResponse.data.order_id;

    if (!orderTrackingId) {
      return res.status(400).json({
        error: 'No order_tracking_id returned from Pesapal'
      });
    }

    // Build payment page URL
    const paymentPageUrl = `${urls.payment}?OrderTrackingId=${orderTrackingId}&OrderMerchantReference=${paymentOrder.id}`;

    res.json({
      success: true,
      order_tracking_id: orderTrackingId,
      order_id: orderId,
      payment_page_url: paymentPageUrl,
      merchant_reference: paymentOrder.id,
      amount: paymentOrder.amount,
      currency: paymentOrder.currency,
      message: 'Payment created successfully'
    });

  } catch (error) {
    console.error('❌ Payment creation error:', error.message);
    
    const status = error.response?.status || 500;
    const message = error.response?.data?.error || error.message;
    
    res.status(status).json({
      error: 'Failed to create payment',
      message: message,
      details: process.env.NODE_ENV === 'development' ? error.response?.data : undefined
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
          Authorization: `Bearer ${token}`,
          'Accept': 'application/json'
        },
        timeout: 10000
      }
    );

    res.json({
      success: true,
      ...response.data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Status error:', error.message);
    
    res.status(500).json({
      error: 'Failed to check status',
      message: error.message
    });
  }
});

/* =======================
   PAYMENT CALLBACK
======================= */
app.get('/payment-callback', (req, res) => {
  const { OrderTrackingId, OrderMerchantReference } = req.query;
  
  console.log('Payment callback received:', {
    OrderTrackingId,
    OrderMerchantReference,
    timestamp: new Date().toISOString()
  });

  // Redirect to frontend with payment result
  const frontendUrl = `https://businessmanagement-802ef.web.app/payment-result?trackingId=${OrderTrackingId}&reference=${OrderMerchantReference}&status=success`;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Complete</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, #4CAF50 0%, #2E7D32 100%);
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          color: white;
          text-align: center;
          padding: 20px;
        }
        
        .container {
          background: rgba(255, 255, 255, 0.15);
          backdrop-filter: blur(20px);
          border-radius: 25px;
          padding: 50px 40px;
          max-width: 600px;
          width: 100%;
          box-shadow: 0 25px 50px rgba(0,0,0,0.3);
          border: 1px solid rgba(255, 255, 255, 0.3);
        }
        
        .success-icon {
          font-size: 80px;
          margin-bottom: 20px;
        }
        
        .spinner {
          width: 60px;
          height: 60px;
          border: 4px solid rgba(255, 255, 255, 0.3);
          border-top: 4px solid white;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 30px auto;
        }
        
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        h1 {
          font-size: 2.5rem;
          margin-bottom: 15px;
        }
        
        p {
          font-size: 1.2rem;
          margin-bottom: 10px;
          opacity: 0.9;
          line-height: 1.6;
        }
        
        .details {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 15px;
          padding: 20px;
          margin: 25px 0;
          text-align: left;
          font-family: 'Courier New', monospace;
          font-size: 14px;
        }
        
        .details div {
          margin: 8px 0;
          display: flex;
          justify-content: space-between;
        }
        
        .label {
          font-weight: 600;
          color: rgba(255, 255, 255, 0.8);
        }
        
        .value {
          font-weight: 700;
          word-break: break-all;
          max-width: 60%;
          text-align: right;
        }
        
        .redirect-countdown {
          font-size: 2rem;
          font-weight: 800;
          margin: 20px 0;
          color: #FFD700;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="success-icon">✅</div>
        
        <h1>Payment Successful!</h1>
        
        <p>Thank you for your payment. You will be redirected shortly.</p>
        
        <div class="details">
          <div>
            <span class="label">Tracking ID:</span>
            <span class="value">${OrderTrackingId || 'N/A'}</span>
          </div>
          <div>
            <span class="label">Order Reference:</span>
            <span class="value">${OrderMerchantReference || 'N/A'}</span>
          </div>
        </div>
        
        <div class="spinner"></div>
        
        <div class="redirect-countdown" id="countdown">5</div>
        
        <p>If you are not redirected automatically, <a href="${frontendUrl}" style="color: #FFD700; text-decoration: underline;">click here</a>.</p>
      </div>
      
      <script>
        // Start countdown
        let countdown = 5;
        const countdownEl = document.getElementById('countdown');
        const countdownInterval = setInterval(() => {
          countdown--;
          countdownEl.textContent = countdown;
          
          if (countdown <= 0) {
            clearInterval(countdownInterval);
            window.location.href = '${frontendUrl}';
          }
        }, 1000);
        
        // Redirect after 5 seconds
        setTimeout(() => {
          window.location.href = '${frontendUrl}';
        }, 5000);
      </script>
    </body>
    </html>
  `;
  
  res.send(html);
});

/* =======================
   IPN CALLBACK (Instant Payment Notification)
======================= */
app.post('/api/pesapal/ipn', (req, res) => {
  console.log('IPN received:', {
    body: req.body,
    timestamp: new Date().toISOString(),
    ip: req.ip
  });
  
  // Process IPN - Update your database here
  // This is where you should update payment status in your database
  
  // Always respond with 200 OK
  res.status(200).json({
    status: 'OK',
    message: 'IPN received successfully',
    timestamp: new Date().toISOString()
  });
});

/* =======================
   HEALTH CHECK
======================= */
app.get('/api/health', (req, res) => {
  const health = {
    status: 'ok',
    service: 'pesapal-payment-proxy',
    timestamp: new Date().toISOString(),
    environment: 'production',
    version: '1.0.0',
    endpoints: {
      create_payment: 'POST /api/pesapal/create-payment',
      status: 'GET /api/pesapal/status',
      callback: 'GET /payment-callback',
      ipn: 'POST /api/pesapal/ipn',
      health: 'GET /api/health'
    }
  };
  
  res.json(health);
});

/* =======================
   ROOT ENDPOINT
======================= */
app.get('/', (req, res) => {
  res.json({
    message: 'Pesapal Payment Gateway API',
    version: '1.0.0',
    status: 'operational',
    environment: 'production',
    timestamp: new Date().toISOString(),
    endpoints: {
      create_payment: 'POST /api/pesapal/create-payment',
      status: 'GET /api/pesapal/status',
      health: 'GET /api/health'
    }
  });
});

/* =======================
   ERROR HANDLING MIDDLEWARE
======================= */
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err.stack);
  
  res.status(500).json({
    error: 'Internal Server Error',
    message: 'Something went wrong',
    timestamp: new Date().toISOString()
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.url,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

/* =======================
   START SERVER
======================= */
const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 Pesapal Payment Gateway Started');
  console.log('='.repeat(60));
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 Environment: PRODUCTION`);
  console.log(`🔑 Consumer Key: ${PESAPAL_CONFIG.consumer_key ? 'Set ✓' : 'Not Set ✗'}`);
  console.log(`🔐 IPN ID: ${PESAPAL_CONFIG.ipn_id}`);
  console.log(`🔄 Proxy URL: ${process.env.REACT_APP_PROXY_URL || 'https://pesapalbacked.onrender.com'}`);
  console.log(`🎯 Frontend: https://businessmanagement-802ef.web.app`);
  console.log('\n📞 Available Endpoints:');
  console.log('   • GET  /                    - API Information');
  console.log('   • GET  /api/health          - Health Check');
  console.log('   • POST /api/pesapal/create-payment - Create Payment');
  console.log('   • GET  /api/pesapal/status  - Check Payment Status');
  console.log('   • GET  /payment-callback    - Payment Return Callback');
  console.log('   • POST /api/pesapal/ipn     - IPN Callback');
  console.log('='.repeat(60));
  console.log('✅ Server is ready to handle payments!\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});
