// Core Javascript Scoring engine executed on the server's V8 engine instead of PostGIS SQL Overloading

exports.scorePlace = (place, targetState, userHistory = []) => {
  // 1. Core Behavioral Match (1 - exact difference from user target matrix)
  const pUrgency = place.scores?.urgency || 0.5;
  const pEffort = place.scores?.effort || 0.5;
  const pEnergy = place.scores?.energy || 0.5;

  const behavioral_match = 
    (1 - Math.abs(pUrgency - targetState.urgency)) +
    (1 - Math.abs(pEffort - targetState.effort)) +
    (1 - Math.abs(pEnergy - targetState.energy));

  // 2. Physical Constants (Based on 20km/h avg speed)
  // Fallback to 5000 meters if coordinates/distance are missing during cold start
  const distance = place.distance_meters || 5000;
  const timeEst = (distance / 1000) / (20 / 60);
  
  // 3. Base Score combining spatial + structural match
  let baseScore = (10 - timeEst) + (behavioral_match * 3) + (place.popularity_score / 2);

  // 4. PREVENT EXTREME DISTANCE DOMINATION (Penalty added per audit rules)
  // Distance / 10000 ensures roughly ~ -0.2 penalty for 10km. 
  baseScore -= (distance / 10000) * 0.2;

  // 5. EXPLORATION BOOST (Weighted, not completely random)
  // Popularity maps from 0 to 5 normally. Encourages showing lesser-known gems occasionally.
  const explorationBoost = (1 - (place.popularity_score / 10)) * 0.15; // Adjusted to account for a generous /10 safety division 
  baseScore += explorationBoost;
  
  // 6. INTELLIGENT PERSONALIZATION (Interaction routing match)
  // Simple checks if this category was liked before 
  let primary_category = place.signals?.quick_bite ? 'quickbite' : (place.signals?.social ? 'social' : 'chill');
  
  // Example dummy logic simulating user interaction validation per user rules
  // Ex: userHistory is an array of categories the user has previously interacted favorably with
  if (userHistory.includes(primary_category)) {
      baseScore += 0.2; 
  }
  
  return { score: baseScore, timeEst };
};
