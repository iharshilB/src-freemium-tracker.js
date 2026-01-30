/**
 * FREEMIUM USAGE TRACKER
 * Tracks user usage for freemium limits
 * 
 * DESIGN:
 * - 3 uses per 24 hours for free users
 * - Unlimited for premium users
 * - Uses Cloudflare KV for persistence
 * - Time-based rolling window
 */

/**
 * Check if user is within usage limit
 * @param {number} userId - Telegram user ID
 * @param {Object} env - Cloudflare environment with KV binding
 * @returns {Object} { allowed: boolean, remaining: number, isPremium: boolean }
 */
export async function checkUsageLimit(userId, env) {
  try {
    // Check if user is premium
    const isPremium = await isPremiumUser(userId, env);
    if (isPremium) {
      return { allowed: true, remaining: Infinity, isPremium: true };
    }
    
    // Get current usage
    const usage = await getUserUsage(userId, env);
    const now = Date.now();
    
    // Filter usage within last 24 hours
    const recentUsage = usage.filter(entry => 
      now - entry.timestamp < 24 * 60 * 60 * 1000
    );
    
    const used = recentUsage.length;
    const remaining = Math.max(0, 3 - used);
    const allowed = used < 3;
    
    return { allowed, remaining, isPremium: false };
    
  } catch (error) {
    console.error('Usage check failed:', error.message);
    // Fail open - allow usage if tracking fails
    return { allowed: true, remaining: 3, isPremium: false };
  }
}

/**
 * Record user usage
 */
export async function recordUsage(userId, env) {
  try {
    const usage = await getUserUsage(userId, env);
    const now = Date.now();
    
    // Add new usage entry
    usage.push({ timestamp: now });
    
    // Store back to KV
    await env.USAGE_KV.put(
      `usage:${userId}`,
      JSON.stringify(usage),
      { expirationTtl: 48 * 60 * 60 } // Keep for 48 hours
    );
    
  } catch (error) {
    console.error('Usage recording failed:', error.message);
    // Don't throw - degradation is acceptable here
  }
}

/**
 * Check if user is premium
 */
async function isPremiumUser(userId, env) {
  try {
    const premiumKey = `premium:${userId}`;
    const premiumData = await env.USAGE_KV.get(premiumKey, 'json');
    
    if (!premiumData) return false;
    
    // Check if premium status is still valid
    const now = Date.now();
    if (premiumData.expiresAt && premiumData.expiresAt < now) {
      // Expired - remove premium status
      await env.USAGE_KV.delete(premiumKey);
      return false;
    }
    
    return true;
    
  } catch (error) {
    console.error('Premium check failed:', error.message);
    return false;
  }
}

/**
 * Get user usage history
 */
async function getUserUsage(userId, env) {
  try {
    const usageKey = `usage:${userId}`;
    const usageData = await env.USAGE_KV.get(usageKey, 'json');
    
    return usageData || [];
    
  } catch (error) {
    console.error('Usage retrieval failed:', error.message);
    return [];
  }
}

/**
 * Set user as premium (called after payment)
 */
export async function setPremiumUser(userId, env, durationDays = 365) {
  try {
    const now = Date.now();
    const expiresAt = now + (durationDays * 24 * 60 * 60 * 1000);
    
    await env.USAGE_KV.put(
      `premium:${userId}`,
      JSON.stringify({ 
        userId: userId,
        activatedAt: now,
        expiresAt: expiresAt,
        durationDays: durationDays
      }),
      { expirationTtl: (durationDays + 7) * 24 * 60 * 60 } // Keep 7 days after expiry
    );
    
    return true;
    
  } catch (error) {
    console.error('Premium set failed:', error.message);
    return false;
  }
}

/**
 * Remove premium status
 */
export async function removePremiumUser(userId, env) {
  try {
    await env.USAGE_KV.delete(`premium:${userId}`);
    return true;
  } catch (error) {
    console.error('Premium removal failed:', error.message);
    return false;
  }
      }
