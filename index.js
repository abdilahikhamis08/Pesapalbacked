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
   PESAPAL CONFIGURATION
======================= */
const PESAPAL_CONFIG = {
  consumer_key: process.env.PESAPAL_CONSUMER_KEY || 'ngW+UEcnDhltUc5fxPfrCD987xMh3Lx8',
  consumer_secret: process.env.PESAPAL_CONSUMER_SECRET || 'q27RChYs5UkypdcNYKzuUw460Dg=',
  ipn_id: 'ae222a4b-4039-4d40-915a-daebbe32ff99',
  environment: process.env.PESAPAL_ENV || 'sandbox'
};

const PESAPAL_URLS = {
  sandbox: {
    auth: 'https://cybqa.pesapal.com/pesapalv3/api/Auth/RequestToken',
    order: 'https://cybqa.pesapal.com/pesapalv3/api/Transactions/SubmitOrderRequest',
    status: 'https://cybqa.pesapal.com/pesapalv3/api/Transactions/GetTransactionStatus',
    ipn: 'https://cybqa.pesapal.com/pesapalv3/api/URLSetup/RegisterIPN'
  },
  live: {
    auth: 'https://pay.pesapal.com/v3/api/Auth/RequestToken',
    order: 'https://pay.pesapal.com/v3/api/Transactions/SubmitOrderRequest',
    status: 'https://pay.pesapal.com/v3/api/Transactions/GetTransactionStatus',
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
   CORRECT PAYMENT ENDPOINT
======================= */
app.post('/api/pesapal/initiate-payment', async (req, res) => {
  try {
    const { orderData } = req.body;

    if (!orderData) {
      return res.status(400).json({
        error: 'orderData is required'
      });
    }

    console.log('💳 Initiating payment...');
    const urls = getUrls();
    const token = await getPesaPalToken();
    
    console.log('✅ Token received');

    // Prepare order data
    const paymentOrder = {
      id: orderData.id || `ORDER-${Date.now()}`,
      currency: orderData.currency || 'KES',
      amount: orderData.amount || 10,
      description: orderData.description || 'Payment',
      callback_url: orderData.callback_url || `${process.env.REACT_APP_PROXY_URL || 'https://pesapalbacked.onrender.com'}/payment-callback`,
      notification_id: PESAPAL_CONFIG.ipn_id,
      billing_address: {
        email_address: orderData.email || orderData.billing_address?.email_address || 'customer@example.com',
        phone_number: orderData.phone || orderData.billing_address?.phone_number || '0712345678',
        country_code: orderData.country_code || orderData.billing_address?.country_code || 'KE',
        first_name: orderData.first_name || orderData.billing_address?.first_name || 'Customer',
        last_name: orderData.last_name || orderData.billing_address?.last_name || 'User'
      }
    };

    console.log('📦 Submitting order to Pesapal...');
    console.log('Order ID:', paymentOrder.id);
    console.log('Amount:', paymentOrder.amount, paymentOrder.currency);
    console.log('IPN ID:', paymentOrder.notification_id);

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

    // ✅ CRITICAL: Return the CORRECT payment URL structure
    // Pesapal expects a specific format for payment URLs
    res.json({
      success: true,
      order_tracking_id: orderTrackingId,
      // ✅ CORRECT: Return the payment instructions, not the API URL
      payment_instructions: `Payment initiated successfully. Use tracking ID: ${orderTrackingId}`,
      message: 'Payment ready. User should be redirected to Pesapal payment page.',
      next_step: 'Redirect user to Pesapal payment page with the tracking ID',
      
      // For frontend to construct the correct URL
      payment_data: {
        order_tracking_id: orderTrackingId,
        environment: PESAPAL_CONFIG.environment,
        merchant_reference: paymentOrder.id
      }
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
   GET PAYMENT PAGE URL (For frontend to redirect)
======================= */
app.get('/api/pesapal/payment-page', (req, res) => {
  try {
    const { orderTrackingId } = req.query;

    if (!orderTrackingId) {
      return res.status(400).json({
        error: 'orderTrackingId is required'
      });
    }

    // ✅ CORRECT: Pesapal payment page URL structure
    // This is the ACTUAL payment page users should be redirected to
    const paymentPageUrl = PESAPAL_CONFIG.environment === 'sandbox'
      ? `https://cybqa.pesapal.com/pesapalv3/ProcessPayment?OrderTrackingId=${orderTrackingId}`
      : `https://pay.pesapal.com/v3/ProcessPayment?OrderTrackingId=${orderTrackingId}`;

    console.log('🔗 Generated payment page URL:', paymentPageUrl);

    res.json({
      success: true,
      payment_page_url: paymentPageUrl,
      order_tracking_id: orderTrackingId,
      message: 'Payment page URL generated successfully'
    });

  } catch (error) {
    console.error('❌ Payment page error:', error.message);
    res.status(500).json({
      error: 'Failed to generate payment page URL',
      details: error.message
    });
  }
});

/* =======================
   COMPLETE PAYMENT FLOW (All in one)
======================= */
app.post('/api/pesapal/complete-payment-flow', async (req, res) => {
  try {
    const { orderData } = req.body;

    if (!orderData) {
      return res.status(400).json({
        error: 'orderData is required'
      });
    }

    console.log('🔄 Starting complete payment flow...');
    const urls = getUrls();
    const token = await getPesaPalToken();

    // 1. Prepare and submit order
    const paymentOrder = {
      id: orderData.id || `ORDER-${Date.now()}`,
      currency: orderData.currency || 'KES',
      amount: orderData.amount || 10,
      description: orderData.description || 'Payment',
      callback_url: orderData.callback_url || `${process.env.REACT_APP_PROXY_URL || 'https://pesapalbacked.onrender.com'}/payment-callback`,
      notification_id: PESAPAL_CONFIG.ipn_id,
      billing_address: {
        email_address: orderData.email || orderData.billing_address?.email_address || 'customer@example.com',
        phone_number: orderData.phone || orderData.billing_address?.phone_number || '0712345678',
        country_code: orderData.country_code || orderData.billing_address?.country_code || 'KE',
        first_name: orderData.first_name || orderData.billing_address?.first_name || 'Customer',
        last_name: orderData.last_name || orderData.billing_address?.last_name || 'User'
      }
    };

    const orderResponse = await axios.post(urls.order, paymentOrder, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const orderTrackingId = orderResponse.data.order_tracking_id;

    if (!orderTrackingId) {
      throw new Error('No order_tracking_id returned');
    }

    // 2. Generate the payment page URL
    const paymentPageUrl = PESAPAL_CONFIG.environment === 'sandbox'
      ? `https://cybqa.pesapal.com/pesapalv3/ProcessPayment?OrderTrackingId=${orderTrackingId}`
      : `https://pay.pesapal.com/v3/ProcessPayment?OrderTrackingId=${orderTrackingId}`;

    // 3. Return everything the frontend needs
    res.json({
      success: true,
      order_tracking_id: orderTrackingId,
      payment_page_url: paymentPageUrl, // ✅ Frontend should redirect to this
      redirect_url: paymentPageUrl, // Alternative key
      merchant_reference: paymentOrder.id,
      message: 'Payment flow completed. Redirect user to payment page.',
      instructions: 'Use payment_page_url to redirect user to Pesapal payment page'
    });

  } catch (error) {
    console.error('❌ Complete flow error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Payment flow failed',
      details: error.response?.data,
      message: error.message
    });
  }
});

/* =======================
   IPN CALLBACK ENDPOINT
======================= */
app.post('/api/pesapal/ipn', (req, res) => {
  console.log('📩 IPN received:', JSON.stringify(req.body, null, 2));
  res.status(200).json({ message: 'IPN received' });
});

/* =======================
   PAYMENT CALLBACK (User returns here after payment)
======================= */
app.get('/payment-callback', (req, res) => {
  const { OrderTrackingId, OrderMerchantReference } = req.query;
  
  console.log('🔙 User returned from payment:', { OrderTrackingId, OrderMerchantReference });
  
  // Redirect to frontend
  const frontendUrl = `https://businessmanagement-802ef.web.app/payment-result?trackingId=${OrderTrackingId}&reference=${OrderMerchantReference}`;
  res.redirect(frontendUrl);
});

/* =======================
   TEST ENDPOINT
======================= */
app.post('/api/pesapal/test', async (req, res) => {
  try {
    const urls = getUrls();
    const token = await getPesaPalToken();
    
    const testOrder = {
      id: `TEST-${Date.now()}`,
      currency: 'KES',
      amount: 1,
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
    
    const orderResponse = await axios.post(urls.order, testOrder, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const orderTrackingId = orderResponse.data.order_tracking_id;
    const paymentPageUrl = `https://cybqa.pesapal.com/pesapalv3/ProcessPayment?OrderTrackingId=${orderTrackingId}`;
    
    res.json({
      success: true,
      message: 'Test successful',
      order_tracking_id: orderTrackingId,
      payment_page_url: paymentPageUrl,
      test_order: testOrder,
      instruction: `Visit this URL to test payment: ${paymentPageUrl}`
    });
    
  } catch (error) {
    console.error('❌ Test error:', error.response?.data || error.message);
    res.status(500).json({
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
    environment: PESAPAL_CONFIG.environment,
    ipn_id: PESAPAL_CONFIG.ipn_id,
    timestamp: new Date().toISOString()
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
  console.log('\n📞 Available Endpoints:');
  console.log('   Complete Payment Flow: POST /api/pesapal/complete-payment-flow');
  console.log('   Test Payment: POST /api/pesapal/test');
  console.log('   Health Check: GET /api/health');
  console.log('\n✅ Server ready! Use /api/pesapal/complete-payment-flow for payments.');
});
