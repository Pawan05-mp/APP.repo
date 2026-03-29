const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { scorePlace } = require('../utils/scoring');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ypicbilajipxjgkqxuht.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlwaWNiaWxhamlweGpna3F4dWh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MDgwMDMsImV4cCI6MjA5MDI4NDAwM30.ltRXNrPq4T0sknopDiyUXkcP9BxTsnXuLk7H3xdPAOk';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Default "Cold Start" fallback for undefined situations
const defaultState = { urgency: 0.7, effort: 0.5, energy: 0.6 };

const userStateMap = {
  Bored:   { urgency: 0.2, effort: 0.5, energy: 0.8 },
  Hungry:  { urgency: 1.0, effort: 0.2, energy: 0.5 },
  Stress:  { urgency: 0.5, effort: 0.8, energy: 0.2 },
  Friends: { urgency: 0.2, effort: 0.5, energy: 1.0 }
};

// MULTI-USER ISOLATED CACHES AND LEAK PROTECTION
const userRecentMap = new Map();
const databaseCacheMap = new Map();

// Clear User recency lists every 30 minutes to stop memory leaks
setInterval(() => {
  userRecentMap.clear();
  databaseCacheMap.clear();
}, 1000 * 60 * 30); 

function getRecent(userId) {
  return userRecentMap.get(userId) || [];
}

function updateRecent(userId, placeId) {
  if (!userId) return;
  const list = getRecent(userId);
  const updated = [...list, placeId].slice(-20); // Keep shifting the rolling cache
  userRecentMap.set(userId, updated);
}

// Ensure the system fails softly and provides high-ranking spots to not break UI loop
let globalTopPlaces = [];
(async () => {
   const { data } = await supabase.from('places').select('id, name, latitude, longitude, signals, scores, popularity_score').limit(5).order('popularity_score', { ascending: false });
   globalTopPlaces = data || [];
})();

// Heavy multi-metric diversification 
function diversify(places) {
  const usedTypes = new Set();
  const returnedPlaces = [];

  for (let place of places) {
    const primary_type = place.signals?.quick_bite ? 'quickbite' : (place.signals?.social ? 'social' : 'chill');
    
    // Pure category duplicate
    const sameType = usedTypes.has(primary_type);

    // Calculate energy distance variation globally. If it's the exact same type AND essentially the exact same vibe, skip it for UI variance.
    const tooSimilar = returnedPlaces.some(prev => 
      sameType && Math.abs((place.energy || 0) - (prev.energy || 0)) < 0.2
    );

    if (tooSimilar) continue; // Skip to enforce variation
    
    usedTypes.add(primary_type);
    returnedPlaces.push(place);
  }

  return returnedPlaces;
}

const withTimeout = (promise, ms) => {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), ms));
  return Promise.race([promise, timeout]);
};

// @route   GET /api/places/recommend
// @flow    query -> score -> decide -> show one strong option
router.get('/recommend', async (req, res) => {
  try {
    const { lat, lng, mood, user_id } = req.query;
    if (!lat || !lng || !mood) return res.status(400).json({ error: "Missing parameters" });

    // Enforce unique user identifier even if anonymous
    const uid = user_id || req.ip; 

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const targetState = userStateMap[mood] || defaultState;

    // CACHING MECHANISM
    const cacheKey = `${mood}_${Math.floor(userLat * 100)}_${Math.floor(userLng * 100)}`;
    let places = databaseCacheMap.get(cacheKey);

    if (!places) {
      // POSTGIS LAYER (Not cached yet! Dynamic progressive radius)
      const allowedRadii = [2000, 4000, 6000, 8000];
      places = [];

      const fetchPlacesTask = async () => {
        for (let r of allowedRadii) {
          const { data } = await supabase.rpc('get_places_within_distance', {
            user_lat: userLat,
            user_lng: userLng,
            max_distance_meters: r,
            result_limit: 60
          });
          
          if (data && data.length >= 20) {
             places = data;
             break;
          }
          if (data) places = data;
        }
      };

      try {
        await withTimeout(fetchPlacesTask(), 300);
      } catch (apiErr) {
        if (apiErr.message === 'TIMEOUT') console.warn("Supabase > 300ms SLA, cutting off mid-radius fetch to serve instantly.");
        else throw apiErr;
      }
      
      // Dump to rolling temporal cache to save DB costs
      if (places.length > 0) databaseCacheMap.set(cacheKey, places);
    }

    // FALLBACK
    if (!places || places.length === 0) {
       places = globalTopPlaces;
       if (!places || places.length === 0) return res.json([]);
    }

    // MENTAL MODEL LAYER: Javascript Native Execution
    
    // 1. Fetch Interaction History for real-time personalization
    let interactiveHistory = [];
    try {
      const { data: interactions } = await supabase
        .from('user_interactions')
        .select('place_id, action')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (interactions) {
        interactiveHistory = interactions.map(i => i.place_id);
      }
    } catch (historyErr) {
      console.error("Personalization history fetch failed", historyErr);
    }

    // 2. Scope Recency Filter (Session + DB History)
    const userRecents = getRecent(uid);
    // Combine session recents with last 20 from DB history
    const combinedRecents = [...new Set([...userRecents, ...interactiveHistory.slice(0, 20)])];
    
    let filtered = places.filter(p => !combinedRecents.includes(p.id));
    if (filtered.length < 5) filtered = places; // Don't break if exhaustive list

    // 2. Score Array in V8 Engine
    let scoredRecommendations = filtered.map((place) => {
      // Pass real interactive history to scorer
      const { score, timeEst } = scorePlace(place, targetState, interactiveHistory);
      const primary_type = place.signals?.quick_bite ? 'quickbite' : (place.signals?.social ? 'social' : 'chill');

      return {
        _id: place.id,
        name: place.name,
        primary_type,
        category: primary_type,
        energy: place.energy || 0,
        distanceInKm: (place.distance_meters / 1000).toFixed(2),
        estimatedMinutes: Math.ceil(timeEst || 5),
        score: score,
        reason: place.whisper || `Highly recommended for today.`,
        coordinates: [place.longitude, place.latitude]
      };
    });

    // 3. Sort Array 
    scoredRecommendations.sort((a, b) => b.score - a.score);

    // 4. Diversification Math
    let diversified = diversify(scoredRecommendations);
    if (diversified.length < 3) diversified = scoredRecommendations;

    // 5. Final Subslice limits
    const top5 = diversified.slice(0, 5);

    // 6. Update user's recency tracking cache (Rolling buffer of 15)
    top5.forEach(p => updateRecent(uid, p._id));

    // Returns TOP 5, UI limits to 1-3 strictly.
    res.json(top5);

  } catch (error) {
    console.error(error);
    const mapped = globalTopPlaces.map(p => ({
      _id: p.id, name: p.name, primary_type: 'chill', category: 'chill',
      energy: p.scores?.energy || 0, distanceInKm: 5, estimatedMinutes: 30,
      score: 5, reason: p.whisper || "Great local recommendation.",
      coordinates: [p.longitude, p.latitude]
    }));
    res.json(mapped); 
  }
});

// @route POST /api/places/interact
// Record all UI inputs directly into SQL DB
router.post('/interact', async (req, res) => {
  try {
     const { user_id, place_id, action } = req.body;
     await supabase.from('user_interactions').insert({
       user_id: user_id || req.ip,
       place_id,
       action
     });
     res.sendStatus(200);
  } catch (err) {
     console.error("Log error", err);
     res.sendStatus(500);
  }
});

// @route   GET /api/places/stats
// Fetch real user session metrics
router.get('/stats', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.json({ saved: 0, visits: 0, vibes: 0 });

    const { data: interactions } = await supabase
      .from('user_interactions')
      .select('action')
      .eq('user_id', user_id);

    const stats = {
      saved: interactions?.filter(i => i.action === 'save').length || 0,
      visits: interactions?.filter(i => i.action === 'go').length || 0,
      vibes: [...new Set(interactions?.map(i => i.mood).filter(Boolean))].length || 0
    };

    res.json(stats);
  } catch (err) {
    console.error("Stats fetch error", err);
    res.json({ saved: 0, visits: 0, vibes: 0 });
  }
});

// In-memory preference store (Simulating a DB table for this session)
const userPrefs = new Map();

// @route   GET /api/places/preferences
router.get('/preferences', async (req, res) => {
  const { user_id } = req.query;
  const defaultPrefs = { taste: 'Street food, Cafes', budget: 'Low - Medium' };
  res.json(userPrefs.get(user_id) || defaultPrefs);
});

// @route   PATCH /api/places/preferences
router.patch('/preferences', async (req, res) => {
  const { user_id, taste, budget } = req.body;
  const prefs = { 
    taste: taste || 'Street food, Cafes', 
    budget: budget || 'Low - Medium' 
  };
  userPrefs.set(user_id, prefs);
  res.json(prefs);
});

module.exports = router;
