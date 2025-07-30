const { POINTS_TABLE, BONUS_PER_WIN, MALUS_MULTIPLIER, EXTRA_WIN_POINTS } = require('../utils/constants');

function calculatePoints(objective, winsAchieved) {
    let basePoints = 0;
    
    // Base points
    if (objective <= 10) {
        basePoints = POINTS_TABLE[objective];
    } else {
        // For objectives > 10
        basePoints = POINTS_TABLE[10] + ((objective - 10) * EXTRA_WIN_POINTS);
    }
    
    // Add bonus for wins achieved
    const bonusPoints = winsAchieved * BONUS_PER_WIN;
    
    return basePoints + bonusPoints;
}

function calculateMalus(objective, bestStreak) {
    return (objective - bestStreak) * MALUS_MULTIPLIER;
}

function calculateFinalPoints(objective, bestStreak, success) {
    if (success) {
        return calculatePoints(objective, objective);
    } else {
        const points = calculatePoints(objective, bestStreak);
        const malus = calculateMalus(objective, bestStreak);
        return points - malus;
    }
}

module.exports = {
    calculatePoints,
    calculateMalus,
    calculateFinalPoints
};