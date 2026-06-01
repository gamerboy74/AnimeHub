import { supabase } from '../config/supabase.js';

/**
 * Authentication middleware to verify Supabase JWT access tokens
 * and enforce strict administrative role checks.
 */
export async function requireAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Missing or malformed authorization token',
      });
    }

    const token = authHeader.split(' ')[1];

    // 1. Retrieve the authenticated user via Supabase Auth
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Invalid access token or expired session',
      });
    }

    // 2. Fetch the user profile from database to confirm their administrative privileges
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile || profile.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Administrative privileges are required',
      });
    }

    // Attach user information to request object for downstream logging/tracking
    req.user = user;
    next();
  } catch (err) {
    console.error('❌ requireAdmin verification failed:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal Authorization Verification Error',
    });
  }
}
