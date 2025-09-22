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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
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
    
    // Get query parameters
    const { limit = 50, offset = 0, type } = req.query;

    // Build query
    let tradesQuery = db.collection('users').doc(userId).collection('trades')
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    if (type && ['buy', 'sell'].includes(type)) {
      tradesQuery = tradesQuery.where('type', '==', type);
    }

    const tradesSnapshot = await tradesQuery.get();

    const trades = [];
    tradesSnapshot.forEach(doc => {
      const tradeData = doc.data();
      trades.push({
        id: doc.id,
        ...tradeData,
        createdAt: tradeData.createdAt?.toDate(),
        completedAt: tradeData.completedAt?.toDate()
      });
    });

    // Get swaps as well
    const swapsSnapshot = await db.collection('users').doc(userId).collection('swaps')
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit))
      .get();

    const swaps = [];
    swapsSnapshot.forEach(doc => {
      const swapData = doc.data();
      swaps.push({
        id: doc.id,
        type: 'swap',
        ...swapData,
        createdAt: swapData.createdAt?.toDate(),
        completedAt: swapData.completedAt?.toDate()
      });
    });

    // Combine and sort by date
    const allTransactions = [...trades, ...swaps].sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );

    return res.status(200).json({
      success: true,
      trades: trades,
      swaps: swaps,
      allTransactions: allTransactions.slice(0, parseInt(limit)),
      metadata: {
        totalTrades: trades.length,
        totalSwaps: swaps.length,
        totalTransactions: allTransactions.length,
        limit: parseInt(limit),
        offset: parseInt(offset),
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error in user-trades API:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch user trades',
      trades: [],
      swaps: [],
      allTransactions: []
    });
  }
};