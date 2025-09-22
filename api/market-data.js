const express = require('express');
const fetch = require('node-fetch');
const admin = require('firebase-admin');

const router = express.Router();

// GET /api/market-data - Fetch cryptocurrency market data
router.get('/', async (req, res) => {
  try {
    // Verify authentication
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify the Firebase ID token
    try {
      await admin.auth().verifyIdToken(token);
    } catch (error) {
      return res.status(403).json({ error: 'Invalid authentication token' });
    }

    // Fetch market data from CoinGecko API
    const response = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h'
    );
    
    if (!response.ok) {
      throw new Error(`CoinGecko API responded with status ${response.status}`);
    }
    
    const data = await response.json();
    
    // Return the market data
    res.json(data);
  } catch (error) {
    console.error('Error fetching market data:', error);
    res.status(500).json({ error: 'Failed to fetch market data' });
  }
});

module.exports = router;