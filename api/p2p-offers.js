const admin = require('firebase-admin');
const axios = require('axios');

// Initialize Firebase Admin if not already done
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

// CoinGecko API configuration
const COINGECKO_API = 'https://api.coingecko.com/api/v3';
const COINGECKO_IDS = {
  'BTC': 'bitcoin',
  'ETH': 'ethereum',
  'USDT': 'tether',
  'USDC': 'usd-coin'
};

// Fiat currency symbols
const FIAT_SYMBOLS = {
  'USD': '$',
  'EUR': '€',
  'GBP': '£',
  'CAD': 'CA$',
  'AUD': 'A$',
  'NGN': '₦',
  'GHS': 'GH₵',
  'XAF': 'FCFA',
  'KES': 'KSh'
};

// Enhanced sample P2P offers data (fallback)
const sampleOffers = [
  {
    id: 1,
    name: "CryptoKing",
    avatar: "https://randomuser.me/api/portraits/men/1.jpg",
    crypto: "BTC",
    fiat: "USD",
    country: "US",
    rate: 61200,
    premium: 2.0,
    rating: 4.8,
    trades: 1245,
    limits: {
      cryptoMin: 0.001,
      cryptoMax: 2,
      fiatMin: 50,
      fiatMax: 100000
    },
    payments: ["Bank", "Bank Transfer", "PayPal", "Zelle"],
    online: true,
    responseTime: "2 min",
    verification: "Verified Plus"
  },
  {
    id: 2,
    name: "EuroTrader",
    avatar: "https://randomuser.me/api/portraits/women/2.jpg",
    crypto: "ETH",
    fiat: "EUR",
    country: "EU",
    rate: 2940,
    premium: 5.0,
    rating: 4.9,
    trades: 876,
    limits: {
      cryptoMin: 0.01,
      cryptoMax: 10,
      fiatMin: 30,
      fiatMax: 28000
    },
    payments: ["SEPA", "Revolut", "Wise"],
    online: true,
    responseTime: "5 min",
    verification: "Verified"
  }
];

// Get real-time market rates from CoinGecko
async function getMarketRates() {
  try {
    const coins = Object.values(COINGECKO_IDS).join(',');
    const currencies = Object.keys(FIAT_SYMBOLS).join(',');
    
    const response = await axios.get(
      `${COINGECKO_API}/simple/price`,
      {
        params: {
          ids: coins,
          vs_currencies: currencies.toLowerCase(),
          include_24hr_change: true
        },
        timeout: 5000
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('Error fetching market rates:', error.message);
    
    // Fallback rates if API fails
    return {
      'bitcoin': {
        'usd': 60000, 'eur': 55000, 'gbp': 48000, 'cad': 80000,
        'aud': 90000, 'ngn': 90000000, 'ghs': 750000, 'xaf': 36000000, 'kes': 9000000
      },
      'ethereum': {
        'usd': 3000, 'eur': 2800, 'gbp': 2500, 'cad': 4000,
        'aud': 4500, 'ngn': 4500000, 'ghs': 37500, 'xaf': 1800000, 'kes': 450000
      },
      'tether': {
        'usd': 1, 'eur': 0.92, 'gbp': 0.79, 'cad': 1.36,
        'aud': 1.51, 'ngn': 1500, 'ghs': 12.5, 'xaf': 600, 'kes': 150
      },
      'usd-coin': {
        'usd': 1, 'eur': 0.92, 'gbp': 0.79, 'cad': 1.36,
        'aud': 1.51, 'ngn': 1500, 'ghs': 12.5, 'xaf': 600, 'kes': 150
      }
    };
  }
}

// Calculate premium based on market rate
function calculatePremium(offerRate, marketRate) {
  return ((offerRate - marketRate) / marketRate) * 100;
}

// Sort offers based on criteria
function sortOffers(offers, sortBy) {
  const sortedOffers = [...offers];
  
  switch (sortBy) {
    case 'premium-asc':
      return sortedOffers.sort((a, b) => a.premium - b.premium);
    case 'premium-desc':
      return sortedOffers.sort((a, b) => b.premium - a.premium);
    case 'rating-asc':
      return sortedOffers.sort((a, b) => a.rating - b.rating);
    case 'rating-desc':
      return sortedOffers.sort((a, b) => b.rating - a.rating);
    case 'rate-asc':
      return sortedOffers.sort((a, b) => a.rate - b.rate);
    case 'rate-desc':
      return sortedOffers.sort((a, b) => b.rate - a.rate);
    case 'trades-desc':
      return sortedOffers.sort((a, b) => b.trades - a.trades);
    default:
      return sortedOffers.sort((a, b) => b.rating - a.rating); // Default: highest rating first
  }
}

// Update offers with real-time market data
async function updateOffersWithMarketData(offers) {
  try {
    const marketRates = await getMarketRates();
    
    return offers.map(offer => {
      const coinId = COINGECKO_IDS[offer.crypto];
      const fiatLower = offer.fiat.toLowerCase();
      
      if (marketRates[coinId] && marketRates[coinId][fiatLower]) {
        const marketRate = marketRates[coinId][fiatLower];
        const premium = calculatePremium(offer.rate, marketRate);
        
        return {
          ...offer,
          premium: parseFloat(premium.toFixed(2)),
          marketRate: marketRate,
          priceChange24h: marketRates[coinId][`${fiatLower}_24h_change`] || 0
        };
      }
      
      return offer;
    });
  } catch (error) {
    console.error('Error updating offers with market data:', error);
    return offers; // Return original offers if market data fails
  }
}

// Get vendor offers from Firestore
async function getVendorOffersFromFirebase() {
  try {
    console.log('Fetching vendor offers from Firebase...');
    
    // Get active vendors
    const vendorsSnapshot = await db.collection('vendors')
      .where('status', '==', 'active')
      .where('isOnline', '==', true)
      .get();

    if (vendorsSnapshot.empty) {
      console.log('No active vendors found in Firebase');
      return sampleOffers;
    }

    const offers = [];
    
    // Process each vendor and their offers
    for (const vendorDoc of vendorsSnapshot.docs) {
      const vendorData = vendorDoc.data();
      
      // Get offers for this vendor
      const offersSnapshot = await db.collection('vendors')
        .doc(vendorDoc.id)
        .collection('offers')
        .where('status', '==', 'active')
        .get();

      for (const offerDoc of offersSnapshot.docs) {
        const offerData = offerDoc.data();
        
        // Create offer object
        const offer = {
          id: offerDoc.id,
          vendorId: vendorDoc.id,
          name: vendorData.displayName || vendorData.name || 'Vendor',
          avatar: vendorData.avatar || `https://randomuser.me/api/portraits/men/${Math.floor(Math.random() * 50) + 1}.jpg`,
          crypto: offerData.crypto,
          fiat: offerData.fiat,
          country: vendorData.country || 'US',
          rate: offerData.rate,
          premium: offerData.premium || 0,
          rating: vendorData.rating || 4.5,
          trades: vendorData.totalTrades || 100,
          limits: {
            cryptoMin: offerData.minAmount || 0.001,
            cryptoMax: offerData.maxAmount || 10,
            fiatMin: offerData.minAmount * offerData.rate || 50,
            fiatMax: offerData.maxAmount * offerData.rate || 100000
          },
          payments: offerData.paymentMethods || ['Bank Transfer'],
          online: vendorData.isOnline || true,
          responseTime: vendorData.avgResponseTime || '5 min',
          verification: vendorData.verificationLevel || 'Verified',
          createdAt: offerData.createdAt?.toDate() || new Date(),
          updatedAt: offerData.updatedAt?.toDate() || new Date()
        };
        
        offers.push(offer);
      }
    }

    console.log(`Found ${offers.length} offers from ${vendorsSnapshot.size} vendors`);
    return offers.length > 0 ? offers : sampleOffers;

  } catch (error) {
    console.error('Error fetching vendor offers from Firebase:', error);
    return sampleOffers;
  }
}

// Generate additional dynamic offers based on existing ones
function generateDynamicOffers(baseOffers) {
  if (baseOffers.length === 0) return sampleOffers;
  
  const dynamicOffers = [...baseOffers];
  
  // Add some randomized variations if we have few offers
  if (baseOffers.length < 8) {
    baseOffers.forEach(offer => {
      if (Math.random() > 0.5) { // 50% chance to create variant
        const variant = {
          ...offer,
          id: offer.id + '_variant_' + Math.floor(Math.random() * 1000),
          rate: offer.rate * (0.95 + Math.random() * 0.1), // ±5% variation
          premium: offer.premium * (0.9 + Math.random() * 0.2),
          name: offer.name + ' ' + Math.floor(Math.random() * 100),
          trades: Math.floor(offer.trades * (0.5 + Math.random())),
          online: Math.random() > 0.3
        };
        dynamicOffers.push(variant);
      }
    });
  }
  
  return dynamicOffers;
}

// Main API handler
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

    // Get query parameters
    const { 
      sort = 'rating-desc', 
      limit, 
      crypto, 
      fiat, 
      country,
      payment,
      minRating 
    } = req.query;

    console.log(`Fetching P2P offers for user: ${decodedToken.uid}`);

    // Get offers from Firebase Firestore
    let offers = await getVendorOffersFromFirebase();
    
    // Update offers with real-time market data
    offers = await updateOffersWithMarketData(offers);
    
    // Generate additional dynamic offers if needed
    offers = generateDynamicOffers(offers);
    
    // Apply filters from query parameters
    if (crypto && crypto !== 'all') {
      offers = offers.filter(offer => offer.crypto === crypto);
    }
    
    if (fiat && fiat !== 'all') {
      offers = offers.filter(offer => offer.fiat === fiat);
    }
    
    if (country && country !== 'all') {
      offers = offers.filter(offer => offer.country === country);
    }
    
    if (payment && payment !== 'all') {
      offers = offers.filter(offer => 
        offer.payments.some(p => p.toLowerCase().includes(payment.toLowerCase()))
      );
    }
    
    if (minRating && !isNaN(parseFloat(minRating))) {
      offers = offers.filter(offer => offer.rating >= parseFloat(minRating));
    }
    
    // Sort offers
    offers = sortOffers(offers, sort);
    
    // Apply limit if specified
    if (limit && !isNaN(parseInt(limit))) {
      offers = offers.slice(0, parseInt(limit));
    }
    
    // Add metadata
    const response = {
      success: true,
      offers: offers,
      metadata: {
        total: offers.length,
        timestamp: new Date().toISOString(),
        sort: sort,
        filters: {
          crypto: crypto || 'all',
          fiat: fiat || 'all',
          country: country || 'all',
          payment: payment || 'all',
          minRating: minRating || 'any'
        },
        user: {
          uid: decodedToken.uid,
          canTrade: true // You can add logic to check user trading permissions
        }
      }
    };

    // Cache control headers (cache for 1 minute)
    res.setHeader('Cache-Control', 'public, max-age=60');
    
    return res.status(200).json(response);

  } catch (error) {
    console.error('Error in P2P offers API:', error);
    
    // Return sample data as fallback
    const fallbackResponse = {
      success: false,
      offers: sampleOffers,
      metadata: {
        total: sampleOffers.length,
        timestamp: new Date().toISOString(),
        note: 'Using fallback data due to server error',
        error: error.message
      }
    };
    
    return res.status(500).json(fallbackResponse);
  }
};