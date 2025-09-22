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
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = userDoc.data();
    const balance = userData.balance || 0;

    return res.status(200).json({
      success: true,
      balance: balance,
      currency: 'USD',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in user-balance API:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch user balance',
      balance: 0
    });
  }
};