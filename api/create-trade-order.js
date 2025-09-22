// create-trade-order.js - For executing buy/sell orders
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    })
  });
}

const db = admin.firestore();

function validateTradeOrder(data) {
  const errors = [];
  
  if (!data.type || !['buy', 'sell'].includes(data.type)) {
    errors.push('Invalid trade type');
  }
  
  if (!data.pair) {
    errors.push('Trading pair is required');
  }
  
  if (!data.amount || data.amount <= 0) {
    errors.push('Valid amount is required');
  }
  
  if (!data.price || data.price <= 0) {
    errors.push('Valid price is required');
  }
  
  return errors;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - No token provided' });
    }

    const token = authHeader.split('Bearer ')[1];
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(token);
    } catch (error) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }

    const userId = decodedToken.uid;
    let tradeData;
    try {
      tradeData = req.body;
    } catch (error) {
      return res.status(400).json({ error: 'Invalid JSON in request body' });
    }

    // Validate trade data
    const validationErrors = validateTradeOrder(tradeData);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join(', ') });
    }

    // Check user balance
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = userDoc.data();
    const userBalance = userData.balance || 0;
    const total = tradeData.amount * tradeData.price;

    // For buy orders, check if user has enough USDT
    if (tradeData.type === 'buy' && userBalance < total) {
      return res.status(402).json({ 
        error: 'Insufficient balance',
        required: total,
        current: userBalance,
        shortage: total - userBalance
      });
    }

    // For sell orders, check if user has enough of the crypto (simplified - just return error for demo)
    if (tradeData.type === 'sell') {
      return res.status(402).json({
        error: 'Insufficient crypto balance',
        message: 'You do not have enough cryptocurrency to sell. Please deposit first.'
      });
    }

    // Create trade order in Firestore transaction
    const result = await db.runTransaction(async (transaction) => {
      if (tradeData.type === 'buy') {
        // Deduct USDT from user balance
        const newBalance = userBalance - total;
        transaction.update(db.collection('users').doc(userId), {
          balance: newBalance,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      // Create trade order record
      const tradeRecord = {
        userId: userId,
        type: tradeData.type,
        pair: tradeData.pair,
        amount: tradeData.amount,
        price: tradeData.price,
        total: total,
        status: 'completed', // Simplified - instant execution
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        completedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      const tradeRef = db.collection('users').doc(userId).collection('trades').doc();
      transaction.set(tradeRef, tradeRecord);

      return {
        tradeId: tradeRef.id,
        newBalance: tradeData.type === 'buy' ? userBalance - total : userBalance
      };
    });

    return res.status(201).json({
      success: true,
      message: `${tradeData.type.charAt(0).toUpperCase() + tradeData.type.slice(1)} order executed successfully`,
      trade: {
        id: result.tradeId,
        type: tradeData.type,
        pair: tradeData.pair,
        amount: tradeData.amount,
        price: tradeData.price,
        total: total,
        status: 'completed'
      },
      newBalance: result.newBalance,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in create-trade-order API:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to execute trade order',
      message: error.message
    });
  }
};