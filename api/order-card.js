const admin = require('firebase-admin');

if (!admin.apps.length) {
  try {
    // Parse the service account JSON from environment variable
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    
    // Validate that we have the required fields
    if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
      throw new Error('Missing required Firebase service account fields');
    }
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    
    console.log('Firebase Admin initialized successfully for project:', serviceAccount.project_id);
  } catch (error) {
    console.error('Firebase initialization failed:', error.message);
    // Log more details for debugging
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      console.log('FIREBASE_SERVICE_ACCOUNT length:', process.env.FIREBASE_SERVICE_ACCOUNT.length);
    } else {
      console.log('FIREBASE_SERVICE_ACCOUNT is not set');
    }
    throw error;
  }
}

const db = admin.firestore();

// Card number generator (for demonstration)
function generateCardNumber() {
  const bin = '411111'; // Test Visa BIN
  const randomPart = Array(10).fill(0).map(() => Math.floor(Math.random() * 10)).join('');
  const fullNumber = bin + randomPart;
  
  // Simple Luhn check (for demonstration)
  return fullNumber;
}

function generateExpiryDate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear() + 2).slice(-2);
  return `${month}/${year}`;
}

function generateCVV() {
  return Array(3).fill(0).map(() => Math.floor(Math.random() * 10)).join('');
}

// Validate card order request
function validateCardOrder(data) {
  const errors = [];
  
  if (!data.type || !['virtual', 'physical'].includes(data.type)) {
    errors.push('Invalid card type');
  }
  
  if (!data.color || !['blue', 'purple', 'green', 'orange', 'black'].includes(data.color)) {
    errors.push('Invalid card color');
  }
  
  if (!data.currency || !['usd', 'eur', 'gbp', 'btc', 'eth'].includes(data.currency)) {
    errors.push('Invalid currency');
  }
  
  if (!data.design || !['standard', 'crypto', 'premium', 'custom'].includes(data.design)) {
    errors.push('Invalid card design');
  }
  
  return errors;
}

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - No token provided' });
    }

    const token = authHeader.split('Bearer ')[1];
    
    // Verify Firebase ID token
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(token);
    } catch (error) {
      console.error('Token verification error:', error);
      return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }

    const userId = decodedToken.uid;
    
    // Parse request body
    let cardData;
    try {
      cardData = req.body;
    } catch (error) {
      return res.status(400).json({ error: 'Invalid JSON in request body' });
    }

    // Validate card data
    const validationErrors = validateCardOrder(cardData);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join(', ') });
    }

    console.log(`Processing card order for user: ${userId}`, cardData);

    // Check user balance
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = userDoc.data();
    const userBalance = userData.balance || 0;
    const cardFee = 5.00;

    if (userBalance < cardFee) {
      return res.status(402).json({ 
        error: 'Insufficient balance',
        required: cardFee,
        current: userBalance,
        shortage: cardFee - userBalance
      });
    }

    // Check if user already has an active card of this type
    const existingCardsRef = db.collection('users').doc(userId).collection('cards');
    const existingCardsSnapshot = await existingCardsRef
      .where('type', '==', cardData.type)
      .where('status', '==', 'active')
      .get();

    if (!existingCardsSnapshot.empty) {
      return res.status(409).json({ 
        error: `You already have an active ${cardData.type} card`,
        existingCardId: existingCardsSnapshot.docs[0].id
      });
    }

    // Start a Firestore transaction for atomic operations
    const result = await db.runTransaction(async (transaction) => {
      // Deduct card fee from user balance
      const newBalance = userBalance - cardFee;
      transaction.update(db.collection('users').doc(userId), {
        balance: newBalance,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Create card order record
      const orderData = {
        userId: userId,
        type: cardData.type,
        color: cardData.color,
        currency: cardData.currency,
        design: cardData.design,
        fee: cardFee,
        status: 'processing',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      const orderRef = db.collection('users').doc(userId).collection('cardOrders').doc();
      transaction.set(orderRef, orderData);

      // For virtual cards, create immediately
      let cardDetails = {};
      if (cardData.type === 'virtual') {
        const cardNumber = generateCardNumber();
        const expiry = generateExpiryDate();
        const cvv = generateCVV();

        // Create virtual card record
        const virtualCardData = {
          userId: userId,
          orderId: orderRef.id,
          type: 'virtual',
          color: cardData.color,
          currency: cardData.currency,
          design: cardData.design,
          cardNumber: cardNumber,
          last4: cardNumber.slice(-4),
          expiry: expiry,
          cvv: cvv,
          balance: 0,
          availableBalance: 0,
          spendingLimit: 10000,
          status: 'active',
          isActive: true,
          isFrozen: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          expiresAt: new Date(new Date().setFullYear(new Date().getFullYear() + 3)) // 3 years from now
        };

        const cardRef = db.collection('users').doc(userId).collection('cards').doc();
        transaction.set(cardRef, virtualCardData);

        // Update order status
        transaction.update(orderRef, {
          status: 'completed',
          cardId: cardRef.id,
          completedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        cardDetails = {
          id: cardRef.id,
          virtualDetails: {
            cardNumber: cardNumber,
            expiry: expiry,
            cvv: cvv
          }
        };
      }

      return {
        orderId: orderRef.id,
        cardDetails: cardDetails,
        newBalance: newBalance
      };
    });

    // Prepare response based on card type
    let responseMessage = '';
    let cardStatus = '';

    if (cardData.type === 'virtual') {
      responseMessage = 'Virtual card created successfully! Your card is ready to use.';
      cardStatus = 'active';
    } else {
      responseMessage = 'Physical card order placed successfully! Your card will be shipped within 7-10 business days.';
      cardStatus = 'pending';
    }

    const response = {
      success: true,
      message: responseMessage,
      order: {
        id: result.orderId,
        type: cardData.type,
        color: cardData.color,
        currency: cardData.currency,
        design: cardData.design,
        status: cardStatus,
        fee: cardFee,
        newBalance: result.newBalance
      },
      ...(cardData.type === 'virtual' && {
        card: {
          id: result.cardDetails.id,
          type: 'virtual',
          last4: result.cardDetails.virtualDetails.cardNumber.slice(-4),
          virtualDetails: {
            cardNumber: '•••• •••• •••• ' + result.cardDetails.virtualDetails.cardNumber.slice(-4),
            expiry: result.cardDetails.virtualDetails.expiry,
            cvv: '•••'
          }
        }
      }),
      metadata: {
        timestamp: new Date().toISOString(),
        deliveryTime: cardData.type === 'virtual' ? 'instant' : '7-10 business days'
      }
    };

    return res.status(201).json(response);

  } catch (error) {
    console.error('Error in order-card API:', error);
    
    if (error.code === 402) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient balance',
        required: 5.00,
        current: 0
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Failed to process card order',
      message: error.message
    });
  }
};