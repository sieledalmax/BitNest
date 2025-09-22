// Updated Firebase initialization pattern for all your API files
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

// Card number generator (for demonstration - in production use proper payment processor)
function generateCardNumber() {
  // Generate a test card number (always starts with 4 for Visa)
  const bin = '411111'; // Test BIN
  const randomPart = Array(10).fill(0).map(() => Math.floor(Math.random() * 10)).join('');
  return bin + randomPart;
}

// Generate expiry date (2 years from now)
function generateExpiryDate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear() + 2).slice(-2);
  return `${month}/${year}`;
}

// Generate CVV
function generateCVV() {
  return Array(3).fill(0).map(() => Math.floor(Math.random() * 10)).join('');
}

// Format card response (hide sensitive data)
function formatCardResponse(cardData) {
  const cardNumber = cardData.cardNumber || '';
  const last4 = cardNumber.slice(-4);
  
  return {
    id: cardData.id,
    type: cardData.type,
    last4: last4,
    color: cardData.color || 'blue',
    currency: cardData.currency || 'usd',
    design: cardData.design || 'standard',
    status: cardData.status || 'active',
    balance: cardData.balance || 0,
    spendingLimit: cardData.spendingLimit || 10000,
    availableBalance: cardData.availableBalance || (cardData.balance || 0),
    isActive: cardData.isActive !== false,
    isFrozen: cardData.isFrozen || false,
    createdAt: cardData.createdAt?.toDate?.() || cardData.createdAt,
    expiresAt: cardData.expiresAt?.toDate?.() || cardData.expiresAt,
    // Virtual card details (only for virtual cards and only when needed)
    ...(cardData.type === 'virtual' && {
      virtualDetails: {
        cardNumber: cardData.cardNumber ? '•••• •••• •••• ' + last4 : undefined,
        expiry: cardData.expiry ? '••/••' : undefined,
        cvv: cardData.cvv ? '•••' : undefined
      }
    })
  };
}

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
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
    console.log(`Fetching cards for user: ${userId}`);

    // Get user's cards from Firestore
    const cardsRef = db.collection('users').doc(userId).collection('cards');
    const snapshot = await cardsRef.where('status', 'in', ['active', 'pending']).get();

    const cards = [];
    
    snapshot.forEach(doc => {
      const cardData = doc.data();
      cards.push({
        id: doc.id,
        ...cardData
      });
    });

    // If no cards found, check if user has any card orders
    if (cards.length === 0) {
      const ordersRef = db.collection('users').doc(userId).collection('cardOrders');
      const ordersSnapshot = await ordersRef.where('status', 'in', ['processing', 'approved']).get();
      
      ordersSnapshot.forEach(doc => {
        const orderData = doc.data();
        cards.push({
          id: `order_${doc.id}`,
          type: orderData.type,
          color: orderData.color,
          currency: orderData.currency,
          design: orderData.design,
          status: 'pending',
          isActive: false,
          createdAt: orderData.createdAt,
          isOrder: true
        });
      });
    }

    // Format cards for response
    const formattedCards = cards.map(card => formatCardResponse(card));

    // Get user balance for card ordering eligibility
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data() || {};
    const userBalance = userData.balance || 0;

    const response = {
      success: true,
      cards: formattedCards,
      metadata: {
        total: formattedCards.length,
        canOrderNewCard: userBalance >= 5.00, // $5 card fee
        userBalance: userBalance,
        cardFee: 5.00,
        timestamp: new Date().toISOString()
      }
    };

    return res.status(200).json(response);

  } catch (error) {
    console.error('Error in user-cards API:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch user cards',
      cards: [],
      metadata: {
        total: 0,
        canOrderNewCard: false,
        userBalance: 0,
        cardFee: 5.00,
        timestamp: new Date().toISOString()
      }
    });
  }
};