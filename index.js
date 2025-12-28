require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// CORS Configuration
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://businessmanagement-802ef.web.app',
    'https://businessmanagement-802ef.firebaseapp.com'
  ],
  credentials: true
}));

app.use(express.json());

/* =======================
   PESAPAL CONFIGURATION
======================= */
const PESAPAL_CONFIG = {
  consumer_key: process.env.PESAPAL_CONSUMER_KEY || 'ngW+UEcnDhltUc5fxPfrCD987xMh3Lx8',
  consumer_secret: process.env.PESAPAL_CONSUMER_SECRET || 'q27RChYs5UkypdcNYKzuUw460Dg=',
  ipn_id: 'ae222a4b-4039-4d40-915a-daebbe32ff99',
  environment: 'sandbox'
};

const PESAPAL_URLS = {
  sandbox: {
    auth: 'https://cybqa.pesapal.com/pesapalv3/api/Auth/RequestToken',
    order: 'https://cybqa.pesapal.com/pesapalv3/api/Transactions/SubmitOrderRequest',
    status: 'https://cybqa.pesapal.com/pesapalv3/api/Transactions/GetTransactionStatus',
    ipn: 'https://cybqa.pesapal.com/pesapalv3/api/URLSetup/RegisterIPN',
    // ✅ CORRECT PAYMENT PAGE URL
    payment: 'https://cybqa.pesapal.com/pesapaliframe/PesapalIframe3/Index'
  },
  live: {
    auth: 'https://pay.pesapal.com/v3/api/Auth/RequestToken',
    order: 'https://pay.pesapal.com/v3/api/Transactions/SubmitOrderRequest',
    status: 'https://pay.pesapal.com/v3/api/Transactions/GetTransactionStatus',
    ipn: 'https://pay.pesapal.com/v3/api/URLSetup/RegisterIPN',
    payment: 'https://pay.pesapal.com/pesapaliframe/PesapalIframe3/Index'
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

    console.log('💳 Creating Pesapal order...');
    const urls = getUrls();
    const token = await getPesaPalToken();
    
    console.log('✅ Token received');

    // Prepare order data
    const paymentOrder = {
      id: orderData.id || `ORDER-${Date.now()}`,
      currency: orderData.currency || 'KES',
      amount: orderData.amount || 10, // 10 KES for testing
      description: orderData.description || 'Payment',
      callback_url: orderData.callback_url || `${process.env.REACT_APP_PROXY_URL || 'https://pesapalbacked.onrender.com'}/payment-callback`,
      notification_id: PESAPAL_CONFIG.ipn_id,
      billing_address: {
        email_address: orderData.email || 'customer@example.com',
        phone_number: orderData.phone || '0712345678',
        country_code: orderData.country_code || 'KE',
        first_name: orderData.first_name || 'Customer',
        last_name: orderData.last_name || 'User',
        middle_name: '',
        line_1: '',
        line_2: '',
        city: '',
        state: '',
        postal_code: '',
        zip_code: ''
      }
    };

    console.log('📦 Submitting order to Pesapal...');
    console.log('Order data:', JSON.stringify(paymentOrder, null, 2));

    // Submit order to Pesapal
    const orderResponse = await axios.post(urls.order, paymentOrder, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Order submitted successfully');
    console.log('Pesapal response:', orderResponse.data);

    const orderTrackingId = orderResponse.data.order_tracking_id;

    if (!orderTrackingId) {
      console.error('❌ No order_tracking_id in response');
      return res.status(400).json({
        error: 'No order_tracking_id returned',
        raw: orderResponse.data,
        message: 'Pesapal did not return a tracking ID'
      });
    }

    // ✅ CORRECT: Build the REAL payment page URL
    const paymentPageUrl = `${urls.payment}?OrderTrackingId=${orderTrackingId}`;

    console.log('🔗 Generated payment URL:', paymentPageUrl);

    res.json({
      success: true,
      order_tracking_id: orderTrackingId,
      payment_page_url: paymentPageUrl, // ✅ Correct URL
      merchant_reference: paymentOrder.id,
      amount: paymentOrder.amount,
      currency: paymentOrder.currency,
      message: 'Payment created successfully',
      note: 'Use payment_page_url to redirect user to Pesapal payment page'
    });

  } catch (error) {
    console.error('❌ Payment creation error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to create payment',
      details: error.response?.data,
      message: error.message
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
   DIRECT TEST ENDPOINT
======================= */
app.get('/api/pesapal/test', async (req, res) => {
  try {
    const urls = getUrls();
    const token = await getPesaPalToken();
    
    // Create test order
    const testOrder = {
      id: `TEST-${Date.now()}`,
      currency: 'KES',
      amount: 1, // 1 KES for testing
      description: 'Test Payment',
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
    
    // Submit order
    const orderResponse = await axios.post(urls.order, testOrder, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const orderTrackingId = orderResponse.data.order_tracking_id;
    
    if (!orderTrackingId) {
      throw new Error('No tracking ID received');
    }
    
    // Build payment URL
    const paymentPageUrl = `${urls.payment}?OrderTrackingId=${orderTrackingId}`;
    
    // Return HTML page for testing
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Pesapal Payment Test</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            padding: 40px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: white;
          }
          .container {
            max-width: 800px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            padding: 30px;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          }
          h1 {
            color: white;
            margin-bottom: 20px;
          }
          .info-box {
            background: rgba(255, 255, 255, 0.2);
            padding: 20px;
            border-radius: 10px;
            margin: 20px 0;
          }
          .url-box {
            background: rgba(0, 0, 0, 0.3);
            padding: 15px;
            border-radius: 8px;
            margin: 10px 0;
            word-break: break-all;
            font-family: monospace;
          }
          .button {
            display: inline-block;
            background: #4CAF50;
            color: white;
            padding: 15px 30px;
            border-radius: 10px;
            text-decoration: none;
            font-weight: bold;
            margin: 10px 5px;
            transition: transform 0.2s;
          }
          .button:hover {
            transform: translateY(-2px);
            background: #45a049;
          }
          .iframe-container {
            width: 100%;
            height: 600px;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 10px;
            margin: 20px 0;
            overflow: hidden;
          }
          iframe {
            width: 100%;
            height: 100%;
            border: none;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✅ Pesapal Payment Test</h1>
          <p>Order created successfully! Here's your payment page:</p>
          
          <div class="info-box">
            <h3>Order Details:</h3>
            <p><strong>Tracking ID:</strong> ${orderTrackingId}</p>
            <p><strong>Reference:</strong> ${testOrder.id}</p>
            <p><strong>Amount:</strong> ${testOrder.amount} ${testOrder.currency}</p>
            <p><strong>Description:</strong> ${testOrder.description}</p>
          </div>
          
          <div class="info-box">
            <h3>Payment URL:</h3>
            <div class="url-box">${paymentPageUrl}</div>
            
            <a href="${paymentPageUrl}" target="_blank" class="button">
              Open in New Tab
            </a>
            
            <button onclick="document.getElementById('paymentFrame').src = '${paymentPageUrl}'" class="button" style="background: #2196F3;">
              Load in Iframe
            </button>
            
            <button onclick="navigator.clipboard.writeText('${paymentPageUrl}')" class="button" style="background: #FF9800;">
              Copy URL
            </button>
          </div>
          
          <div class="iframe-container">
            <iframe 
              id="paymentFrame" 
              src="${paymentPageUrl}"
              title="Pesapal Payment"
              allow="payment *"
            >
              Your browser does not support iframes.
            </iframe>
          </div>
          
          <div class="info-box">
            <h3>Test Credentials:</h3>
            <ul>
              <li><strong>Card:</strong> 4242 4242 4242 4242</li>
              <li><strong>Expiry:</strong> Any future date (e.g., 12/30)</li>
              <li><strong>CVV:</strong> Any 3 digits (e.g., 123)</li>
              <li><strong>Amount:</strong> ${testOrder.amount} KES</li>
              <li><strong>Phone:</strong> 0712345678 (for mobile money)</li>
            </ul>
            <p><strong>Note:</strong> After payment, you'll be redirected to the callback URL.</p>
          </div>
        </div>
        
        <script>
          console.log('Payment Test Loaded');
          console.log('Tracking ID:', '${orderTrackingId}');
          console.log('Payment URL:', '${paymentPageUrl}');
          
          // Auto-focus iframe
          setTimeout(() => {
            const frame = document.getElementById('paymentFrame');
            if (frame) {
              frame.focus();
            }
          }, 1000);
        </script>
      </body>
      </html>
    `;
    
    res.send(html);
    
  } catch (error) {
    console.error('❌ Test error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Test failed',
      details: error.response?.data
    });
  }
});

/* =======================
   IPN CALLBACK
======================= */
app.post('/api/pesapal/ipn', (req, res) => {
  console.log('📩 IPN received:', JSON.stringify(req.body, null, 2));
  res.status(200).json({ message: 'IPN received' });
});

/* =======================
   PAYMENT CALLBACK
======================= */
app.get('/payment-callback', (req, res) => {
  const { OrderTrackingId, OrderMerchantReference } = req.query;
  
  console.log('🔙 Payment callback received:', {
    OrderTrackingId,
    OrderMerchantReference,
    timestamp: new Date().toISOString()
  });

  // Redirect to frontend
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
    endpoints: {
      create_payment: 'POST /api/pesapal/create-payment',
      status: 'GET /api/pesapal/status',
      test: 'GET /api/pesapal/test',
      callback: 'GET /payment-callback'
    },
    note: 'Using correct Pesapal payment URL: /pesapaliframe/PesapalIframe3/Index'
  });
});

/* =======================
   START SERVER
======================= */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Environment: ${PESAPAL_CONFIG.environment}`);
  console.log(`📋 IPN ID: ${PESAPAL_CONFIG.ipn_id}`);
  console.log('\n📞 Endpoints:');
  console.log(`   Create Payment: POST /api/pesapal/create-payment`);
  console.log(`   Test Payment: GET /api/pesapal/test`);
  console.log(`   Health: GET /api/health`);
  console.log('\n✅ Server ready! Using correct Pesapal payment URL.');
});
