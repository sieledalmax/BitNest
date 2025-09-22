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
    const locksSnapshot = await db.collection('users').doc(userId).collection('locks')
      .where('status', 'in', ['active', 'pending'])
      .orderBy('createdAt', 'desc')
      .get();

    const locks = [];
    locksSnapshot.forEach(doc => {
      const lockData = doc.data();
      locks.push({
        id: doc.id,
        ...lockData
      });
    });

    return res.status(200).json({
      success: true,
      locks: locks,
      total: locks.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in user-locks API:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch user locks',
      locks: [],
      total: 0
    });
  }
};