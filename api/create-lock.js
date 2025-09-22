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

function validateLockData(data) {
  const errors = [];
  
  if (!data.amount || data.amount < 30) {
    errors.push('Minimum lock amount is $30');
  }
  
  if (!data.duration) {
    errors.push('Lock duration is required');
  }
  
  if (!data.apr || data.apr <= 0) {
    errors.push('Valid APR is required');
  }
  
  if (!data.asset) {
    errors.push('Asset is required');
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
    let lockData;
    try {
      lockData = req.body;
    } catch (error) {
      return res.status(400).json({ error: 'Invalid JSON in request body' });
    }

    // Validate lock data
    const validationErrors = validateLockData(lockData);
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

    if (userBalance < lockData.amount) {
      return res.status(402).json({ 
        error: 'Insufficient balance',
        required: lockData.amount,
        current: userBalance,
        shortage: lockData.amount - userBalance
      });
    }

    // Create lock in Firestore transaction
    const result = await db.runTransaction(async (transaction) => {
      // Deduct amount from user balance
      const newBalance = userBalance - lockData.amount;
      transaction.update(db.collection('users').doc(userId), {
        balance: newBalance,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Calculate end date based on duration
      const startDate = new Date();
      const endDate = new Date();
      
      if (lockData.duration.includes('month')) {
        const months = parseInt(lockData.duration) || 1;
        endDate.setMonth(startDate.getMonth() + months);
      } else if (lockData.duration.includes('year')) {
        const years = parseInt(lockData.duration) || 1;
        endDate.setFullYear(startDate.getFullYear() + years);
      } else {
        const days = parseInt(lockData.duration) || 14;
        endDate.setDate(startDate.getDate() + days);
      }

      // Create lock record
      const lockRecord = {
        userId: userId,
        amount: lockData.amount,
        asset: lockData.asset,
        duration: lockData.duration,
        apr: lockData.apr,
        status: 'active',
        startDate: admin.firestore.FieldValue.serverTimestamp(),
        endDate: endDate,
        earned: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      const lockRef = db.collection('users').doc(userId).collection('locks').doc();
      transaction.set(lockRef, lockRecord);

      return {
        lockId: lockRef.id,
        newBalance: newBalance,
        endDate: endDate.toISOString()
      };
    });

    return res.status(201).json({
      success: true,
      message: 'Lock created successfully',
      lock: {
        id: result.lockId,
        amount: lockData.amount,
        asset: lockData.asset,
        duration: lockData.duration,
        apr: lockData.apr,
        endDate: result.endDate
      },
      newBalance: result.newBalance,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in create-lock API:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create lock',
      message: error.message
    });
  }
};