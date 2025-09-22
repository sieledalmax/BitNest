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

function validateSwapData(data) {
  const errors = [];
  
  if (!data.fromToken) {
    errors.push('From token is required');
  }
  
  if (!data.toToken) {
    errors.push('To token is required');
  }
  
  if (data.fromToken === data.toToken) {
    errors.push('Cannot swap same token');
  }
  
  if (!data.fromAmount || data.fromAmount <= 0) {
    errors.push('Valid from amount is required');
  }
  
  if (!data.toAmount || data.toAmount <= 0) {
    errors.push('Valid to amount is required');
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
    let swapData;
    try {
      swapData = req.body;
    } catch (error) {
      return res.status(400).json({ error: 'Invalid JSON in request body' });
    }

    // Validate swap data
    const validationErrors = validateSwapData(swapData);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join(', ') });
    }

    // Check user balance (simplified - only check USDT balance)
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = userDoc.data();
    const userBalance = userData.balance || 0;

    // Simplified: Only allow swapping from USDT for demo
    if (swapData.fromToken !== 'USDT') {
      return res.status(402).json({
        error: 'Insufficient token balance',
        message: `You do not have enough ${swapData.fromToken} to swap. Please deposit first.`
      });
    }

    if (userBalance < swapData.fromAmount) {
      return res.status(402).json({
        error: 'Insufficient balance',
        required: swapData.fromAmount,
        current: userBalance,
        shortage: swapData.fromAmount - userBalance
      });
    }

    // Execute swap in Firestore transaction
    const result = await db.runTransaction(async (transaction) => {
      // Deduct from amount from user balance
      const newBalance = userBalance - swapData.fromAmount;
      transaction.update(db.collection('users').doc(userId), {
        balance: newBalance,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Create swap record
      const swapRecord = {
        userId: userId,
        fromToken: swapData.fromToken,
        toToken: swapData.toToken,
        fromAmount: swapData.fromAmount,
        toAmount: swapData.toAmount,
        status: 'completed',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        completedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      const swapRef = db.collection('users').doc(userId).collection('swaps').doc();
      transaction.set(swapRef, swapRecord);

      return {
        swapId: swapRef.id,
        newBalance: newBalance
      };
    });

    return res.status(201).json({
      success: true,
      message: 'Token swap executed successfully',
      swap: {
        id: result.swapId,
        fromToken: swapData.fromToken,
        toToken: swapData.toToken,
        fromAmount: swapData.fromAmount,
        toAmount: swapData.toAmount,
        status: 'completed'
      },
      newBalance: result.newBalance,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in swap-tokens API:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to execute token swap',
      message: error.message
    });
  }
};