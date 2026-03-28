const mongoose = require('mongoose');

const placeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true
    }
  },
  
  // Layer 1: Raw Data
  budget: String,
  time_to_spend: String,
  activities: [String],
  whisper: String,

  // Layer 2: Signals (Generated via Mapping)
  signals: {
    fast_service: { type: Boolean, default: false },
    low_cost: { type: Boolean, default: false },
    quick_bite: { type: Boolean, default: false },
    aesthetic: { type: Boolean, default: false },
    social: { type: Boolean, default: false }
  },

  // Layer 3: Situation Scores (Core Behaviour mapping)
  scores: {
    urgency: { type: Number, default: 0 },
    effort: { type: Number, default: 0 },
    energy: { type: Number, default: 0 }
  },

  popularity_score: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

// Create a 2dsphere index for geolocation queries
placeSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Place', placeSchema);
