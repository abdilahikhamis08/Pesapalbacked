require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// CORS Configuration - Allow all origins for testing
app.use(cors({
  origin: '*', // Allow all origins for now
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
  consumer_key: process.env.PESAPAL_CONSUMER_KEY.
  consumer_secret: process.env.PESAPAL_CONSUMER_SECRET.
  ipn_id: process.env.PESAPAL_IPN_ID,
  environment: 'live'
};

const PESAPAL_URLS = {
  sandbox: {
    auth: 'https://cybqa.pesapal.com/pesapalv3/api/Auth/RequestToken',
    order: 'https://cybqa.pesapal.com/pesapalv3/api/Transactions/SubmitOrderRequest',
    status: 'https://cybqa.pesapal.com/pesapalv3/api/Transactions/GetTransactionStatus',
    ipn: 'https://cybqa.pesapal.com/pesapalv3/api/URLSetup/RegisterIPN',
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
    console.log('🔑 Requesting token from:', urls.auth);
    
    const response = await axios.post(urls.auth, {
      consumer_key: PESAPAL_CONFIG.consumer_key,
      consumer_secret: PESAPAL_CONFIG.consumer_secret
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    console.log('✅ Token received:', response.data.token ? 'Yes' : 'No');
    return response.data.token;
  } catch (error) {
    console.error('❌ Token error:', error.response?.data || error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Headers:', error.response.headers);
      console.error('Data:', error.response.data);
    }
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
    console.log('Order Data:', JSON.stringify(orderData, null, 2));
    
    const urls = getUrls();
    const token = await getPesaPalToken();
    
    console.log('✅ Token received:', token ? 'Yes' : 'No');

    // Prepare order data with all required fields
    const paymentOrder = {
      id: orderData.id || `ORDER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      currency: orderData.currency || 'USD',
      amount: orderData.amount || 120, // 10 KES for testing
      description: orderData.description || 'Premium Business Subscription - 1 Year',
     callback_url: `${process.env.REACT_APP_PROXY_URL}/payment-callback`,
      notification_id: PESAPAL_CONFIG.ipn_id,
      billing_address: {
        email_address: orderData.email || 'customer@example.com',
        phone_number: orderData.phone || '0712345678',
        country_code: orderData.country_code || 'USA',
        first_name: orderData.first_name || 'Customer',
        last_name: orderData.last_name || 'User',
        middle_name: '',
        line_1: 'N/A',
        line_2: 'N/A',
        city: 'Nairobi',
        state: 'Nairobi',
        postal_code: '00100',
        zip_code: '00100'
      }
    };

    console.log('📦 Submitting order to Pesapal...');
    console.log('Order payload:', JSON.stringify(paymentOrder, null, 2));

    // Submit order to Pesapal
    const orderResponse = await axios.post(urls.order, paymentOrder, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    console.log('✅ Order submitted successfully');
    console.log('Pesapal response:', JSON.stringify(orderResponse.data, null, 2));

    const orderTrackingId = orderResponse.data.order_tracking_id;
    const orderId = orderResponse.data.order_id;

    if (!orderTrackingId) {
      console.error('❌ No order_tracking_id in response');
      return res.status(400).json({
        error: 'No order_tracking_id returned',
        raw: orderResponse.data,
        message: 'Pesapal did not return a tracking ID'
      });
    }

    // ✅ CORRECT: Build the REAL payment page URL
    const paymentPageUrl = `${urls.payment}?OrderTrackingId=${orderTrackingId}&OrderMerchantReference=${paymentOrder.id}`;

    console.log('🔗 Generated payment URL:', paymentPageUrl);

    res.json({
      success: true,
      order_tracking_id: orderTrackingId,
      order_id: orderId,
      payment_page_url: paymentPageUrl, // ✅ Correct URL
      merchant_reference: paymentOrder.id,
      amount: paymentOrder.amount,
      currency: paymentOrder.currency,
      message: 'Payment created successfully',
      note: 'Use payment_page_url to redirect user to Pesapal payment page'
    });

  } catch (error) {
    console.error('❌ Payment creation error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
    
    res.status(500).json({
      error: 'Failed to create payment',
      details: error.response?.data,
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
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

    console.log('📊 Checking payment status for:', orderTrackingId);
    
    const urls = getUrls();
    const token = await getPesaPalToken();

    const response = await axios.get(
      `${urls.status}?orderTrackingId=${orderTrackingId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Accept': 'application/json'
        }
      }
    );

    console.log('✅ Status check response:', JSON.stringify(response.data, null, 2));

    res.json({
      success: true,
      ...response.data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Status error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
    
    res.status(500).json({
      error: 'Failed to check status',
      details: error.response?.data,
      message: error.message
    });
  }
});

/* =======================
   DIRECT TEST ENDPOINT
======================= */
app.get('/api/pesapal/test', async (req, res) => {
  try {
    console.log('🧪 Testing Pesapal integration...');
    
    const urls = getUrls();
    const token = await getPesaPalToken();
    
    console.log('✅ Token received for test');
    
    // Create test order
    const testOrder = {
      id: `TEST-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      currency: 'USD',
      amount: 120, // 1 KES for testing
      description: 'Test Payment - Development',
     callback_url: `${process.env.REACT_APP_PROXY_URL}/payment-callback`,
      notification_id: PESAPAL_CONFIG.ipn_id,
      billing_address: {
        email_address: 'test@example.com',
        phone_number: '0712345678',
        country_code: 'USA',
        first_name: '',
        last_name: 'User',
        middle_name: '',
        line_1: 'Test Address',
        line_2: '',
        city: 'Nairobi',
        state: 'Nairobi',
        postal_code: '00100',
        zip_code: '00100'
      }
    };
    
    console.log('📦 Submitting test order...');
    
    // Submit order
    const orderResponse = await axios.post(urls.order, testOrder, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    console.log('✅ Test order submitted');
    console.log('Order response:', orderResponse.data);
    
    const orderTrackingId = orderResponse.data.order_tracking_id;
    const orderId = orderResponse.data.order_id;
    
    if (!orderTrackingId) {
      throw new Error('No tracking ID received');
    }
    
    // Build payment URL
    const paymentPageUrl = `${urls.payment}?OrderTrackingId=${orderTrackingId}&OrderMerchantReference=${testOrder.id}`;
    
    console.log('🔗 Test payment URL:', paymentPageUrl);
    
    // Return HTML page for testing with enhanced features
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Pesapal Payment Test</title>
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
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: white;
            padding: 20px;
          }
          
          .container {
            max-width: 1200px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(20px);
            border-radius: 25px;
            padding: 40px;
            box-shadow: 0 25px 50px rgba(0,0,0,0.3);
            border: 1px solid rgba(255, 255, 255, 0.3);
          }
          
          .header {
            text-align: center;
            margin-bottom: 40px;
          }
          
          .badge {
            background: linear-gradient(135deg, #ffd700, #ffed4e);
            color: #8b6914;
            padding: 12px 24px;
            border-radius: 50px;
            font-weight: 800;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
            display: inline-block;
            margin-bottom: 20px;
            box-shadow: 0 8px 25px rgba(255, 215, 0, 0.4);
            animation: pulse 2s infinite;
            border: 2px solid rgba(255, 255, 255, 0.3);
          }
          
          @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
          }
          
          h1 {
            font-size: 2.8rem;
            margin-bottom: 15px;
            text-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
          }
          
          .subtitle {
            font-size: 1.2rem;
            opacity: 0.9;
            max-width: 600px;
            margin: 0 auto;
            line-height: 1.6;
          }
          
          .content {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
            margin-bottom: 40px;
          }
          
          @media (max-width: 768px) {
            .content {
              grid-template-columns: 1fr;
            }
          }
          
          .card {
            background: rgba(255, 255, 255, 0.15);
            border-radius: 20px;
            padding: 30px;
            border: 1px solid rgba(255, 255, 255, 0.2);
          }
          
          .card h3 {
            margin-bottom: 20px;
            font-size: 1.5rem;
            color: #ffd700;
            display: flex;
            align-items: center;
            gap: 10px;
          }
          
          .info-grid {
            display: grid;
            gap: 15px;
          }
          
          .info-item {
            display: flex;
            justify-content: space-between;
            padding: 12px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          }
          
          .info-item:last-child {
            border-bottom: none;
          }
          
          .info-label {
            font-weight: 600;
            color: rgba(255, 255, 255, 0.9);
          }
          
          .info-value {
            font-weight: 700;
            color: white;
            word-break: break-all;
            text-align: right;
            max-width: 60%;
          }
          
          .url-box {
            background: rgba(0, 0, 0, 0.3);
            padding: 20px;
            border-radius: 15px;
            margin: 20px 0;
            word-break: break-all;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            border: 1px solid rgba(255, 255, 255, 0.2);
          }
          
          .button-group {
            display: flex;
            flex-wrap: wrap;
            gap: 15px;
            justify-content: center;
            margin: 30px 0;
          }
          
          .btn {
            padding: 16px 30px;
            border-radius: 12px;
            border: none;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            text-decoration: none;
          }
          
          .btn-primary {
            background: linear-gradient(135deg, #4CAF50, #2E7D32);
            color: white;
            box-shadow: 0 8px 20px rgba(76, 175, 80, 0.3);
          }
          
          .btn-primary:hover {
            transform: translateY(-3px);
            box-shadow: 0 12px 30px rgba(76, 175, 80, 0.4);
            background: linear-gradient(135deg, #43A047, #1B5E20);
          }
          
          .btn-secondary {
            background: linear-gradient(135deg, #2196F3, #0D47A1);
            color: white;
            box-shadow: 0 8px 20px rgba(33, 150, 243, 0.3);
          }
          
          .btn-secondary:hover {
            transform: translateY(-3px);
            box-shadow: 0 12px 30px rgba(33, 150, 243, 0.4);
          }
          
          .btn-warning {
            background: linear-gradient(135deg, #FF9800, #E65100);
            color: white;
            box-shadow: 0 8px 20px rgba(255, 152, 0, 0.3);
          }
          
          .btn-warning:hover {
            transform: translateY(-3px);
            box-shadow: 0 12px 30px rgba(255, 152, 0, 0.4);
          }
          
          .iframe-container {
            width: 100%;
            height: 600px;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 15px;
            margin: 30px 0;
            overflow: hidden;
            background: white;
          }
          
          iframe {
            width: 100%;
            height: 100%;
            border: none;
          }
          
          .credentials {
            background: rgba(255, 215, 0, 0.2);
            border-radius: 15px;
            padding: 25px;
            margin-top: 30px;
            border: 1px dashed rgba(255, 215, 0, 0.5);
          }
          
          .credentials h4 {
            color: #ffd700;
            margin-bottom: 15px;
            font-size: 1.2rem;
            display: flex;
            align-items: center;
            gap: 10px;
          }
          
          .credentials ul {
            list-style: none;
            padding: 0;
          }
          
          .credentials li {
            padding: 8px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            display: flex;
            align-items: center;
            gap: 10px;
          }
          
          .credentials li:last-child {
            border-bottom: none;
          }
          
          .credentials li:before {
            content: '•';
            color: #4CAF50;
            font-size: 20px;
          }
          
          .debug-panel {
            background: rgba(0, 0, 0, 0.5);
            border-radius: 10px;
            padding: 15px;
            margin-top: 20px;
            font-size: 12px;
            font-family: monospace;
            max-height: 200px;
            overflow-y: auto;
          }
          
          .status-indicator {
            display: inline-block;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            margin-right: 8px;
          }
          
          .status-active {
            background: #4CAF50;
            box-shadow: 0 0 10px #4CAF50;
          }
          
          .status-test {
            background: #FF9800;
            box-shadow: 0 0 10px #FF9800;
          }
          
          .instructions {
            background: rgba(76, 175, 80, 0.2);
            border-radius: 15px;
            padding: 20px;
            margin: 20px 0;
            border-left: 4px solid #4CAF50;
          }
          
          .instructions ol {
            margin: 10px 0 0 20px;
          }
          
          .instructions li {
            margin: 8px 0;
            line-height: 1.5;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="badge">🧪 TEST MODE</div>
            <h1>Pesapal Payment Gateway Test</h1>
            <p class="subtitle">
              Complete test environment for Pesapal v3 API integration
              <span class="status-indicator status-active"></span> SANDBOX
            </p>
          </div>
          
          <div class="instructions">
            <strong>📋 Test Instructions:</strong>
            <ol>
              <li>Click "Open in New Tab" or "Load in Iframe" to start payment</li>
              <li>Use test credentials below for payment</li>
              <li>Complete payment in the Pesapal interface</li>
              <li>After payment, you'll be redirected to callback URL</li>
              <li>Check the browser console for debug information</li>
            </ol>
          </div>
          
          <div class="content">
            <div class="card">
              <h3>📦 Order Details</h3>
              <div class="info-grid">
                <div class="info-item">
                  <span class="info-label">Order ID:</span>
                  <span class="info-value">${orderId || 'N/A'}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">Tracking ID:</span>
                  <span class="info-value">${orderTrackingId}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">Reference:</span>
                  <span class="info-value">${testOrder.id}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">Amount:</span>
                  <span class="info-value">${testOrder.amount} ${testOrder.currency}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">Description:</span>
                  <span class="info-value">${testOrder.description}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">Callback URL:</span>
                  <span class="info-value" style="font-size: 12px;">${testOrder.callback_url}</span>
                </div>
              </div>
            </div>
            
            <div class="card">
              <h3>🔧 Actions</h3>
              <div class="info-grid">
                <div class="info-item">
                  <span class="info-label">Environment:</span>
                  <span class="info-value">${PESAPAL_CONFIG.environment.toUpperCase()}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">IPN ID:</span>
                  <span class="info-value">${PESAPAL_CONFIG.ipn_id}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">Backend URL:</span>
                  <span class="info-value" style="font-size: 12px;">${process.env.REACT_APP_PROXY_URL || 'https://pesapalbacked.onrender.com'}</span>
                </div>
              </div>
              
              <div class="url-box">
                ${paymentPageUrl}
              </div>
              
              <div class="button-group">
                <a href="${paymentPageUrl}" target="_blank" class="btn btn-primary">
                  <span>🔗</span> Open in New Tab
                </a>
                <button onclick="loadIframe()" class="btn btn-secondary">
                  <span>🖼️</span> Load in Iframe
                </button>
                <button onclick="copyToClipboard('${paymentPageUrl}')" class="btn btn-warning">
                  <span>📋</span> Copy URL
                </button>
              </div>
            </div>
          </div>
          
          <div class="iframe-container">
            <iframe 
              id="paymentFrame" 
              src="${paymentPageUrl}"
              title="Pesapal Payment Test"
              allow="payment *"
              allowfullscreen
            >
              <p>Your browser does not support iframes. Please use the "Open in New Tab" option.</p>
            </iframe>
          </div>
          
          <div class="credentials">
            <h4>🔑 Test Credentials (Sandbox)</h4>
            <ul>
              <li><strong>Card Payment:</strong> Use 4242 4242 4242 4242</li>
              <li><strong>Expiry Date:</strong> Any future date (e.g., 12/2030)</li>
              <li><strong>CVV:</strong> Any 3 digits (e.g., 123)</li>
              <li><strong>Phone (M-Pesa):</strong> 0712345678 or any Kenyan number</li>
              <li><strong>Amount:</strong> ${testOrder.amount} ${testOrder.currency} (Test amount)</li>
              <li><strong>Note:</strong> This is a sandbox environment - No real money is used</li>
            </ul>
          </div>
          
          <div class="debug-panel">
            <strong>🛠️ Debug Information:</strong><br>
            • Environment: ${PESAPAL_CONFIG.environment}<br>
            • Timestamp: ${new Date().toISOString()}<br>
            • Token: ${token ? 'Received ✓' : 'Not received ✗'}<br>
            • IPN ID: ${PESAPAL_CONFIG.ipn_id}<br>
            • Payment URL Length: ${paymentPageUrl.length} characters<br>
            • Window URL: <span id="currentUrl"></span>
          </div>
        </div>
        
        <script>
          console.log('🧪 Test Page Loaded');
          console.log('Tracking ID:', '${orderTrackingId}');
          console.log('Payment URL:', '${paymentPageUrl}');
          console.log('Environment:', '${PESAPAL_CONFIG.environment}');
          
          // Update current URL display
          document.getElementById('currentUrl').textContent = window.location.href;
          
          // Function to load payment in iframe
          function loadIframe() {
            const iframe = document.getElementById('paymentFrame');
            iframe.src = '${paymentPageUrl}';
            iframe.focus();
            
            // Add message listener for iframe
            window.addEventListener('message', function(event) {
              console.log('Message received from iframe:', event.data);
              if (event.data && event.data.type === 'PAYMENT_COMPLETE') {
                alert('Payment completed in iframe!');
              }
            });
          }
          
          // Function to copy URL to clipboard
          function copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(function() {
              alert('Payment URL copied to clipboard!');
            }, function(err) {
              console.error('Could not copy text: ', err);
              // Fallback for older browsers
              const textArea = document.createElement('textarea');
              textArea.value = text;
              document.body.appendChild(textArea);
              textArea.focus();
              textArea.select();
              try {
                document.execCommand('copy');
                alert('Payment URL copied to clipboard!');
              } catch (err) {
                console.error('Fallback copy failed:', err);
                alert('Failed to copy URL. Please copy manually.');
              }
              document.body.removeChild(textArea);
            });
          }
          
          // Auto-focus iframe on load
          setTimeout(() => {
            const frame = document.getElementById('paymentFrame');
            if (frame) {
              frame.focus();
            }
          }, 1000);
          
          // Listen for messages from payment window
          window.addEventListener('message', function(event) {
            // Check origin for security
            const allowedOrigins = [
              'https://cybqa.pesapal.com',
              'https://pay.pesapal.com',
              '${process.env.REACT_APP_PROXY_URL || 'https://pesapalbacked.onrender.com'}',
              window.location.origin
            ];
            
            if (allowedOrigins.includes(event.origin)) {
              console.log('Message from:', event.origin, 'Data:', event.data);
              
              if (event.data && event.data.type === 'PAYMENT_SUCCESS') {
                console.log('✅ Payment success detected from popup!');
                alert('Payment Successful! Redirecting...');
                
                // Send message to parent window if this is in an iframe
                if (window.parent !== window) {
                  window.parent.postMessage({
                    type: 'PAYMENT_SUCCESS',
                    trackingId: '${orderTrackingId}',
                    reference: '${testOrder.id}'
                  }, '*');
                }
              }
            }
          });
          
          // Add button event listeners
          document.addEventListener('DOMContentLoaded', function() {
            const buttons = document.querySelectorAll('.btn');
            buttons.forEach(button => {
              button.addEventListener('click', function() {
                console.log('Button clicked:', this.textContent);
              });
            });
          });
        </script>
      </body>
      </html>
    `;
    
    res.send(html);
    
  } catch (error) {
    console.error('❌ Test error:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
    
    res.status(500).json({
      error: 'Test failed',
      details: error.response?.data,
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/* =======================
   PAYMENT CALLBACK (ENHANCED)
   This handles the return from Pesapal after payment
======================= */
app.get('/payment-callback', (req, res) => {
  const { OrderTrackingId, OrderMerchantReference } = req.query;
  
  console.log('🎯 PAYMENT CALLBACK TRIGGERED');
  console.log('🔙 Payment callback received:', {
    OrderTrackingId,
    OrderMerchantReference,
    queryParams: req.query,
    timestamp: new Date().toISOString(),
    userAgent: req.headers['user-agent'],
    referer: req.headers['referer']
  });

  // Return HTML that communicates with parent window AND redirects
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
          animation: fadeIn 0.8s ease-out;
        }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .success-icon {
          font-size: 80px;
          margin-bottom: 20px;
          animation: bounce 1s ease infinite alternate;
        }
        
        @keyframes bounce {
          0% { transform: scale(1); }
          100% { transform: scale(1.1); }
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
          text-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
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
        
        .message {
          font-size: 1rem;
          margin-top: 20px;
          padding: 15px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
          border-left: 4px solid #FFD700;
        }
        
        .redirect-countdown {
          font-size: 2rem;
          font-weight: 800;
          margin: 20px 0;
          color: #FFD700;
          text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
        }
        
        .button {
          display: inline-block;
          background: rgba(255, 255, 255, 0.2);
          color: white;
          padding: 15px 30px;
          border-radius: 12px;
          text-decoration: none;
          font-weight: 600;
          margin-top: 20px;
          border: 1px solid rgba(255, 255, 255, 0.3);
          transition: all 0.3s ease;
          cursor: pointer;
        }
        
        .button:hover {
          background: rgba(255, 255, 255, 0.3);
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(0,0,0,0.2);
        }
        
        .debug-info {
          font-size: 12px;
          margin-top: 20px;
          padding: 10px;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 8px;
          font-family: monospace;
          text-align: left;
          max-height: 100px;
          overflow-y: auto;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="success-icon">✅</div>
        
        <h1>Payment Successful! 🎉</h1>
        
        <p>Thank you for your payment. Your subscription is being activated.</p>
        
        <div class="details">
          <div>
            <span class="label">Tracking ID:</span>
            <span class="value">${OrderTrackingId || 'N/A'}</span>
          </div>
          <div>
            <span class="label">Order Reference:</span>
            <span class="value">${OrderMerchantReference || 'N/A'}</span>
          </div>
          <div>
            <span class="label">Timestamp:</span>
            <span class="value">${new Date().toISOString().replace('T', ' ').substr(0, 19)}</span>
          </div>
        </div>
        
        <div class="spinner"></div>
        
        <p>Processing your subscription...</p>
        
        <div class="redirect-countdown" id="countdown">3</div>
        
        <p class="message">
          <strong>Note:</strong> This window will close automatically and 
          your subscription will be activated.
        </p>
        
        <button onclick="manualRedirect()" class="button">
          Click here if not redirected automatically
        </button>
        
        <div class="debug-info" id="debugInfo">
          Initializing payment completion...
        </div>
      </div>
      
      <script>
        // Log for debugging
        console.log('🔙 Payment Callback Page Loaded');
        console.log('Tracking ID:', '${OrderTrackingId}');
        console.log('Reference:', '${OrderMerchantReference}');
        console.log('Parent window exists:', window.opener ? 'Yes' : 'No');
        console.log('Parent window closed:', window.opener ? window.opener.closed : 'N/A');
        
        // Function to send message to parent window
        function sendMessageToParent() {
          try {
            if (window.opener && !window.opener.closed) {
              console.log('📤 Sending message to parent window...');
              
              // Send success message
              const message = {
                type: 'PAYMENT_SUCCESS',
                trackingId: '${OrderTrackingId}',
                reference: '${OrderMerchantReference}',
                timestamp: new Date().toISOString(),
                source: 'callback_page'
              };
              
              // Try to send to the origin
              window.opener.postMessage(message, window.location.origin);
              
              // Also try with wildcard for cross-origin
              window.opener.postMessage(message, '*');
              
              console.log('✅ Message sent to parent:', message);
              updateDebugInfo('Message sent to parent window successfully');
            } else {
              console.log('⚠️ No parent window found or parent is closed');
              updateDebugInfo('No parent window detected. Will redirect directly.');
            }
          } catch (error) {
            console.error('❌ Error sending message to parent:', error);
            updateDebugInfo('Error: ' + error.message);
          }
        }
        
        // Function to update debug info
        function updateDebugInfo(message) {
          const debugEl = document.getElementById('debugInfo');
          debugEl.innerHTML += '<br>' + new Date().toTimeString().split(' ')[0] + ': ' + message;
          debugEl.scrollTop = debugEl.scrollHeight;
        }
        
        // Function to redirect to frontend
        function redirectToFrontend() {
          const frontendUrl = 'https://businessmanagement-802ef.web.app/payment-result?trackingId=${OrderTrackingId}&reference=${OrderMerchantReference}&status=success&source=callback';
          console.log('🔀 Redirecting to:', frontendUrl);
          updateDebugInfo('Redirecting to: ' + frontendUrl);
          
          // Try to update parent location first
          try {
            if (window.opener && !window.opener.closed) {
              window.opener.location.href = frontendUrl;
              console.log('✅ Updated parent window location');
            }
          } catch (e) {
            console.log('⚠️ Could not update parent location (cross-origin)');
          }
          
          // Redirect this window too
          window.location.href = frontendUrl;
        }
        
        // Function for manual redirect
        function manualRedirect() {
          console.log('🔄 Manual redirect triggered');
          redirectToFrontend();
        }
        
        // Start countdown
        let countdown = 3;
        const countdownEl = document.getElementById('countdown');
        const countdownInterval = setInterval(() => {
          countdown--;
          countdownEl.textContent = countdown;
          
          if (countdown <= 0) {
            clearInterval(countdownInterval);
            countdownEl.textContent = 'Redirecting...';
          }
        }, 1000);
        
        // Initial actions on page load
        document.addEventListener('DOMContentLoaded', function() {
          updateDebugInfo('Page loaded successfully');
          
          // Send message to parent immediately
          setTimeout(sendMessageToParent, 500);
          
          // Set up automatic redirect
          setTimeout(() => {
            console.log('⏰ Auto-redirect triggered');
            updateDebugInfo('Auto-redirect triggered');
            
            // Close window if it's a popup
            if (window.opener && !window.opener.closed) {
              console.log('Closing popup window...');
              updateDebugInfo('Closing popup window...');
              
              // Give time for message to be processed
              setTimeout(() => {
                window.close();
              }, 500);
            }
            
            // Redirect
            redirectToFrontend();
          }, 3000); // 3 seconds delay
        });
        
        // Listen for messages (in case parent wants to communicate)
        window.addEventListener('message', function(event) {
          console.log('Message received in callback:', event.data);
          updateDebugInfo('Received message from: ' + event.origin);
          
          if (event.data && event.data.type === 'ACKNOWLEDGE') {
            console.log('✅ Parent acknowledged receipt');
            updateDebugInfo('Parent acknowledged receipt');
          }
        });
        
        // Send ready signal
        setTimeout(() => {
          if (window.opener) {
            window.opener.postMessage({ type: 'CALLBACK_READY' }, '*');
          }
        }, 1000);
        
        // Update debug info periodically
        setInterval(() => {
          updateDebugInfo('Waiting for redirect...');
        }, 1000);
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
  console.log('📩 IPN CALLBACK RECEIVED');
  console.log('IPN Headers:', req.headers);
  console.log('IPN Body:', JSON.stringify(req.body, null, 2));
  console.log('IPN Query:', req.query);
  console.log('IPN Timestamp:', new Date().toISOString());
  
  // Extract IPN data
  const ipnData = {
    ...req.body,
    headers: req.headers,
    timestamp: new Date().toISOString(),
    ip: req.ip || req.connection.remoteAddress
  };
  
  // Log to file or database in production
  console.log('📝 IPN Data:', JSON.stringify(ipnData, null, 2));
  
  // Process IPN (in a real app, you would update your database here)
  // For now, just log and acknowledge
  
  // Always respond with 200 OK to acknowledge receipt
  res.status(200).json({
    status: 'OK',
    message: 'IPN received successfully',
    timestamp: new Date().toISOString(),
    ipn_id: PESAPAL_CONFIG.ipn_id
  });
});

/* =======================
   REGISTER IPN URL
======================= */
app.post('/api/pesapal/register-ipn', async (req, res) => {
  try {
    const { ipn_url } = req.body;
    
    if (!ipn_url) {
      return res.status(400).json({
        error: 'ipn_url is required'
      });
    }
    
    const urls = getUrls();
    const token = await getPesaPalToken();
    
    const response = await axios.post(urls.ipn, {
      url: ipn_url,
      ipn_notification_type: 'POST'
    }, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    res.json({
      success: true,
      ...response.data
    });
    
  } catch (error) {
    console.error('❌ IPN registration error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to register IPN',
      details: error.response?.data,
      message: error.message
    });
  }
});

/* =======================
   SIMPLE PAYMENT STATUS CHECK
======================= */
app.get('/api/pesapal/simple-status', async (req, res) => {
  try {
    const { orderTrackingId } = req.query;
    
    if (!orderTrackingId) {
      return res.status(400).json({
        error: 'orderTrackingId is required'
      });
    }
    
    console.log('🔍 Simple status check for:', orderTrackingId);
    
    // Try to get status
    const urls = getUrls();
    const token = await getPesaPalToken();
    
    const response = await axios.get(
      `${urls.status}?orderTrackingId=${orderTrackingId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Accept': 'application/json'
        }
      }
    );
    
    const statusData = response.data;
    
    // Determine payment status
    let status = 'pending';
    let message = 'Payment is being processed';
    
    if (statusData.payment_status_description) {
      const desc = statusData.payment_status_description.toLowerCase();
      
      if (desc.includes('completed') || desc.includes('success')) {
        status = 'completed';
        message = 'Payment completed successfully';
      } else if (desc.includes('failed') || desc.includes('error')) {
        status = 'failed';
        message = 'Payment failed';
      } else if (desc.includes('cancelled') || desc.includes('canceled')) {
        status = 'cancelled';
        message = 'Payment was cancelled';
      }
    }
    
    res.json({
      success: true,
      status: status,
      message: message,
      trackingId: orderTrackingId,
      details: statusData,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Simple status error:', error.message);
    
    res.status(500).json({
      success: false,
      status: 'error',
      message: 'Failed to check status',
      error: error.message
    });
  }
});

/* =======================
   HEALTH CHECK (ENHANCED)
======================= */
app.get('/api/health', (req, res) => {
  const health = {
    status: 'ok',
    service: 'pesapal-proxy',
    timestamp: new Date().toISOString(),
    environment: PESAPAL_CONFIG.environment,
    ipn_id: PESAPAL_CONFIG.ipn_id,
    memory: process.memoryUsage(),
    uptime: process.uptime(),
    endpoints: {
      create_payment: 'POST /api/pesapal/create-payment',
      status: 'GET /api/pesapal/status',
      simple_status: 'GET /api/pesapal/simple-status',
      test: 'GET /api/pesapal/test',
      callback: 'GET /payment-callback',
      ipn: 'POST /api/pesapal/ipn',
      health: 'GET /api/health',
      register_ipn: 'POST /api/pesapal/register-ipn'
    },
    config: {
      environment: PESAPAL_CONFIG.environment,
      has_consumer_key: !!PESAPAL_CONFIG.consumer_key,
      has_consumer_secret: !!PESAPAL_CONFIG.consumer_secret,
      ipn_id_set: !!PESAPAL_CONFIG.ipn_id,
      proxy_url: process.env.REACT_APP_PROXY_URL || 'https://pesapalbacked.onrender.com'
    },
    note: 'Pesapal v3 Integration Proxy - Ready for Production'
  };
  
  console.log('🏥 Health check requested:', health.timestamp);
  
  res.json(health);
});

/* =======================
   ROOT ENDPOINT
======================= */
app.get('/', (req, res) => {
  res.json({
    message: 'Pesapal Payment Gateway Proxy API',
    version: '3.0.0',
    status: 'operational',
    timestamp: new Date().toISOString(),
    endpoints: {
      docs: 'Visit /api/health for API status',
      test: 'GET /api/pesapal/test for payment test',
      create: 'POST /api/pesapal/create-payment to create payment',
      callback: 'GET /payment-callback for payment return'
    },
    environment: PESAPAL_CONFIG.environment,
    support: 'For issues, check the logs or contact support'
  });
});

/* =======================
   ERROR HANDLING MIDDLEWARE
======================= */
app.use((err, req, res, next) => {
  console.error('🚨 Unhandled Error:', err.stack);
  
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'] || Math.random().toString(36).substr(2, 9)
  });
});

// 404 Handler
app.use((req, res) => {
  console.log('🔍 404 Not Found:', req.method, req.url);
  
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.url,
    method: req.method,
    timestamp: new Date().toISOString(),
    available_endpoints: {
      root: 'GET /',
      health: 'GET /api/health',
      create_payment: 'POST /api/pesapal/create-payment',
      test_payment: 'GET /api/pesapal/test',
      payment_callback: 'GET /payment-callback'
    }
  });
});

/* =======================
   START SERVER
======================= */
const PORT = process.env.PORT || 3001;

// Start server
const server = app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 Pesapal Payment Gateway Proxy Started');
  console.log('='.repeat(60));
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 Environment: ${PESAPAL_CONFIG.environment.toUpperCase()}`);
  console.log(`🔑 Consumer Key: ${PESAPAL_CONFIG.consumer_key ? 'Set ✓' : 'Not Set ✗'}`);
  console.log(`🔐 IPN ID: ${PESAPAL_CONFIG.ipn_id}`);
  console.log(`🔄 Proxy URL: ${process.env.REACT_APP_PROXY_URL || 'https://pesapalbacked.onrender.com'}`);
  console.log('\n📞 Available Endpoints:');
  console.log('   • GET  /                    - API Information');
  console.log('   • GET  /api/health          - Health Check');
  console.log('   • POST /api/pesapal/create-payment - Create Payment');
  console.log('   • GET  /api/pesapal/status  - Check Payment Status');
  console.log('   • GET  /api/pesapal/test    - Test Payment Interface');
  console.log('   • GET  /payment-callback    - Payment Return Callback');
  console.log('   • POST /api/pesapal/ipn     - IPN Callback');
  console.log('\n🔧 Configuration:');
  console.log('   • Frontend: https://businessmanagement-802ef.web.app');
  console.log('   • Callback: /payment-callback');
  console.log('   • Test: /api/pesapal/test');
  console.log('='.repeat(60));
  console.log('✅ Server is ready to handle payments!\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed. Process terminated.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received. Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed. Process terminated.');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('🚨 Uncaught Exception:', err);
  // Don't exit in production, let the process continue
  if (process.env.NODE_ENV === 'development') {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
});
