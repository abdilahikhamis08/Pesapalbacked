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
    ipn: 'https://cybqa.pesapal.com/pesapalv3/api/URLSetup/RegisterIPN'
  }
};

/* =======================
   GET AUTH TOKEN
======================= */
async function getPesaPalToken() {
  try {
    const response = await axios.post(PESAPAL_URLS.sandbox.auth, {
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
   SOLUTION 1: EMBEDDED PAYMENT PAGE
   (Most reliable for Pesapal sandbox)
======================= */
app.post('/api/pesapal/create-order', async (req, res) => {
  try {
    const { orderData } = req.body;

    console.log('💳 Creating Pesapal order...');
    const token = await getPesaPalToken();
    
    const paymentOrder = {
      id: orderData.id || `ORDER-${Date.now()}`,
      currency: orderData.currency || 'KES',
      amount: orderData.amount || 1,
      description: orderData.description || 'Payment',
      callback_url: orderData.callback_url || `${process.env.REACT_APP_PROXY_URL || 'https://pesapalbacked.onrender.com'}/payment-callback`,
      notification_id: PESAPAL_CONFIG.ipn_id,
      billing_address: {
        email_address: orderData.email || 'customer@example.com',
        phone_number: orderData.phone || '0712345678',
        country_code: orderData.country_code || 'KE',
        first_name: orderData.first_name || 'Customer',
        last_name: orderData.last_name || 'User'
      }
    };

    console.log('📦 Order data:', paymentOrder);

    const orderResponse = await axios.post(PESAPAL_URLS.sandbox.order, paymentOrder, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const orderTrackingId = orderResponse.data.order_tracking_id;
    
    if (!orderTrackingId) {
      throw new Error('No tracking ID received');
    }

    console.log('✅ Order created, Tracking ID:', orderTrackingId);

    // ✅ SOLUTION: Return embedded payment page HTML
    const embeddedPaymentPage = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Pesapal Payment</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .container {
            background: white;
            border-radius: 20px;
            padding: 40px;
            max-width: 800px;
            width: 100%;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center;
          }
          h1 { 
            color: #333;
            margin-bottom: 20px;
            font-size: 28px;
          }
          .info-box {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 10px;
            margin: 20px 0;
            text-align: left;
          }
          .info-box p {
            margin: 10px 0;
            color: #666;
          }
          .iframe-container {
            width: 100%;
            height: 600px;
            border: 2px solid #e0e0e0;
            border-radius: 10px;
            overflow: hidden;
            margin: 20px 0;
          }
          iframe {
            width: 100%;
            height: 100%;
            border: none;
          }
          .buttons {
            display: flex;
            gap: 10px;
            justify-content: center;
            margin-top: 20px;
          }
          button {
            background: linear-gradient(135deg, #4CAF50 0%, #2E7D32 100%);
            color: white;
            border: none;
            padding: 15px 30px;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s;
          }
          button:hover {
            transform: translateY(-2px);
          }
          .loading {
            text-align: center;
            padding: 40px;
          }
          .loading-spinner {
            border: 4px solid #f3f3f3;
            border-top: 4px solid #667eea;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Complete Your Payment</h1>
          
          <div class="info-box">
            <p><strong>Order ID:</strong> ${paymentOrder.id}</p>
            <p><strong>Amount:</strong> ${paymentOrder.amount} ${paymentOrder.currency}</p>
            <p><strong>Description:</strong> ${paymentOrder.description}</p>
            <p><strong>Tracking ID:</strong> ${orderTrackingId}</p>
          </div>
          
          <div class="iframe-container">
            <div class="loading" id="loading">
              <div class="loading-spinner"></div>
              <p>Loading payment page...</p>
            </div>
            <iframe 
              id="pesapalFrame" 
              src="https://cybqa.pesapal.com/pesapalv3/ProcessPayment?OrderTrackingId=${orderTrackingId}"
              onload="document.getElementById('loading').style.display = 'none';"
              onerror="document.getElementById('loading').innerHTML = '<p style=\"color:red;\">Failed to load payment page. Please try the direct link below.</p>';"
            ></iframe>
          </div>
          
          <div class="buttons">
            <button onclick="window.open('https://cybqa.pesapal.com/pesapalv3/ProcessPayment?OrderTrackingId=${orderTrackingId}', '_blank')">
              Open in New Tab
            </button>
            <button onclick="window.location.href = '${paymentOrder.callback_url}?OrderTrackingId=${orderTrackingId}'">
              Skip to Callback
            </button>
          </div>
          
          <p style="margin-top: 20px; color: #666; font-size: 14px;">
            If the payment page doesn't load above, click "Open in New Tab" or try a different browser.
          </p>
        </div>
        
        <script>
          // Auto-focus the iframe for keyboard input
          setTimeout(() => {
            const frame = document.getElementById('pesapalFrame');
            if (frame) {
              frame.focus();
            }
          }, 1000);
          
          // Listen for messages from iframe (if Pesapal supports it)
          window.addEventListener('message', (event) => {
            console.log('Message from iframe:', event.data);
            if (event.data.type === 'payment_completed') {
              window.location.href = '${paymentOrder.callback_url}?OrderTrackingId=${orderTrackingId}';
            }
          });
          
          // Check if iframe loaded successfully
          setTimeout(() => {
            const loading = document.getElementById('loading');
            const frame = document.getElementById('pesapalFrame');
            if (loading && frame && !frame.contentWindow) {
              loading.innerHTML = '<p style="color:orange;">Payment page is taking longer than expected. Please try opening in a new tab.</p>';
            }
          }, 5000);
        </script>
      </body>
      </html>
    `;

    // Return the embedded payment page
    res.send(embeddedPaymentPage);

  } catch (error) {
    console.error('❌ Order creation error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to create order',
      details: error.response?.data,
      message: error.message
    });
  }
});

/* =======================
   SOLUTION 2: SIMPLE REDIRECT (Alternative)
======================= */
app.post('/api/pesapal/redirect-to-payment', async (req, res) => {
  try {
    const { orderData } = req.body;
    
    const token = await getPesaPalToken();
    
    const paymentOrder = {
      id: orderData.id || `ORDER-${Date.now()}`,
      currency: orderData.currency || 'KES',
      amount: orderData.amount || 1,
      description: orderData.description || 'Payment',
      callback_url: orderData.callback_url || `${process.env.REACT_APP_PROXY_URL || 'https://pesapalbacked.onrender.com'}/payment-callback`,
      notification_id: PESAPAL_CONFIG.ipn_id,
      billing_address: {
        email_address: orderData.email || 'customer@example.com',
        phone_number: orderData.phone || '0712345678',
        country_code: orderData.country_code || 'KE',
        first_name: orderData.first_name || 'Customer',
        last_name: orderData.last_name || 'User'
      }
    };

    const orderResponse = await axios.post(PESAPAL_URLS.sandbox.order, paymentOrder, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const orderTrackingId = orderResponse.data.order_tracking_id;
    
    if (!orderTrackingId) {
      throw new Error('No tracking ID received');
    }

    // Redirect directly to Pesapal
    const pesapalUrl = `https://cybqa.pesapal.com/pesapalv3/ProcessPayment?OrderTrackingId=${orderTrackingId}`;
    res.redirect(pesapalUrl);

  } catch (error) {
    console.error('❌ Redirect error:', error.message);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
        <h1 style="color: #f44336;">Payment Error</h1>
        <p>${error.message}</p>
        <button onclick="window.history.back()" style="padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer;">
          Go Back
        </button>
      </body>
      </html>
    `);
  }
});

/* =======================
   SOLUTION 3: MANUAL PAYMENT INSTRUCTIONS
   (For when Pesapal sandbox is completely down)
======================= */
app.post('/api/pesapal/manual-payment', async (req, res) => {
  try {
    const { orderData } = req.body;
    
    const token = await getPesaPalToken();
    
    const paymentOrder = {
      id: orderData.id || `ORDER-${Date.now()}`,
      currency: orderData.currency || 'KES',
      amount: orderData.amount || 1,
      description: orderData.description || 'Payment',
      callback_url: orderData.callback_url || `${process.env.REACT_APP_PROXY_URL || 'https://pesapalbacked.onrender.com'}/payment-callback`,
      notification_id: PESAPAL_CONFIG.ipn_id,
      billing_address: {
        email_address: orderData.email || 'customer@example.com',
        phone_number: orderData.phone || '0712345678',
        country_code: orderData.country_code || 'KE',
        first_name: orderData.first_name || 'Customer',
        last_name: orderData.last_name || 'User'
      }
    };

    const orderResponse = await axios.post(PESAPAL_URLS.sandbox.order, paymentOrder, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const orderTrackingId = orderResponse.data.order_tracking_id;
    
    if (!orderTrackingId) {
      throw new Error('No tracking ID received');
    }

    // Return manual payment instructions
    const manualPage = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Manual Payment Instructions</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
          .card { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          h1 { color: #333; margin-bottom: 20px; }
          .step { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0; }
          .url-box { background: #e9ecef; padding: 15px; border-radius: 5px; margin: 10px 0; word-break: break-all; }
          button { background: #4CAF50; color: white; border: none; padding: 12px 24px; border-radius: 5px; cursor: pointer; margin: 5px; }
          .test-credentials { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Manual Payment Required</h1>
          <p>The Pesapal payment page is currently unavailable. Please follow these steps:</p>
          
          <div class="step">
            <h3>Step 1: Copy this Payment URL</h3>
            <div class="url-box">
              https://cybqa.pesapal.com/pesapalv3/ProcessPayment?OrderTrackingId=${orderTrackingId}
            </div>
            <button onclick="navigator.clipboard.writeText('https://cybqa.pesapal.com/pesapalv3/ProcessPayment?OrderTrackingId=${orderTrackingId}')">
              Copy URL
            </button>
            <button onclick="window.open('https://cybqa.pesapal.com/pesapalv3/ProcessPayment?OrderTrackingId=${orderTrackingId}', '_blank')">
              Open in New Tab
            </button>
          </div>
          
          <div class="step">
            <h3>Step 2: If page is blank/white, try:</h3>
            <ul>
              <li>Enable pop-ups in your browser</li>
              <li>Try a different browser (Chrome, Firefox, Edge)</li>
              <li>Try Incognito/Private mode</li>
              <li>Disable ad-blockers</li>
            </ul>
          </div>
          
          <div class="test-credentials">
            <h3>Test Credentials (Sandbox):</h3>
            <ul>
              <li><strong>Card:</strong> 4242 4242 4242 4242</li>
              <li><strong>Expiry:</strong> Any future date</li>
              <li><strong>CVV:</strong> Any 3 digits</li>
              <li><strong>Amount:</strong> ${paymentOrder.amount} KES</li>
            </ul>
          </div>
          
          <div class="step">
            <h3>Step 3: After Payment</h3>
            <p>After completing payment on Pesapal, you'll be redirected back to:</p>
            <div class="url-box">${paymentOrder.callback_url}</div>
            <p>Or you can manually go to: <a href="${paymentOrder.callback_url}?OrderTrackingId=${orderTrackingId}">Callback URL</a></p>
          </div>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6;">
            <p><strong>Order Details:</strong></p>
            <p>Tracking ID: <strong>${orderTrackingId}</strong></p>
            <p>Reference: <strong>${paymentOrder.id}</strong></p>
            <p>Amount: <strong>${paymentOrder.amount} ${paymentOrder.currency}</strong></p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    res.send(manualPage);

  } catch (error) {
    console.error('❌ Manual payment error:', error.message);
    res.status(500).json({
      error: 'Failed to create manual payment',
      details: error.message
    });
  }
});

/* =======================
   SIMPLE TEST ENDPOINT
======================= */
app.get('/api/pesapal/quick-test', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Pesapal Quick Test</title>
      <style>
        body { font-family: Arial; padding: 40px; text-align: center; }
        .test-box { margin: 20px; padding: 20px; border: 2px solid #667eea; border-radius: 10px; }
        button { background: #667eea; color: white; border: none; padding: 15px 30px; margin: 10px; border-radius: 5px; cursor: pointer; }
      </style>
    </head>
    <body>
      <h1>Pesapal Payment Test</h1>
      
      <div class="test-box">
        <h3>Option 1: Embedded Payment</h3>
        <p>Try the embedded payment page</p>
        <button onclick="testEmbedded()">Test Embedded Payment</button>
      </div>
      
      <div class="test-box">
        <h3>Option 2: Direct Redirect</h3>
        <p>Direct redirect to Pesapal</p>
        <button onclick="testRedirect()">Test Direct Redirect</button>
      </div>
      
      <div class="test-box">
        <h3>Option 3: Manual Instructions</h3>
        <p>Get manual payment instructions</p>
        <button onclick="testManual()">Test Manual Payment</button>
      </div>
      
      <script>
        async function testEmbedded() {
          const response = await fetch('/api/pesapal/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderData: {
                amount: 1,
                currency: 'KES',
                description: 'Test Payment'
              }
            })
          });
          const html = await response.text();
          document.write(html);
        }
        
        async function testRedirect() {
          const response = await fetch('/api/pesapal/redirect-to-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderData: {
                amount: 1,
                currency: 'KES',
                description: 'Test Payment'
              }
            })
          });
          if (response.redirected) {
            window.location.href = response.url;
          }
        }
        
        async function testManual() {
          const response = await fetch('/api/pesapal/manual-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderData: {
                amount: 1,
                currency: 'KES',
                description: 'Test Payment'
              }
            })
          });
          const html = await response.text();
          document.write(html);
        }
      </script>
    </body>
    </html>
  `);
});

/* =======================
   CHECK PESAPAL STATUS
======================= */
app.get('/api/pesapal/status-check', async (req, res) => {
  try {
    // Test if Pesapal is reachable
    const testResponse = await axios.get('https://cybqa.pesapal.com/pesapalv3/ProcessPayment', {
      timeout: 10000
    }).catch(() => null);
    
    // Test API connectivity
    const token = await getPesaPalToken();
    
    res.json({
      pesapal_status: testResponse ? 'reachable' : 'unreachable',
      api_status: token ? 'working' : 'failed',
      timestamp: new Date().toISOString(),
      environment: PESAPAL_CONFIG.environment,
      ipn_id: PESAPAL_CONFIG.ipn_id,
      note: 'Pesapal sandbox is often unstable. Try different approaches if one fails.'
    });
    
  } catch (error) {
    res.json({
      pesapal_status: 'error',
      api_status: 'failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/* =======================
   IPN & CALLBACK ENDPOINTS
======================= */
app.post('/api/pesapal/ipn', (req, res) => {
  console.log('📩 IPN received:', req.body);
  res.status(200).json({ message: 'IPN received' });
});

app.get('/payment-callback', (req, res) => {
  const { OrderTrackingId } = req.query;
  console.log('🔙 Callback received:', OrderTrackingId);
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <body style="font-family: Arial; padding: 40px; text-align: center;">
      <h1 style="color: #4CAF50;">Payment Received!</h1>
      <p>Tracking ID: ${OrderTrackingId || 'Unknown'}</p>
      <p>Thank you for your payment. Your subscription is being activated.</p>
      <button onclick="window.close()" style="padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer;">
        Close Window
      </button>
    </body>
    </html>
  `);
});

/* =======================
   HEALTH CHECK
======================= */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'pesapal-proxy',
    timestamp: new Date().toISOString(),
    endpoints: {
      create_order: 'POST /api/pesapal/create-order',
      redirect: 'POST /api/pesapal/redirect-to-payment',
      manual: 'POST /api/pesapal/manual-payment',
      quick_test: 'GET /api/pesapal/quick-test',
      status: 'GET /api/pesapal/status-check',
      callback: 'GET /payment-callback'
    }
  });
});

/* =======================
   START SERVER
======================= */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Environment: ${PESAPAL_CONFIG.environment}`);
  console.log('\n📞 Test Endpoints:');
  console.log(`   Quick Test: http://localhost:${PORT}/api/pesapal/quick-test`);
  console.log(`   Status Check: http://localhost:${PORT}/api/pesapal/status-check`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  console.log('\n💡 Tip: Pesapal sandbox is often unstable. Use the embedded payment page approach.');
});
