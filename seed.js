const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ypicbilajipxjgkqxuht.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlwaWNiaWxhamlweGpna3F4dWh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MDgwMDMsImV4cCI6MjA5MDI4NDAwM30.ltRXNrPq4T0sknopDiyUXkcP9BxTsnXuLk7H3xdPAOk';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function generateSignals(place) {
  const acts = place.activities || [];
  
  const timeIsShort = place.duration_min <= 60;
  const isBudgetLow = place.budget && place.budget.level === 'low';

  const isQuickBite = acts.includes('quick_bite') || acts.includes('food');
  const isAesthetic = (place.vibe || []).includes('aesthetic') || acts.includes('photos');
  const isSocial = (place.social_fit || []).some(s => ['group', 'duo'].includes(s)) || acts.includes('hangout');

  return {
    fast_service: Boolean(timeIsShort),
    low_cost: Boolean(isBudgetLow),
    quick_bite: isQuickBite,
    aesthetic: isAesthetic,
    social: isSocial
  };
}

function computeScores(s) {
  return {
    urgency: ( (s.fast_service ? 1 : 0) + (s.quick_bite ? 1 : 0) ) / 2,
    effort: (s.low_cost ? 1 : 0),
    energy: ( (s.social ? 1 : 0) + (s.aesthetic ? 1 : 0) ) / 2
  };
}

// Ensure Strict Data Hygiene check before inserting 
function validatePlace(p) {
  if (!p.location || !p.location.lat || !p.location.lng) return false;
  if (!p.activities || p.activities.length === 0) return false;
  if (!p.budget) return false;
  return true;
}

const seedSupabase = async () => {
  try {
    const rawData = JSON.parse(fs.readFileSync('d:/yolo_nas/zipo-app/src/places.json', 'utf-8'));

    // Validate Pipeline Array
    const validData = rawData.filter(validatePlace);

    console.log(`Ingested ${validData.length} valid RAW places for processing...`);

    const mappedData = validData.map(p => {
      const signals = generateSignals(p);
      const scores = computeScores(signals);
      
      const vibe = (p.vibe && p.vibe.length > 0) ? p.vibe[0] : 'casual';
      const social = (p.social_fit && p.social_fit.length > 0) ? p.social_fit[0] : 'solo';

      return {
        name: p.name,
        latitude: p.location.lat,
        longitude: p.location.lng,
        location: `POINT(${p.location.lng} ${p.location.lat})`,
        budget: JSON.stringify(p.budget),
        time_to_spend: p.duration_min ? String(p.duration_min) + ' mins' : 'N/A',
        activities: p.activities,
        whisper: `A ${vibe} spot, great for ${social}.`,
        popularity_score: p.meta?.rating || 0,
        signals,
        scores
      };
    });

    console.log(`Pushing directly to Supabase via batching...`);
    
    // Batch Insert (Supabase maximum limit safety)
    const chunkSize = 500;
    for (let i = 0; i < mappedData.length; i += chunkSize) {
      const chunk = mappedData.slice(i, i + chunkSize);
      const { error } = await supabase.from('places').insert(chunk);
      if (error) {
        console.error("❌ Chunk Insert Error:", error.message);
      }
    }

    console.log(`✅ Fully Mapped! ${validData.length} places active across the Behavioral Engine PostGIS matrix.`);
  } catch (err) {
    console.error(err);
  }
};

seedSupabase();
