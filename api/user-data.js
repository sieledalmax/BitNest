const express = require('express');
const admin = require('firebase-admin');

const router = express.Router();

// GET /api/user-data - Fetch user data
router.get('/', async (req, res) => {
  try {
    // Verify authentication
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify the Firebase ID token and get user ID
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(token);
    } catch (error) {
      return res.status(403).json({ error: 'Invalid authentication token' });
    }

    const userId = decodedToken.uid;
    
    // Get user data from Firestore
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    
    // Don't send sensitive data to client
    const { name, photoURL, email } = userData;
    
    // Return safe user data
    res.json({ 
      name: name || '',
      photoURL: photoURL || '',
      email: email || ''
    });
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

module.exports = router;